// Tests the "why" coach (site/js/why.js) against the real engine: Stockfish 18
// lite, the same build the site runs, through the same line reader (uci.js).
// Each case is a known position, the move played, and the reason the coach
// must give. The engine searches to a fixed depth with a fresh hash, so runs
// repeat exactly. Run with `npm test` (needs `npm install` once).
import { Chess } from '../site/vendor/chess.js';
import { collector, parseInfo } from '../site/js/uci.js';
import { explainMove, flip, TAG_INFO, GOOD_LESSON } from '../site/js/why.js';
import { CURRICULUM } from '../site/js/curriculum.js';
import { startEngine } from './node-engine.mjs';

// tag: the reason the coach must name. null = no confirmed reason, so the
// honest "The engine prefers X. It keeps ... (+a instead of +b)." line.
// depths: the search depths it must hold at (phones search less deeply).
const CASES = [
  // The nine asked for.
  { name: 'Fork', fen: 'r1bq1rk1/ppp2ppp/3p4/8/6n1/1BNP4/PPP2PPP/R2Q1RK1 w - - 0 15', move: 'f3', tag: 'fork' },
  { name: 'Pin', fen: '6k1/1b3p2/7p/6p1/8/5N2/5P1P/5K2 w - - 0 1', move: 'Kg2', tag: 'pin' },
  { name: 'Skewer', fen: '8/6k1/8/8/8/r7/2K5/7R w - - 0 1', move: 'Kd1', tag: 'skewer' },
  { name: 'Hanging piece', moves: 'd4 d5 c4 e6 Nc3 h6', move: 'Bg5', tag: 'hang' },
  { name: 'Back-rank mate', fen: '4r1k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', move: 'Rd7', tag: 'backRank' },
  { name: 'Mate in 1 missed', fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4', move: 'Qf3', tag: 'missedMate' },
  { name: 'Early queen', moves: 'e4 e5', move: 'Qg4', tag: 'earlyQueen' },
  { name: 'Free capture missed', fen: 'r4rk1/ppp2ppp/8/3q4/8/2N5/PPP2PPP/R4RK1 w - - 0 1', move: 'Rfe1', tag: 'missedFree' },
  { name: 'Quiet move: honest generic line', fen: 'r1bq1rk1/2p1bppp/p2p1n2/np2p3/4P3/1BP2N1P/PP1P1PP1/RNBQR1K1 w - - 1 10', move: 'Kh1', tag: null },
  // More reasons the coach can give.
  { name: 'Losing trade', moves: 'e4 e5 Nf3 Nc6', move: 'Nxe5', tag: 'trade' },
  { name: 'Removing the defender', fen: '4r1k1/5pp1/7p/8/1b2B3/2N5/1P3PPP/4R1K1 w - - 0 1', move: 'Rd1', tag: 'removeDefender' },
  { name: 'Discovered attack', fen: '4r1k1/5ppp/8/4n3/8/8/3Q1PPP/6K1 w - - 0 1', move: 'Qe2', tag: 'discovered' },
  { name: 'Fork already threatened', fen: '3r1rk1/pp3ppp/2pq1n2/5b2/2BP4/2R2N1P/PP1Q1PP1/4R1K1 w - - 3 18', move: 'a3', tag: 'fork', says: /already threatening/ },
  { name: 'Missed fork', fen: 'r3k3/5ppp/8/1N6/8/8/5PPP/4K3 w - - 0 1', move: 'Kd2', tag: 'missedFork' },
  { name: 'Castling given up', moves: 'e4 e5', move: 'Ke2', tag: 'castleLost' },
  { name: 'Stalemate when winning', fen: 'k7/8/1K6/2Q5/8/8/8/8 w - - 0 1', move: 'Qc7', tag: 'stalemate' },
  { name: 'Opposition', fen: '8/8/4k3/8/5K2/2P5/8/8 w - - 0 40', move: 'Kg3', tag: 'opposition' },
  { name: 'Passed pawn held back', fen: '8/8/8/p4P2/1k6/8/8/K7 w - - 0 40', move: 'Kb2', tag: 'passer' },
  { name: 'Pawn race lost', fen: '8/8/2k5/3p3K/8/8/5P2/8 w - - 0 40', move: 'f3', tag: 'passerAllowed', depths: [14] },
  // The Hint button explains the engine's own move.
  { name: 'Hint: why this move (fork)', fen: 'r3k3/5ppp/8/1N6/8/8/5PPP/4K3 w - - 0 1', hint: true, tag: 'win-fork' },
];

const DEPTHS = [12, 14];
const BRITISH = /\b(colour|centre|favour|honour|behaviour|defence|offence|organis|recognis|analys(e|ed|ing)\b|programme|catalogue|travelled|cancelled|labelled|cheque|manoeuvr|practise|whilst|amongst|towards)/i;
const failures = [];
const fail = (msg) => { failures.push(msg); return false; };

function textOf(e) {
  return [e.headline, ...e.why, e.better && e.better.why].filter(Boolean);
}
function checkWords(name, e) {
  let ok = true;
  for (const s of textOf(e)) {
    if (/—/.test(s)) ok = fail(`${name}: em dash in "${s}"`);
    if (BRITISH.test(s)) ok = fail(`${name}: British spelling in "${s}"`);
    const words = s.split(/\s+/).length;
    if (words > 26) ok = fail(`${name}: sentence too long (${words} words): "${s}"`);
  }
  return ok;
}

// ---- 1. The line reader (no engine needed) ----
{
  const c = collector();
  c.add('info depth 10 seldepth 14 multipv 1 score cp 35 nodes 1000 pv e2e4 e7e5 g1f3');
  c.add('info depth 10 seldepth 12 multipv 2 score cp 20 lowerbound nodes 1000 pv d2d4');
  c.add('info depth 10 seldepth 12 multipv 2 score cp 18 nodes 1100 pv d2d4 d7d5');
  c.add('info depth 11 seldepth 15 multipv 1 score mate 3 nodes 2000 pv e2e4 e7e5');
  c.add('info depth 11 currmove e2e4 currmovenumber 1');
  const l = c.lines();
  const ok = l.length === 2 && l[0].score.mate === 3 && l[0].depth === 11 && l[1].score.cp === 18 && l[1].pv.join(' ') === 'd2d4 d7d5' && parseInfo('bestmove e2e4') === null;
  console.log(`${ok ? 'PASS' : 'FAIL'}  UCI line reader (MultiPV, bounds, mate scores)`);
  if (!ok) fail('UCI line reader');
}

// ---- 2. Every reason links to a real lesson and blunder category ----
{
  const cats = new Set(CURRICULUM.blunders.categories.map((c) => c.name));
  const lessons = new Set();
  for (const lv of CURRICULUM.levels) for (const ls of lv.lessons) lessons.add(lv.id + '/' + ls.id);
  let ok = true;
  for (const [tag, info] of Object.entries(TAG_INFO)) {
    if (!cats.has(info.category)) ok = fail(`TAG_INFO.${tag}: category "${info.category}" is not in the curriculum`);
    if (!lessons.has(info.lesson)) ok = fail(`TAG_INFO.${tag}: lesson "${info.lesson}" is not in the curriculum`);
  }
  for (const [tag, lesson] of Object.entries(GOOD_LESSON)) {
    if (!lessons.has(lesson)) ok = fail(`GOOD_LESSON.${tag}: lesson "${lesson}" is not in the curriculum`);
  }
  console.log(`${ok ? 'PASS' : 'FAIL'}  Every reason links to a lesson and a category (${Object.keys(TAG_INFO).length} reasons, ${Object.keys(GOOD_LESSON).length} good-move lessons)`);
}

// ---- 3. Known positions against the engine ----
const eng = await startEngine();
let slowest = 0;
for (const c of CASES) {
  let fen = c.fen;
  if (c.moves) {
    const ch = new Chess();
    for (const m of c.moves.split(' ')) ch.move(m);
    fen = ch.fen();
  }
  const results = [];
  let ok = true;
  let last = null;
  for (const depth of c.depths || DEPTHS) {
    const pre = await eng.analyze(fen, { depth, multipv: 3 });
    let move = c.move;
    let post;
    if (c.hint) {
      // As the app does: the hint is the top line; its own continuation is the reply.
      move = pre[0].pv[0];
      post = { pv: pre[0].pv.slice(1), score: flip(pre[0].score) };
    } else {
      const after = new Chess(fen);
      const mv = after.move(move);
      const ac = new Chess(mv.after);
      post = ac.isGameOver() ? null : (await eng.analyze(mv.after, { depth, multipv: 1 }))[0];
    }
    const t0 = performance.now();
    const e = explainMove({ fen, move, pre, post, hint: !!c.hint });
    slowest = Math.max(slowest, performance.now() - t0);
    last = e;
    results.push(`d${depth} ${e.label}/${e.tag || 'none'}`);
    const name = `${c.name} (depth ${depth})`;
    if (e.tag !== c.tag) ok = fail(`${name}: expected reason "${c.tag}", got "${e.tag}" (${e.headline} ${e.why.join(' ')})`);
    if (!c.hint && c.tag !== null && !['inaccuracy', 'mistake', 'blunder'].includes(e.grade)) ok = fail(`${name}: expected a flagged grade, got ${e.grade}`);
    if (c.tag === null) {
      if (!/^The engine prefers \S+\.$/.test(e.headline)) ok = fail(`${name}: generic headline wrong: "${e.headline}"`);
      if (!/\([+-]?\d+\.\d instead of [+-]?\d+\.\d\)\.$/.test(e.why[0] || '')) ok = fail(`${name}: generic line has no score comparison: "${e.why[0]}"`);
    }
    if (c.says && !c.says.test(textOf(e).join(' '))) ok = fail(`${name}: text does not match ${c.says}`);
    if (!c.hint && c.tag !== null && !(e.better && e.better.san)) ok = fail(`${name}: no better move given`);
    if (!checkWords(name, e)) ok = false;
  }
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name.padEnd(34)} ${results.join('  ')}`);
  console.log(`        ${[last.headline, ...last.why].join(' ')}${last.better && last.better.why ? `  Better: ${last.better.san}. ${last.better.why}` : last.better ? `  Better: ${last.better.san}.` : ''}`);
}
eng.quit();

// ---- 4. Fast enough for a phone's main thread ----
{
  const ok = slowest < 60;
  console.log(`${ok ? 'PASS' : 'FAIL'}  Slowest explanation took ${slowest.toFixed(1)} ms (limit 60 ms)`);
  if (!ok) fail('explanations too slow');
}

if (failures.length) {
  console.error(`\n${failures.length} problem(s):\n- ` + failures.join('\n- '));
  process.exit(1);
}
console.log('\nAll checks passed.');
process.exit(0);
