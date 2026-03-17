const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { nanoid } = require("nanoid");
const { Chess } = require("chess.js");

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const START_TIME_MS = 5 * 60 * 1000; // 5+0 by default
const INCREMENT_MS = 0;
const CLOCK_TICK_MS = 250;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

const pendingConfigs = new Map(); // gameId -> { baseMs, incrementMs }

function clampInt(n, min, max, fallback) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  const xi = Math.trunc(x);
  if (xi < min) return min;
  if (xi > max) return max;
  return xi;
}

app.post("/api/new", (req, res) => {
  const baseMinutes = clampInt(req.body?.baseMinutes, 1, 60, 5);
  const incrementSeconds = clampInt(req.body?.incrementSeconds, 0, 60, 0);
  const gameId = nanoid(10);
  pendingConfigs.set(gameId, {
    baseMs: baseMinutes * 60 * 1000,
    incrementMs: incrementSeconds * 1000
  });
  res.json({ gameId, url: `/game/${gameId}` });
});

app.get("/game/:id", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "game.html"));
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

/**
 * games[gameId] = {
 *   chess: Chess,
 *   players: { w: socketId|null, b: socketId|null },
 *   spectators: Set<socketId>,
 *   clocks: { w: ms, b: ms },
 *   baseMs: number,
 *   incrementMs: number,
 *   turnStartTs: number, // when current turn started
 *   lastTickTs: number,
 *   redoStack: Array<{ from,to,promotion }>,
 *   undoOffer: null | { fromSocketId, createdAt }
 * }
 */
const games = new Map();

function now() {
  return Date.now();
}

function getOrCreateGame(gameId) {
  if (!games.has(gameId)) {
    const chess = new Chess();
    const t = now();
    const cfg = pendingConfigs.get(gameId) || {
      baseMs: START_TIME_MS,
      incrementMs: INCREMENT_MS
    };
    pendingConfigs.delete(gameId);
    games.set(gameId, {
      chess,
      players: { w: null, b: null },
      spectators: new Set(),
      clocks: { w: cfg.baseMs, b: cfg.baseMs },
      baseMs: cfg.baseMs,
      incrementMs: cfg.incrementMs,
      turnStartTs: t,
      lastTickTs: t,
      redoStack: [],
      undoOffer: null
    });
  }
  return games.get(gameId);
}

function room(gameId) {
  return `game:${gameId}`;
}

function colorToKey(color) {
  return color === "w" ? "w" : "b";
}

function computeClocks(game) {
  // Return clocks as if ticked to "now" without mutating.
  const t = now();
  const clocks = { ...game.clocks };
  if (!game.chess.isGameOver()) {
    const turnKey = colorToKey(game.chess.turn());
    const delta = Math.max(0, t - game.turnStartTs);
    clocks[turnKey] = Math.max(0, clocks[turnKey] - delta);
  }
  return clocks;
}

function applyClockDeltaMutating(game) {
  const t = now();
  const delta = Math.max(0, t - game.turnStartTs);
  const turnKey = colorToKey(game.chess.turn());
  game.clocks[turnKey] = Math.max(0, game.clocks[turnKey] - delta);
  game.turnStartTs = t;
  game.lastTickTs = t;
}

function snapshot(game, extras = {}) {
  const clocks = computeClocks(game);
  const chess = game.chess;
  return {
    fen: chess.fen(),
    pgn: chess.pgn(),
    turn: chess.turn(),
    inCheck: chess.inCheck(),
    checkmate: chess.isCheckmate(),
    stalemate: chess.isStalemate(),
    gameOver: chess.isGameOver(),
    clocks,
    timeControl: { baseMs: game.baseMs, incrementMs: game.incrementMs },
    playersPresent: {
      w: Boolean(game.players.w),
      b: Boolean(game.players.b)
    },
    ...extras
  };
}

function assignRole(game, socketId) {
  if (!game.players.w) {
    game.players.w = socketId;
    return { role: "player", color: "w" };
  }
  if (!game.players.b) {
    game.players.b = socketId;
    return { role: "player", color: "b" };
  }
  game.spectators.add(socketId);
  return { role: "spectator", color: null };
}

function cleanupSocketFromGame(game, socketId) {
  if (game.players.w === socketId) game.players.w = null;
  if (game.players.b === socketId) game.players.b = null;
  game.spectators.delete(socketId);
  if (game.undoOffer?.fromSocketId === socketId) game.undoOffer = null;
}

function otherPlayerSocketId(game, socketId) {
  if (game.players.w === socketId) return game.players.b;
  if (game.players.b === socketId) return game.players.w;
  return null;
}

