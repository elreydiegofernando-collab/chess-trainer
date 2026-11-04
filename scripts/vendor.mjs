// Copies the third-party files the site uses from node_modules into site/vendor/.
// Only needed to update chess.js or Stockfish: change the versions in
// package.json, run `npm install`, then `npm run vendor`. (The engine file names
// carry the Stockfish major version; update them here, in js/engine.js, sw.js
// and vendor/stockfish/SOURCE.md when it changes.)
import { copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const COPIES = [
  ['node_modules/chess.js/dist/esm/chess.js', 'site/vendor/chess.js'],
  ['node_modules/stockfish/bin/stockfish-18-lite-single.js', 'site/vendor/stockfish/stockfish-18-lite-single.js'],
  ['node_modules/stockfish/bin/stockfish-18-lite-single.wasm', 'site/vendor/stockfish/stockfish-18-lite-single.wasm'],
  ['node_modules/stockfish/Copying.txt', 'site/vendor/stockfish/Copying.txt'],
];

for (const [from, to] of COPIES) {
  copyFileSync(resolve(ROOT, from), resolve(ROOT, to));
  console.log(`${from} -> ${to}`);
}
