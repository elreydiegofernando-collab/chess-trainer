// Bridges the sandboxed renderer to the main-process Stockfish engine.
const { contextBridge, ipcRenderer } = require('electron');

const num = (v) => (typeof v === 'number' ? v : undefined);

contextBridge.exposeInMainWorld('engine', {
  // Returns a UCI move string (e.g. "e2e4") or "(none)".
  bestMove: (fen, opts) =>
    ipcRenderer.invoke('engine:bestmove', {
      fen,
      skill: opts ? num(opts.skill) : undefined,
      movetime: opts ? num(opts.movetime) : undefined,
    }),
  // Returns { best: "e2e4"|null, score: { cp } | { mate } | null } at full strength.
  evaluate: (fen, opts) =>
    ipcRenderer.invoke('engine:evaluate', {
      fen,
      movetime: opts ? num(opts.movetime) : undefined,
    }),
  newGame: () => ipcRenderer.invoke('engine:newgame'),
});
