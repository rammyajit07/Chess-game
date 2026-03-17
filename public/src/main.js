import { loadPieceSrc, pieceLetterToCode } from "./pieces.js";
import { $, $all, button, formatClock, showModal, shareText } from "./ui.js";
import { Sfx } from "./sound.js";

import { Chess } from "https://cdn.jsdelivr.net/npm/chess.js@1.4.0/dist/esm/chess.js";

const socket = io();

const gameId = window.location.pathname.split("/").pop();
const gameIdLabel = $("#gameIdLabel");
gameIdLabel.textContent = `#${gameId}`;

const boardEl = $("#board");
const dragLayer = $("#dragLayer");
const statusText = $("#statusText");

const clockWhiteBtn = $("#clockWhite");
const clockBlackBtn = $("#clockBlack");
const clockWhiteTime = $("#clockWhiteTime");
const clockBlackTime = $("#clockBlackTime");

const presenceWhite = $("#presenceWhite");
const presenceBlack = $("#presenceBlack");

const avatarWhite = $("#avatarWhite");
const avatarBlack = $("#avatarBlack");

const takenByWhite = $("#takenByWhite");
const takenByBlack = $("#takenByBlack");

const undoBtn = $("#undoBtn");
const redoBtn = $("#redoBtn");
const shareBtn = $("#shareBtn");
const spectateBtn = $("#spectateBtn");
const tapHint = $("#tapHint");
const spectatorHint = $("#spectatorHint");
const resignWhiteBtn = $("#resignWhite");
const resignBlackBtn = $("#resignBlack");
const chatLog = $("#chatLog");
const chatInput = $("#chatInput");
const chatSend = $("#chatSend");

const state = {
  role: "spectator",
  color: null, // "w" | "b"
  orientation: "w",
  chess: new Chess(),
  fen: null,
  turn: "w",
  clocks: { w: 5 * 60 * 1000, b: 5 * 60 * 1000 },
  staged: null, // { from,to,promotion? }
  dragging: null,
  lastMove: null,
  presence: { w: false, b: false },
  gameOverShown: false,
  timeControl: { baseMs: 5 * 60 * 1000, incrementMs: 0 },
  taken: { w: [], b: [] },
  ended: null,
  chat: []
};

function isPlayer() {
  return state.role === "player" && (state.color === "w" || state.color === "b");
}

function myTurn() {
  return isPlayer() && !state.ended && !state.chess.isGameOver() && state.turn === state.color;
}

function canInteract() {
  return !state.ended && !state.chess.isGameOver();
}

function squareName(fileIdx, rankIdx) {
  const file = "abcdefgh"[fileIdx];
  const rank = String(rankIdx + 1);
  return `${file}${rank}`;
}

function parseFenPieces(fen) {
  const [placement] = fen.split(" ");
  const rows = placement.split("/");
  const map = new Map();
  for (let r = 0; r < 8; r++) {
    let file = 0;
    for (const ch of rows[r]) {
      if (/\d/.test(ch)) {
        file += Number(ch);
      } else {
        const rank = 8 - r;
        const sq = `${"abcdefgh"[file]}${rank}`;
        map.set(sq, ch);
        file += 1;
      }
    }
  }
  return map;
}

function boardToCssPos(sq, orientation) {
  const file = sq.charCodeAt(0) - 97;
  const rank = Number(sq[1]) - 1; // 0..7 for ranks 1..8
  const x = orientation === "w" ? file : 7 - file;
  const y = orientation === "w" ? 7 - rank : rank;
  return { left: `calc(${x} * var(--sq))`, top: `calc(${y} * var(--sq))` };
}

function clearSquareOverlays() {
  $all(".hintDot, .hintCapture, .selectedGlow", boardEl).forEach((n) => n.remove());
}

function addOverlay(sq, el) {
  const pos = boardToCssPos(sq, state.orientation);
  el.style.left = pos.left;
  el.style.top = pos.top;
  el.style.width = "var(--sq)";
  el.style.height = "var(--sq)";
  el.style.position = "absolute";
  boardEl.appendChild(el);
}

