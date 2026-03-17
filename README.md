## Online Chess (shareable link)

### What you get
- **Multiplayer via link**: create a game, share the URL (WhatsApp etc.), second player joins instantly; extra visitors become spectators.
- **Real-time updates**: moves, clocks, presence, and emotes sync live via websockets.
- **Rules enforced**: castling, en passant, promotion, check/checkmate/stalemate via `chess.js`.
- **Board feel**: wooden-table background, textured 2D pieces with shadows, smooth drag/drop, valid-move highlights.
- **Clocks**: server-authoritative countdown clocks; clocks indicate whose turn it is.
- **Avatars + emotes**: cartoon avatars with animated emotes (yawn, drink, slam, cheer, think).
- **Extras**: undo (with opponent approval), redo (after undo), subtle synthesized sound effects.

### Run locally (Windows / PowerShell)
```bash
npm install
npm run dev
```

Open `http://localhost:3000` in two different browsers/devices on the same network to test.

### Customize
- **Time control**: pick it when creating the game link on `/` (base minutes + increment seconds).
- **Look & feel**: edit `public/styles.css`.
- **Piece art**: SVGs in `public/assets/pieces/`.


##Author: Rammyajit Deb
