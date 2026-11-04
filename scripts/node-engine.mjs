// Stockfish 18 lite (single-threaded), the same build the site runs, driven
// from Node for the tests. Lines are read with site/js/uci.js, exactly as the
// browser does. Needs `npm install` (the stockfish package is a dev dependency).
import { createRequire } from 'node:module';
import { collector } from '../site/js/uci.js';

const require = createRequire(import.meta.url);

export async function startEngine() {
  const initEngine = require('stockfish');
  const sf = await initEngine('lite-single');
  const handlers = new Set();
  sf.listener = (line) => {
    for (const h of [...handlers]) h(String(line));
  };
  const send = (cmd) => sf.sendCommand(cmd);
  const waitFor = (test) =>
    new Promise((resolve) => {
      const h = (l) => {
        if (test(l)) {
          handlers.delete(h);
          resolve(l);
        }
      };
      handlers.add(h);
    });
  send('uci');
  await waitFor((l) => l === 'uciok');
  send('isready');
  await waitFor((l) => l === 'readyok');

  let queue = Promise.resolve();
  // One search at a time. A fresh hash for each, so results repeat run to run.
  function analyze(fen, { depth = 14, multipv = 1 } = {}) {
    const run = queue.then(async () => {
      send('ucinewgame');
      send('setoption name MultiPV value ' + multipv);
      send('isready');
      await waitFor((l) => l === 'readyok');
      const col = collector();
      const h = (l) => col.add(l);
      handlers.add(h);
      send('position fen ' + fen);
      send('go depth ' + depth);
      await waitFor((l) => l.startsWith('bestmove'));
      handlers.delete(h);
      return col.lines();
    });
    queue = run.catch(() => {});
    return run;
  }
  return {
    analyze,
    quit() {
      try { send('quit'); } catch (_) {}
    },
  };
}