function showHighlights(fromSq) {
  clearSquareOverlays();
  if (!fromSq) return;
  const moves = state.chess.moves({ square: fromSq, verbose: true });
  const sel = document.createElement("div");
  sel.className = "selectedGlow";
  addOverlay(fromSq, sel);

  for (const m of moves) {
    const toSq = m.to;
    if (m.captured) {
      const cap = document.createElement("div");
      cap.className = "hintCapture";
      addOverlay(toSq, cap);
    } else {
      const dot = document.createElement("div");
      dot.className = "hintDot";
      addOverlay(toSq, dot);
    }
  }
}

async function buildBoardSquares() {
  boardEl.innerHTML = "";
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const file = state.orientation === "w" ? x : 7 - x;
      const rank = state.orientation === "w" ? 7 - y : y;
      const sq = squareName(file, rank);
      const isLight = (x + y) % 2 === 0;
      const d = document.createElement("div");
      d.className = `square ${isLight ? "light" : "dark"}`;
      d.dataset.square = sq;
      d.style.left = `calc(${x} * var(--sq))`;
      d.style.top = `calc(${y} * var(--sq))`;
      d.addEventListener("pointerdown", onPointerDownSquare);
      boardEl.appendChild(d);
    }
  }
}

async function renderPieces() {
  const pieces = parseFenPieces(state.fen || state.chess.fen());
  // Clear existing piece nodes
  $all("img.piece", boardEl).forEach((p) => p.remove());
  // Render each piece
  for (const [sq, letter] of pieces.entries()) {
    const code = pieceLetterToCode(letter);
    const img = document.createElement("img");
    img.className = "piece";
    img.alt = code;
    img.draggable = false;
    img.dataset.square = sq;
    img.dataset.piece = letter;
    img.src = await loadPieceSrc(code);
    const pos = boardToCssPos(sq, state.orientation);
    img.style.position = "absolute";
    img.style.left = `calc(${pos.left} + (var(--sq) * 0.07))`;
    img.style.top = `calc(${pos.top} + (var(--sq) * 0.07))`;
    boardEl.appendChild(img);
  }
}

function computeTakenFromPgn(pgn) {
  const taken = { w: [], b: [] };
  if (!pgn || typeof pgn !== "string") return taken;
  const replay = new Chess();
  try {
    replay.loadPgn(pgn);
  } catch {
    return taken;
  }
  const hist = replay.history({ verbose: true });
  for (const mv of hist) {
    if (!mv.captured) continue;
    const capturedColor = mv.color === "w" ? "b" : "w";
    const capturedCode = `${capturedColor}${mv.captured}`;
    taken[mv.color].push(capturedCode);
  }
  return taken;
}

async function renderTakenTray(trayEl, pieceCodes) {
  if (!trayEl) return;
  trayEl.classList.toggle("empty", !pieceCodes || pieceCodes.length === 0);
  trayEl.innerHTML = "";
  if (!pieceCodes || pieceCodes.length === 0) return;

  const recent = pieceCodes.slice(-10); // keep it tidy
  for (let i = 0; i < recent.length; i++) {
    const code = recent[i];
    const img = document.createElement("img");
    img.className = "capPiece";
    img.alt = code;
    img.draggable = false;
    img.style.setProperty("--i", String(i));
    img.src = await loadPieceSrc(code);
    trayEl.appendChild(img);
  }
}

function triggerBam(color) {
  const tray = color === "w" ? takenByWhite : takenByBlack;
  if (!tray) return;
  tray.classList.remove("bam");
  // eslint-disable-next-line no-unused-expressions
  tray.offsetWidth;
  tray.classList.add("bam");
  Sfx.emote();
  setTimeout(() => {
    tray.classList.remove("bam");
    renderTakenTray(tray, state.taken[color]);
  }, 700);
}

function updateStatus() {
  if (state.role === "spectator") {
    statusText.textContent = state.chess.isGameOver()
      ? "Game over."
      : state.turn === "w"
        ? "White to move (spectating)"
        : "Black to move (spectating)";
    return;
  }

  if (state.chess.isCheckmate()) {
    statusText.textContent = `Checkmate. ${state.turn === "w" ? "Black" : "White"} wins.`;
    return;
  }
  if (state.chess.isStalemate()) {
    statusText.textContent = "Stalemate.";
    return;
  }
  if (state.chess.isGameOver()) {
    statusText.textContent = "Game over.";
    return;
  }

  if (state.staged && myTurn()) {
    statusText.textContent = "Move staged. Tap your clock to play it.";
    return;
  }
  if (myTurn()) {
    statusText.textContent = state.chess.inCheck() ? "Your turn (in check)." : "Your turn.";
  } else {
    if (state.color === "b" && state.chess.history().length === 0) {
      statusText.textContent = "Opponent’s turn. (White moves first.)";
    } else {
      statusText.textContent = "Opponent’s turn.";
    }
  }
}

