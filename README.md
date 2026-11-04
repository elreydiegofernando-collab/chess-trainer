# Chess Trainer

A small, **offline** desktop chess app for learning. Play full games against a built-in
engine (or a friend, pass-and-play), then copy the game and paste it to Claude in chat
for a beginner-friendly review. No accounts, no internet, no API keys, no cost.

## Launch it

- **Desktop shortcut:** double-click **“Chess Trainer”** on your Desktop.
- **Or from a terminal:**
  ```powershell
  cd chess-trainer
  npm start
  ```

## How to use

1. **Set up the game** (right panel):
   - **Opponent** — *Computer* or *Pass & play* (you move both sides).
   - **You play** — White or Black (vs. Computer).
   - **Difficulty** — Very easy → Very hard. You can change this mid-game; it affects
     the engine’s next move.
2. **Play.** Click a piece to see its legal moves (dot = move, ring = capture), then click
   the destination. Pawns reaching the last rank show a promotion picker. The panel tracks
   the move list and captured material.
3. **Controls** under the board: **New**, **Undo** (or the Left-arrow key), **Flip**.
4. **Review with Claude:** click **Copy game for Claude review**, switch to your Claude
   chat, and **paste**. Claude gets the full game (PGN), result, and final position, with a
   prompt asking it to coach you. (`Copy PGN` / `Copy FEN` are there for the raw records.)

## How it's built

- **Electron** desktop shell (`main.js`, `preload.js`).
- **Stockfish 18** (lite, single-threaded WASM) runs in the **main process** and serves
  moves to the UI over IPC — fully offline, no worker/CORS headaches.
- **chess.js** (vendored in `vendor/chess.js`) handles rules, legality, check/mate/draw,
  and PGN/FEN.
- **`renderer/`** is a plain HTML/CSS/JS UI (`index.html`, `styles.css`, `renderer/app.js`).
  No build step.
- App icon: `assets/chess.ico`.

## Note on the engine binary

Electron’s runtime binary is downloaded into `node_modules/electron/dist/` on install.
If the app won’t launch, run `node node_modules/electron/install.js` (or `npm install`)
to (re)fetch it.