io.on("connection", (socket) => {
  socket.on("joinGame", ({ gameId }) => {
    if (!gameId || typeof gameId !== "string") return;
    const game = getOrCreateGame(gameId);
    const { role, color } = assignRole(game, socket.id);
    socket.join(room(gameId));
    socket.data.gameId = gameId;
    socket.data.role = role;
    socket.data.color = color;

    socket.emit("init", snapshot(game, { role, color, gameId }));
    io.to(room(gameId)).emit("presence", snapshot(game));
  });

  socket.on("leaveGame", () => {
    const gameId = socket.data.gameId;
    if (!gameId) return;
    const game = games.get(gameId);
    if (!game) return;
    cleanupSocketFromGame(game, socket.id);
    socket.leave(room(gameId));
    delete socket.data.gameId;
    io.to(room(gameId)).emit("presence", snapshot(game));
  });

  socket.on("stageMove", () => {
    // no-op: staging is client-side; kept for forward compat.
  });

  socket.on("playMove", ({ from, to, promotion }) => {
    const gameId = socket.data.gameId;
    const game = gameId ? games.get(gameId) : null;
    if (!game) return;
    const role = socket.data.role;
    const color = socket.data.color;
    if (role !== "player" || !color) return;
    if (game.chess.isGameOver()) return;

    // clock flag
    const clocks = computeClocks(game);
    const turnKey = colorToKey(game.chess.turn());
    if (clocks[turnKey] <= 0) return;

    if (game.chess.turn() !== color) return;

    applyClockDeltaMutating(game);
    const move = game.chess.move({ from, to, promotion: promotion || undefined });
    if (!move) {
      // restore start timestamp already updated - keep it consistent
      return;
    }

    // Increment is added to the player who just moved.
    if (game.incrementMs > 0) {
      game.clocks[color] = Math.max(0, game.clocks[color] + game.incrementMs);
    }

    game.redoStack = [];
    game.undoOffer = null;
    // New turn starts now
    game.turnStartTs = now();

    io.to(room(gameId)).emit(
      "state",
      snapshot(game, {
        lastMove: { from: move.from, to: move.to, san: move.san, flags: move.flags }
      })
    );
  });

  socket.on("emote", ({ type }) => {
    const gameId = socket.data.gameId;
    if (!gameId) return;
    const role = socket.data.role;
    const color = socket.data.color;
    io.to(room(gameId)).emit("emote", {
      type: String(type || ""),
      from: role === "player" ? color : "spectator"
    });
  });

  socket.on("offerUndo", () => {
    const gameId = socket.data.gameId;
    const game = gameId ? games.get(gameId) : null;
    if (!game) return;
    if (socket.data.role !== "player") return;
    if (game.chess.history().length === 0) return;
    const other = otherPlayerSocketId(game, socket.id);
    if (!other) return;

    game.undoOffer = { fromSocketId: socket.id, createdAt: now() };
    io.to(other).emit("undoOffered", { by: socket.data.color });
  });

  socket.on("respondUndo", ({ accept }) => {
    const gameId = socket.data.gameId;
    const game = gameId ? games.get(gameId) : null;
    if (!game || !game.undoOffer) return;
    const other = otherPlayerSocketId(game, socket.id);
    if (!other) return;
    if (game.undoOffer.fromSocketId !== other) return;

    const accepted = Boolean(accept);
    const offerFrom = game.undoOffer.fromSocketId;
    game.undoOffer = null;

    if (!accepted) {
      io.to(offerFrom).emit("undoResult", { accepted: false });
      return;
    }

    applyClockDeltaMutating(game);
    const undone = game.chess.undo();
    if (undone) {
      game.redoStack.push({ from: undone.from, to: undone.to, promotion: undone.promotion });
    }
    game.turnStartTs = now();

    io.to(room(gameId)).emit("undoResult", { accepted: true });
    io.to(room(gameId)).emit("state", snapshot(game, { lastMove: null }));
  });

  socket.on("redo", () => {
    const gameId = socket.data.gameId;
    const game = gameId ? games.get(gameId) : null;
    if (!game) return;
    if (socket.data.role !== "player") return;
    if (game.redoStack.length === 0) return;

    const mv = game.redoStack.pop();
    applyClockDeltaMutating(game);
    const move = game.chess.move({ from: mv.from, to: mv.to, promotion: mv.promotion || undefined });
    if (!move) return;

    // Increment applies on redo as well (replaying a move).
    const mover = move.color; // "w" | "b"
    if (game.incrementMs > 0) {
      game.clocks[mover] = Math.max(0, game.clocks[mover] + game.incrementMs);
    }
    game.turnStartTs = now();

    io.to(room(gameId)).emit(
      "state",
      snapshot(game, {
        lastMove: { from: move.from, to: move.to, san: move.san, flags: move.flags }
      })
    );
  });

  socket.on("disconnect", () => {
    const gameId = socket.data.gameId;
    if (!gameId) return;
    const game = games.get(gameId);
    if (!game) return;
    cleanupSocketFromGame(game, socket.id);
    io.to(room(gameId)).emit("presence", snapshot(game));

    const nobodyLeft =
      !game.players.w && !game.players.b && game.spectators.size === 0;
    if (nobodyLeft) {
      games.delete(gameId);
    }
  });
});

setInterval(() => {
  for (const [gameId, game] of games.entries()) {
    if (game.chess.isGameOver()) continue;
    const clocks = computeClocks(game);
    io.to(room(gameId)).emit("clock", clocks);
    if (clocks.w <= 0 || clocks.b <= 0) {
      io.to(room(gameId)).emit("flag", { clocks });
    }
  }
}, CLOCK_TICK_MS);

server.listen(PORT, () => {
  console.log(`Chess server running on http://localhost:${PORT}`);
});