function showGameOverOverlay(message) {
  if (state.gameOverShown) return;
  state.gameOverShown = true;

  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <div style="color:rgba(255,255,255,.90);font-weight:800;margin-bottom:6px">Game finished</div>
    <div style="color:rgba(255,255,255,.74);font-size:13px;line-height:1.45">${message}</div>
  `;

  const close = showModal({
    title: "Game Over",
    bodyEl: wrap,
    actions: [
      button("Back home", {
        className: "btn",
        onClick: () => {
          close();
          window.location.href = "/";
        }
      }),
      button("Create new game link", {
        className: "btn primary",
        onClick: async () => {
          try {
            const res = await fetch("/api/new", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ baseMinutes: 5, incrementSeconds: 0 })
            });
            const data = await res.json();
            window.location.href = data.url;
          } catch {
            window.location.href = "/";
          }
        }
      })
    ]
  });
}

function maybeShowGameOverOverlay() {
  if (state.ended) {
    if (state.ended.reason === "resign") {
      const winner = state.ended.winner === "w" ? "White" : "Black";
      showGameOverOverlay(`Resignation. ${winner} wins.`);
      return;
    }
    if (state.ended.reason === "flag") {
      showGameOverOverlay("Time is up. Flag fall.");
      return;
    }
    showGameOverOverlay("Game over.");
    return;
  }
  if (!state.chess.isGameOver()) return;
  if (state.chess.isCheckmate()) {
    const winner = state.turn === "w" ? "Black" : "White";
    showGameOverOverlay(`Checkmate. ${winner} wins.`);
    return;
  }
  if (state.chess.isStalemate()) {
    showGameOverOverlay("Stalemate. Draw.");
    return;
  }
  showGameOverOverlay("Game over.");
}

function updateClocks() {
  clockWhiteTime.textContent = formatClock(state.clocks.w);
  clockBlackTime.textContent = formatClock(state.clocks.b);
  clockWhiteBtn.classList.toggle("active", state.turn === "w" && !state.chess.isGameOver());
  clockBlackBtn.classList.toggle("active", state.turn === "b" && !state.chess.isGameOver());

  clockWhiteBtn.classList.toggle("you", isPlayer() && state.color === "w");
  clockBlackBtn.classList.toggle("you", isPlayer() && state.color === "b");
}

function setPresence(p) {
  state.presence = p;
  presenceWhite.classList.toggle("on", Boolean(p.w));
  presenceWhite.classList.toggle("off", !p.w);
  presenceBlack.classList.toggle("on", Boolean(p.b));
  presenceBlack.classList.toggle("off", !p.b);
  presenceWhite.title = p.w ? "Connected" : "Disconnected";
  presenceBlack.title = p.b ? "Connected" : "Disconnected";
}

function clearDrag() {
  if (!state.dragging) return;
  try {
    boardEl.releasePointerCapture?.(state.dragging.pointerId);
  } catch {
    // ignore
  }
  if (state.dragging.ghost) state.dragging.ghost.remove();
  if (state.dragging.pieceEl) state.dragging.pieceEl.style.opacity = "1";
  state.dragging = null;
}

function pieceAt(square) {
  const pieces = parseFenPieces(state.fen || state.chess.fen());
  return pieces.get(square) || null;
}

function sameColorPiece(letter, color) {
  if (!letter) return false;
  const isUpper = letter === letter.toUpperCase();
  return color === "w" ? isUpper : !isUpper;
}

function onPointerDownSquare(e) {
  Sfx.resume();
  if (!isPlayer()) return;
  if (!myTurn()) return;
  if (!canInteract()) return;
  if (state.staged) return; // finish staged move first

  const sq = e.currentTarget.dataset.square;
  const letter = pieceAt(sq);
  if (!letter) return;
  if (!sameColorPiece(letter, state.color)) return;

  // show highlights immediately
  showHighlights(sq);

  // begin drag
  const img = $all("img.piece", boardEl).find((p) => p.dataset.square === sq);
  if (!img) return;

  const ghost = img.cloneNode(true);
  ghost.classList.add("dragGhost");
  ghost.style.left = `${e.clientX}px`;
  ghost.style.top = `${e.clientY}px`;
  dragLayer.appendChild(ghost);
  img.style.opacity = "0";

  state.dragging = {
    from: sq,
    pieceEl: img,
    ghost,
    pointerId: e.pointerId
  };
  e.currentTarget.setPointerCapture(e.pointerId);
  e.preventDefault();
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function onPointerMove(e) {
  if (!state.dragging) return;
  // Keep the piece under the cursor/finger and inside the viewport.
  const pad = 16;
  const x = clamp(e.clientX, pad, window.innerWidth - pad);
  const y = clamp(e.clientY, pad, window.innerHeight - pad);
  state.dragging.ghost.style.left = `${x}px`;
  state.dragging.ghost.style.top = `${y}px`;
}

function squareFromPoint(x, y) {
  const r = boardEl.getBoundingClientRect();
  if (x < r.left || x > r.right || y < r.top || y > r.bottom) return null;
  const relX = x - r.left;
  const relY = y - r.top;
  const sqX = Math.floor(relX / (r.width / 8));
  const sqY = Math.floor(relY / (r.height / 8));
  const file = state.orientation === "w" ? sqX : 7 - sqX;
  const rank = state.orientation === "w" ? 7 - sqY : sqY;
  return squareName(file, rank);
}

async function stageMove(from, to) {
  const moves = state.chess.moves({ square: from, verbose: true });
  const chosen = moves.find((m) => m.to === to);
  if (!chosen) return false;

  if (chosen.flags.includes("p")) {
    // promotion; ask user
    const promo = await choosePromotion();
    if (!promo) return false;
    state.staged = { from, to, promotion: promo };
  } else {
    state.staged = { from, to };
  }
  updateStatus();
  tapHint.textContent = "Tap your clock to play the staged move.";
  return true;
}

function choosePromotion() {
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.innerHTML = `<div style="color:rgba(255,255,255,.75);font-size:13px">Choose a piece:</div>`;
    const grid = document.createElement("div");
    grid.className = "promoChoices";
    wrap.appendChild(grid);

    const close = showModal({
      title: "Promotion",
      bodyEl: wrap,
      actions: [
        button("Cancel", {
          className: "btn",
          onClick: () => {
            close();
            resolve(null);
          }
        })
      ]
    });

    const choices = [
      { p: "q", label: "Queen" },
      { p: "r", label: "Rook" },
      { p: "b", label: "Bishop" },
      { p: "n", label: "Knight" }
    ];

    for (const c of choices) {
      const d = document.createElement("button");
      d.className = "promoChoice";
      d.type = "button";
      d.textContent = c.label;
      d.addEventListener("click", () => {
        close();
        resolve(c.p);
      });
      grid.appendChild(d);
    }
  });
}

function onPointerUp(e) {
  if (!state.dragging) return;
  const to = squareFromPoint(e.clientX, e.clientY);
  const { from, pieceEl } = state.dragging;
  pieceEl.style.opacity = "1";
  state.dragging.ghost.remove();
  state.dragging = null;

  if (!to || to === from) {
    clearSquareOverlays();
    updateStatus();
    return;
  }

  stageMove(from, to).then((ok) => {
    if (!ok) {
      clearSquareOverlays();
      Sfx.error();
    } else {
      // Keep highlights of staged move
      clearSquareOverlays();
      const sel = document.createElement("div");
      sel.className = "selectedGlow";
      addOverlay(from, sel);
      const dot = document.createElement("div");
      dot.className = "hintDot";
      addOverlay(to, dot);
      Sfx.move();
    }
    updateStatus();
  });
}

function tapMyClock() {
  Sfx.resume();
  if (!isPlayer()) return;
  if (!myTurn()) return;
  if (!canInteract()) return;
  Sfx.clockTap();
  if (!state.staged) return;
  socket.emit("playMove", state.staged);
  state.staged = null;
  tapHint.textContent = "Drag a piece. Tap your clock to play the move.";
  clearSquareOverlays();
  updateStatus();
}

function roleLabel(from) {
  if (from === "w") return "White";
  if (from === "b") return "Black";
  return "Spectator";
}

function appendChatMessage(msg, { scroll = true } = {}) {
  if (!chatLog) return;
  const atBottom = chatLog.scrollTop + chatLog.clientHeight >= chatLog.scrollHeight - 24;

  const row = document.createElement("div");
  row.className = "chatMsg";
  const t = new Date(msg.ts || Date.now());
  const hh = String(t.getHours()).padStart(2, "0");
  const mm = String(t.getMinutes()).padStart(2, "0");
  row.innerHTML = `<span class="chatMeta">[${hh}:${mm}] ${roleLabel(msg.from)}:</span> ${escapeHtml(
    msg.text || ""
  )}`;
  chatLog.appendChild(row);

  if (scroll && atBottom) chatLog.scrollTop = chatLog.scrollHeight;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderChat(messages) {
  if (!chatLog) return;
  chatLog.innerHTML = "";
  for (const m of messages || []) appendChatMessage(m, { scroll: false });
  chatLog.scrollTop = chatLog.scrollHeight;
}

function applyServerState(s) {
  state.fen = s.fen;
  state.turn = s.turn;
  state.clocks = s.clocks || state.clocks;
  if (s.timeControl?.baseMs != null) state.timeControl = s.timeControl;
  state.taken = computeTakenFromPgn(s.pgn);
  state.ended = s.ended || null;
  state.chat = Array.isArray(s.chat) ? s.chat : state.chat;
  state.chess.load(state.fen);
  state.lastMove = s.lastMove || null;
  updateClocks();
  updateStatus();
  renderPieces();
  renderTakenTray(takenByWhite, state.taken.w);
  renderTakenTray(takenByBlack, state.taken.b);
  renderChat(state.chat);
  maybeShowGameOverOverlay();

  if (s.lastMove?.flags?.includes("c")) Sfx.capture();
  else if (s.lastMove) Sfx.move();
}

function setRole({ role, color }) {
  state.role = role;
  state.color = color;
  state.orientation = color || "w";
  spectateBtn.classList.toggle("hidden", role !== "spectator");
  tapHint.classList.toggle("hidden", role === "spectator");
  spectatorHint.classList.toggle("hidden", role !== "spectator");
  undoBtn.disabled = role !== "player";
  redoBtn.disabled = role !== "player";

  if (resignWhiteBtn) resignWhiteBtn.disabled = !(role === "player" && color === "w");
  if (resignBlackBtn) resignBlackBtn.disabled = !(role === "player" && color === "b");
}

function runAvatarEmote(target, type) {
  const el = target === "w" ? avatarWhite : avatarBlack;
  el.classList.remove(
    "emote-think",
    "emote-yawn",
    "emote-drink",
    "emote-slam",
    "emote-cheer"
  );
  // ensure reflow so animation restarts
  // eslint-disable-next-line no-unused-expressions
  el.offsetWidth;
  el.classList.add(`emote-${type}`);

  let bubble = el.querySelector(".bubble");
  if (!bubble) {
    bubble = document.createElement("div");
    bubble.className = "bubble";
    el.appendChild(bubble);
  }
  const text = {
    think: "…",
    yawn: "Zzz",
    drink: "Sip",
    slam: "Bam!",
    cheer: "Yay!"
  }[type] || "!";
  bubble.textContent = text;
  el.classList.add("show-bubble");
  setTimeout(() => el.classList.remove("show-bubble"), 900);

  if (type === "slam") {
    triggerBam(target);
  }
}

// Wire events
window.addEventListener("pointermove", onPointerMove, { passive: true });
window.addEventListener("pointerup", onPointerUp, { passive: true });
window.addEventListener("pointercancel", () => clearDrag(), { passive: true });

if (takenByWhite) takenByWhite.addEventListener("click", () => triggerBam("w"));
if (takenByBlack) takenByBlack.addEventListener("click", () => triggerBam("b"));

clockWhiteBtn.addEventListener("click", tapMyClock);
clockBlackBtn.addEventListener("click", tapMyClock);

$all(".playerCard").forEach((card) => {
  card.addEventListener("click", (e) => {
    const btn = e.target.closest(".emoteBtn");
    if (!btn) return;
    Sfx.resume();
    const type = btn.dataset.emote;
    socket.emit("emote", { type });
    Sfx.emote();
  });
});

undoBtn.addEventListener("click", () => {
  Sfx.resume();
  socket.emit("offerUndo");
  statusText.textContent = "Undo requested…";
});

redoBtn.addEventListener("click", () => {
  Sfx.resume();
  socket.emit("redo");
});

shareBtn.addEventListener("click", async () => {
  Sfx.resume();
  const url = window.location.href;
  const ok = await shareText({
    title: "Online Chess",
    text: "Join my chess game",
    url
  });
  if (!ok) {
    await navigator.clipboard.writeText(url);
    shareBtn.textContent = "Copied";
    setTimeout(() => (shareBtn.textContent = "Share link"), 900);
  }
});

function confirmResign() {
  const wrap = document.createElement("div");
  wrap.innerHTML = `<div style="color:rgba(255,255,255,.82);font-size:13px">Are you sure you want to resign?</div>`;
  const close = showModal({
    title: "Resign",
    bodyEl: wrap,
    actions: [
      button("Cancel", { className: "btn", onClick: () => close() }),
      button("Resign", {
        className: "btn danger",
        onClick: () => {
          socket.emit("resign");
          close();
        }
      })
    ]
  });
}

if (resignWhiteBtn) resignWhiteBtn.addEventListener("click", () => confirmResign());
if (resignBlackBtn) resignBlackBtn.addEventListener("click", () => confirmResign());

function sendChat() {
  if (!chatInput) return;
  Sfx.resume();
  const text = chatInput.value.trim();
  if (!text) return;
  socket.emit("chat", { text });
  chatInput.value = "";
}

if (chatSend) chatSend.addEventListener("click", sendChat);
if (chatInput)
  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendChat();
  });

socket.on("connect", async () => {
  statusText.textContent = "Joining…";
  socket.emit("joinGame", { gameId });
});

socket.on("init", async (s) => {
  setRole({ role: s.role, color: s.color });
  await buildBoardSquares();
  setPresence(s.playersPresent);
  applyServerState(s);
  const baseMin = Math.round((state.timeControl.baseMs || 0) / 60000);
  const incSec = Math.round((state.timeControl.incrementMs || 0) / 1000);
  if (baseMin > 0) gameIdLabel.textContent = `#${gameId} · ${baseMin}+${incSec}`;
  statusText.textContent =
    state.role === "spectator"
      ? "Spectating. Enjoy the show."
      : state.color === "w"
        ? "You are White."
        : "You are Black.";
});

