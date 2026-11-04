# Chess Trainer

A phone-friendly chess app for learning, running in the browser. Play full games
against the Stockfish engine (or a friend, pass and play), work through a
beginner-to-master lesson roadmap with daily review, then copy the game and paste
it to Claude in chat for a beginner-friendly review.

**Open it: https://elreydiegofernando-collab.github.io/chess-trainer/**

No accounts, no ads, no tracking, no API keys, no cost. Progress is saved in your
browser on that device. After the first visit it works offline.

## Put it on your home screen

- **iPhone (Safari):** Share, then **Add to Home Screen**.
- **Android (Chrome):** the menu, then **Install app** (or **Add to Home screen**).

It then opens full screen like an app. On iPhone, keep it on the home screen:
Safari can clear saved progress for websites that are not visited for a while,
but not for home-screen apps.

## How to use

1. **Set up the game** (below the board on a phone, beside it on a computer):
   - **Opponent:** *Computer* or *Pass & play* (you move both sides).
   - **You play:** White or Black (against the computer).
   - **Difficulty:** Very easy to Very hard. You can change it mid-game; it affects
     the engine's next move.
   - **Practice:** checkmate drills (K+Q, K+R, two rooks) and a K+P endgame.
   - **Coach mode** warns you before a blunder and gives opening tips; the
     **Checks · Captures · Threats** reminder shows before each of your moves.
2. **Play.** Tap a piece to see its legal moves (dot = move, ring = capture), then
   tap the square. Pawns reaching the last rank show a promotion picker. The panel
   tracks the opening, the move list, captured material and the engine's evaluation.
3. **Controls** under the board: **New**, **Undo** (or the Left-arrow key on a
   keyboard), **Flip**, **Hint** (draws the engine's suggestion as an arrow).
4. **Review my game (engine)** marks blunders, mistakes and inaccuracies, shows the
   better move, and can save any of them as a puzzle for your daily review.
5. **Review with Claude:** tap **Copy game for Claude review**, switch to your
   Claude chat, and paste. Claude gets the full game (PGN), result and final
   position, with a prompt asking it to coach you. **Copy PGN** and **Copy FEN**
   are there for the raw records. If the browser blocks copying, the text appears
   on screen, selected, so you can copy it yourself.
6. **Learn tab:** a 12-level roadmap (each level unlocks when the one before it is
   done), lessons, **Daily review** (spaced repetition of lesson ideas and puzzles),
   a reference of every kind of blunder, and a study plan.

## How it's built

- Plain HTML, CSS and JavaScript with no build step. `site/` is exactly what
  GitHub Pages serves.
- **Stockfish 18** (lite, single-threaded WebAssembly) runs in a Web Worker
  (`site/js/engine.js`). It is the single-threaded build because GitHub Pages
  cannot send the cross-origin isolation headers the multi-threaded build needs.
- **chess.js 1.4.0** (`site/vendor/chess.js`) handles the rules, legal moves,
  check, mate and draws, and PGN/FEN.
- The pieces come from a small subset of **Noto Sans Symbols 2** so they look the
  same on every phone.
- A service worker (`site/sw.js`) keeps a copy of everything for offline use.
- Every push to `main` deploys through GitHub Actions
  (`.github/workflows/deploy.yml`), which also checks the site files and gives each
  deploy a fresh offline cache.
- Search engines are asked not to list it (a `noindex` robots meta tag, plus a
  `robots.txt`).

## Run it on a computer

Needs Node.js 18 or newer. Nothing to install:

```
npm start
```

Then open http://localhost:8080/. `npm run check` checks that every site file
exists and is in the offline list.

To update chess.js or Stockfish: change the version in `package.json`, run
`npm install`, then `npm run vendor` to copy the new files into `site/vendor/`.

## Licenses

- This app's own code: ISC, see `LICENSE`.
- Stockfish 18, via Stockfish.js 18.0.8 (`site/vendor/stockfish/`): GNU GPL v3,
  full text in `site/vendor/stockfish/Copying.txt`. The files are unmodified from
  the npm package. Source code:
  [Stockfish.js v18.0.8](https://github.com/nmrugg/stockfish.js/tree/v18.0.8) and
  [Stockfish 18](https://github.com/official-stockfish/Stockfish/tree/sf_18);
  details and checksums in `site/vendor/stockfish/SOURCE.md`.
- chess.js 1.4.0 (`site/vendor/chess.js`): BSD 2-Clause, notice inside the file.
  Source: https://github.com/jhlywa/chess.js
- Noto Sans Symbols 2, chess glyph subset (`site/vendor/fonts/`): SIL Open Font
  License 1.1, see `site/vendor/fonts/OFL.txt`. Source:
  https://github.com/notofonts/symbols

## History

This started as an offline Electron desktop app; the first commit in this
repository is that version, where Stockfish ran in Electron's main process
(`main.js`, `preload.js`). The web version replaced that shell with the Web Worker
and reworked the layout for phones.