socket.on("presence", (s) => {
  setPresence(s.playersPresent);
});

socket.on("state", (s) => {
  applyServerState(s);
});

socket.on("clock", (clocks) => {
  state.clocks = clocks;
  updateClocks();
});

socket.on("flag", ({ clocks }) => {
  state.clocks = clocks;
  updateClocks();
  statusText.textContent = "Flag fall. Time is up.";
  state.ended = { reason: "flag", winner: state.turn === "w" ? "b" : "w" };
  showGameOverOverlay("Time is up. Flag fall.");
});

socket.on("emote", ({ type, from }) => {
  if (!type) return;
  const target = from === "w" ? "w" : from === "b" ? "b" : null;
  if (target) runAvatarEmote(target, type);
  Sfx.emote();
});

socket.on("chat", (msg) => {
  state.chat.push(msg);
  if (state.chat.length > 200) state.chat.splice(0, state.chat.length - 200);
  appendChatMessage(msg);
});

socket.on("undoOffered", ({ by }) => {
  if (state.role === "spectator") return;
  const wrap = document.createElement("div");
  wrap.innerHTML = `<div style="color:rgba(255,255,255,.82);font-size:13px">Opponent requested an undo. Accept?</div>`;
  const close = showModal({
    title: "Undo request",
    bodyEl: wrap,
    actions: [
      button("Decline", {
        className: "btn",
        onClick: () => {
          socket.emit("respondUndo", { accept: false });
          close();
        }
      }),
      button("Accept", {
        className: "btn primary",
        onClick: () => {
          socket.emit("respondUndo", { accept: true });
          close();
        }
      })
    ]
  });
});

socket.on("undoResult", ({ accepted }) => {
  if (!accepted) statusText.textContent = "Undo declined.";
  else statusText.textContent = "Undone.";
});

