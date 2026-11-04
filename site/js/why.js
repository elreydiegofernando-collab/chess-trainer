// The "why" coach: says in plain words why a move is good or bad, which move
// was better and why, and which lesson teaches the idea.
//
// explainMove() takes a position, the move played and Stockfish's lines:
//   pre:  the engine's lines before the move (MultiPV, best first),
//   post: the engine's best line after the move.
// Each line is { pv: ['e2e4', ...], score: { cp } | { mate } } with the score
// from the side to move, as uci.js reads them.
//
// The rule: a reason is claimed only when the engine's line shows it. "This
// hangs your knight" needs the engine's reply to actually win the knight; "this
// allows a fork" needs the engine's line to fork and then win material. When
// nothing is confirmed it says so plainly and compares the engine's scores.
//
// Pure functions on top of chess.js, so the Node tests (scripts/test-why.mjs)
// run exactly this code against the real engine.
import { Chess } from '../vendor/chess.js';

const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const NAME = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const MATE = 100000;
const HORIZON = 7; // plies of an engine line trusted when counting material

export const GRADE_LABEL = { best: 'Best', good: 'Good', inaccuracy: 'Inaccuracy', mistake: 'Mistake', blunder: 'Blunder' };
export const GRADE_MARK = { best: '', good: '', inaccuracy: '?!', mistake: '?', blunder: '??' };
export const isFlagged = (grade) => grade === 'inaccuracy' || grade === 'mistake' || grade === 'blunder';

// Each confirmed reason maps to a blunder category (the exact name in
// CURRICULUM.blunders.categories) and the lesson ("levelId/lessonId") that
// teaches it. `label` finishes the sentence "You have ... N times."
const CAT = {
  hang: 'Hanging a Piece (One-Move Blunder)',
  threat: "Missing the Opponent's Immediate Threat",
  mate: 'Failing to Recognize Checkmate Threats (Back-Rank, Smothered, etc.)',
  trade: 'Losing Material in a Simple Exchange (Miscounting Captures)',
  tactic: 'Falling for Basic Tactics (Forks, Pins, Skewers, Discovered Attacks)',
  loose: 'Allowing or Missing Double Attacks and Loose-Piece Tactics',
  develop: 'Neglecting Development in the Opening',
  castle: 'Delaying Castling / King-Safety Neglect',
  shield: "Weakening the King's Pawn Shield",
  endgame: 'Endgame Technique Errors (Conversion and Defense)',
  kingEnd: 'Mishandling Opposition, Zugzwang, and King Activity in Pawn Endings',
};
export const TAG_INFO = {
  hang: { category: CAT.hang, lesson: 'piece-safety/what-hanging-means', label: 'hung a piece' },
  threat: { category: CAT.threat, lesson: 'piece-safety/cct-blunder-check', label: 'missed a threat to one of your pieces' },
  exchange: { category: CAT.trade, lesson: 'piece-safety/counting-attackers-defenders', label: 'lost material in a trade' },
  trade: { category: CAT.trade, lesson: 'piece-safety/good-and-bad-trades', label: 'made a losing trade' },
  fork: { category: CAT.tactic, lesson: 'tactics-1/knight-forks', label: 'walked into a fork' },
  pin: { category: CAT.tactic, lesson: 'tactics-1/pins', label: 'walked into a pin' },
  skewer: { category: CAT.tactic, lesson: 'tactics-1/skewers', label: 'walked into a skewer' },
  discovered: { category: CAT.tactic, lesson: 'tactics-2/discovered-attacks-and-discovered-check', label: 'walked into a discovered attack' },
  removeDefender: { category: CAT.loose, lesson: 'tactics-2/removing-the-defender', label: 'lost a defender' },
  allowMate: { category: CAT.mate, lesson: 'basic-checkmates/what-mate-needs', label: 'allowed a checkmate' },
  backRank: { category: CAT.mate, lesson: 'basic-checkmates/back-rank-mate', label: 'allowed a back-rank mate' },
  mateThreat: { category: CAT.threat, lesson: 'piece-safety/cct-blunder-check', label: 'missed a checkmate threat' },
  missedMate: { category: CAT.mate, lesson: 'calculation/forcing-moves-first', label: 'missed a checkmate' },
  missedFree: { category: CAT.loose, lesson: 'piece-safety/what-hanging-means', label: 'missed a free piece' },
  missedFork: { category: CAT.loose, lesson: 'tactics-1/knight-forks', label: 'missed a fork' },
  missedPin: { category: CAT.tactic, lesson: 'tactics-1/pins', label: 'missed a pin' },
  missedSkewer: { category: CAT.tactic, lesson: 'tactics-1/skewers', label: 'missed a skewer' },
  missedDiscovered: { category: CAT.tactic, lesson: 'tactics-2/discovered-attacks-and-discovered-check', label: 'missed a discovered attack' },
  missedRemove: { category: CAT.loose, lesson: 'tactics-2/removing-the-defender', label: 'missed a chance to remove a defender' },
  missedExchange: { category: CAT.trade, lesson: 'piece-safety/counting-attackers-defenders', label: 'missed a winning trade' },
  stalemate: { category: CAT.endgame, lesson: 'basic-checkmates/king-queen-mate-stalemate', label: 'stalemated a won game' },
  earlyQueen: { category: CAT.develop, lesson: 'opening-principles/dont-waste-moves', label: 'brought the queen out early' },
  twice: { category: CAT.develop, lesson: 'opening-principles/dont-waste-moves', label: 'moved the same piece twice in the opening' },
  undeveloped: { category: CAT.develop, lesson: 'opening-principles/develop-knights-bishops', label: 'left pieces at home in the opening' },
  center: { category: CAT.develop, lesson: 'opening-principles/control-the-center', label: 'skipped the center in the opening' },
  castleLost: { category: CAT.castle, lesson: 'opening-principles/castle-early-connect-rooks', label: 'given up castling' },
  kingCenter: { category: CAT.castle, lesson: 'opening-principles/castle-early-connect-rooks', label: 'left your king in the center' },
  shield: { category: CAT.shield, lesson: 'attack-defense/opening-lines-toward-the-king', label: 'weakened the pawns around your king' },
  passer: { category: CAT.endgame, lesson: 'endgame-fundamentals/key-squares-and-promoting-with-the-king', label: 'held back a passed pawn' },
  passerAllowed: { category: CAT.endgame, lesson: 'endgame-fundamentals/square-of-the-pawn', label: 'let a passed pawn run' },
  activeKing: { category: CAT.kingEnd, lesson: 'endgame-fundamentals/why-endgames-and-the-active-king', label: 'kept your king out of the endgame' },
  opposition: { category: CAT.kingEnd, lesson: 'endgame-fundamentals/the-opposition', label: 'missed the opposition' },
};

// Lessons for the good things a move can do (shown with Best and Good moves).
export const GOOD_LESSON = {
  'win-fork': 'tactics-1/knight-forks',
  'win-pin': 'tactics-1/pins',
  'win-skewer': 'tactics-1/skewers',
  'win-discovered': 'tactics-2/discovered-attacks-and-discovered-check',
  'win-removeDefender': 'tactics-2/removing-the-defender',
  'win-free': 'piece-safety/what-hanging-means',
  'win-exchange': 'piece-safety/counting-attackers-defenders',
  mateDone: 'basic-checkmates/what-mate-needs',
  forcesMate: 'calculation/forcing-moves-first',
  saves: 'piece-safety/counting-attackers-defenders',
  stopsMate: 'piece-safety/cct-blunder-check',
  castles: 'opening-principles/castle-early-connect-rooks',
  develops: 'opening-principles/develop-knights-bishops',
  centerPawn: 'opening-principles/control-the-center',
  oppositionWin: 'endgame-fundamentals/the-opposition',
  pushPasser: 'endgame-fundamentals/key-squares-and-promoting-with-the-king',
  kingUp: 'endgame-fundamentals/why-endgames-and-the-active-king',
};

// ---------- scores ----------
// Centipawns for sorting and loss; mates become huge numbers (mate 0 = lost).
export function toCp(s) {
  if (!s) return 0;
  if (s.mate != null) return s.mate > 0 ? MATE - s.mate : -MATE - s.mate;
  return s.cp;
}
// The same score seen from the other side.
export function flip(s) {
  if (!s) return null;
  return s.mate != null ? { mate: -s.mate } : { cp: -s.cp };
}
// "+0.8", "-1.2", "0.0" (pawns, from the side the score belongs to).
export function fmtScore(s) {
  if (!s) return '?';
  if (s.mate != null) return s.mate > 0 ? 'mate in ' + s.mate : 'mated in ' + -s.mate;
  const n = Math.round(s.cp / 10) / 10;
  return n === 0 ? '0.0' : (n > 0 ? '+' : '') + n.toFixed(1);
}

// Winning chances from -1 to 1 for a centipawn score (the scale Lichess uses).
const chances = (cp) => 2 / (1 + Math.exp(-0.00368208 * cp)) - 1;
const SEVERITY = ['best', 'good', 'inaccuracy', 'mistake', 'blunder'];
const milder = (a, b) => (SEVERITY.indexOf(a) <= SEVERITY.indexOf(b) ? a : b);

// Grades a move from the best score before it and the score after it (both
// from the mover's side). Centipawn loss: 300 blunder, 150 mistake, 90
// inaccuracy, as the game review always used. In a game that is already won
// or lost, a big centipawn drop can change nothing, so the grade is capped by
// how much the winning chances drop (0.3 / 0.2 / 0.1). Mates follow the usual
// rule: losing a forced mate while still far ahead is only an inaccuracy.
export function gradeMove(before, after, isTop) {
  const loss = Math.max(0, toCp(before) - toCp(after));
  const bm = before && before.mate != null ? before.mate : null;
  const am = after && after.mate != null ? after.mate : null;
  let grade;
  if (bm != null && bm > 0 && !(am != null && am > 0)) {
    const a = am != null ? -MATE : after ? after.cp : 0;
    // A long mate that a quick search after the move simply did not find
    // again is not a missed mate while the game stays clearly won. Short
    // mates (3 moves or less) always count: those are the ones to learn.
    if (bm > 3 && a >= 500) grade = 'good';
    else grade = a > 999 ? 'inaccuracy' : a > 700 ? 'mistake' : 'blunder';
  } else if (am != null && am <= 0 && !(bm != null && bm <= 0)) {
    const b = before && bm == null ? before.cp : 0;
    grade = b < -999 ? 'inaccuracy' : b < -700 ? 'mistake' : 'blunder';
  } else if (bm != null && am != null) {
    // Still mating, or still being mated: fine unless it lets go of a lot.
    grade = isTop || am <= bm ? 'best' : 'good';
  } else if (isTop || loss <= 10) grade = 'best';
  else {
    const byCp = loss >= 300 ? 'blunder' : loss >= 150 ? 'mistake' : loss >= 90 ? 'inaccuracy' : 'good';
    const drop = chances(toCp(before)) - chances(toCp(after));
    const byChances = drop >= 0.3 ? 'blunder' : drop >= 0.2 ? 'mistake' : drop >= 0.1 ? 'inaccuracy' : 'good';
    grade = milder(byCp, byChances);
  }
  return { grade, loss };
}

// ---------- board helpers ----------
const other = (c) => (c === 'w' ? 'b' : 'w');
const sideName = (c) => (c === 'w' ? 'White' : 'Black');
const xy = (s) => [s.charCodeAt(0) - 97, s.charCodeAt(1) - 49];
const sq = (x, y) => (x >= 0 && x < 8 && y >= 0 && y < 8 ? String.fromCharCode(97 + x, 49 + y) : null);
const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KING = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const ORTH = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const RAYS = { b: DIAG, r: ORTH, q: [...DIAG, ...ORTH] };
const CENTER = ['d4', 'e4', 'd5', 'e5'];

// { square: { type, color } } for a FEN or a Chess instance.
function snap(pos) {
  const ch = typeof pos === 'string' ? new Chess(pos) : pos;
  const m = {};
  for (const row of ch.board()) for (const c of row) if (c) m[c.square] = { type: c.type, color: c.color };
  return m;
}
// Squares the piece on `from` attacks.
function attacksFrom(pos, from) {
  const p = pos[from];
  if (!p) return [];
  const [x, y] = xy(from);
  const out = [];
  if (p.type === 'p') {
    const dy = p.color === 'w' ? 1 : -1;
    for (const dx of [-1, 1]) { const s = sq(x + dx, y + dy); if (s) out.push(s); }
    return out;
  }
  if (p.type === 'n' || p.type === 'k') {
    for (const [dx, dy] of p.type === 'n' ? KNIGHT : KING) { const s = sq(x + dx, y + dy); if (s) out.push(s); }
    return out;
  }
  for (const [dx, dy] of RAYS[p.type]) {
    for (let i = 1; ; i++) {
      const s = sq(x + dx * i, y + dy * i);
      if (!s) break;
      out.push(s);
      if (pos[s]) break;
    }
  }
  return out;
}
// Squares of `color`'s pieces that attack (or, for own pieces, guard) `target`.
function attackersOf(pos, target, color) {
  const out = [];
  for (const s in pos) if (pos[s].color === color && attacksFrom(pos, s).includes(target)) out.push(s);
  return out;
}
// The first `n` occupied squares along a ray.
function rayHits(pos, from, dx, dy, n) {
  const [x, y] = xy(from);
  const out = [];
  for (let i = 1; out.length < n; i++) {
    const s = sq(x + dx * i, y + dy * i);
    if (!s) break;
    if (pos[s]) out.push(s);
  }
  return out;
}
// Can the piece on `s` be won right now: attacked, and either unguarded or
// attackable by a cheaper piece?
function enPrise(pos, s) {
  const p = pos[s];
  if (!p || p.type === 'k') return false;
  const att = attackersOf(pos, s, other(p.color));
  if (!att.length) return false;
  if (!attackersOf(pos, s, p.color).length) return true;
  const cheapest = Math.min(...att.map((a) => (pos[a].type === 'k' ? 99 : VAL[pos[a].type])));
  return cheapest < VAL[p.type];
}
const guarded = (pos, s) => attackersOf(pos, s, pos[s].color).length > 0;
function kingSq(pos, color) {
  for (const s in pos) if (pos[s].type === 'k' && pos[s].color === color) return s;
  return null;
}
// No enemy pawn ahead of it on its own file or the files next to it.
function isPassed(pos, s, color) {
  const [x, y] = xy(s);
  for (const t in pos) {
    const p = pos[t];
    if (p.type !== 'p' || p.color === color) continue;
    const [tx, ty] = xy(t);
    if (Math.abs(tx - x) <= 1 && (color === 'w' ? ty > y : ty < y)) return false;
  }
  return true;
}
const centerDist = (s) => { const [x, y] = xy(s); return Math.max(Math.min(Math.abs(x - 3), Math.abs(x - 4)), Math.min(Math.abs(y - 3), Math.abs(y - 4))); };
function nonPawn(pos, color) {
  let n = 0;
  for (const s in pos) if (pos[s].color === color && pos[s].type !== 'p' && pos[s].type !== 'k') n += VAL[pos[s].type];
  return n;
}
function hasQueens(pos) {
  for (const s in pos) if (pos[s].type === 'q') return true;
  return false;
}
const isEndgame = (pos) => !hasQueens(pos) && nonPawn(pos, 'w') <= 6 && nonPawn(pos, 'b') <= 6;
// Material on the board from `me`'s side, in pawns.
function materialOf(pos, me) {
  let n = 0;
  for (const s in pos) if (pos[s].type !== 'k') n += (pos[s].color === me ? 1 : -1) * VAL[pos[s].type];
  return n;
}
// An engine line can stop in the middle of a trade and look like a win. A
// material claim also needs the engine's score to agree, at least half of it
// (scores are not exact piece values, and a piece won can cost one later).
const half = (points) => Math.min(points, 3) * 0.5;
// A gain: the score is above the material now.
function scoreShowsGain(ctx, gain, score) {
  if (!score) return false;
  if (score.mate != null) return score.mate > 0;
  return score.cp / 100 - materialOf(ctx.snapBefore, ctx.me) >= half(gain);
}
// A loss (or a missed win): the score drops along with the material gap
// between the played line and the better one.
function scoreShowsGap(ctx, gap) {
  const { before, after } = ctx;
  if (!before || !after) return false;
  if (before.mate != null || after.mate != null) return true;
  return (before.cp - after.cp) / 100 >= half(gap);
}
function pawnEnding(pos) {
  for (const s in pos) if (pos[s].type !== 'p' && pos[s].type !== 'k') return false;
  return true;
}
const HOME = { w: { n: ['b1', 'g1'], b: ['c1', 'f1'] }, b: { n: ['b8', 'g8'], b: ['c8', 'f8'] } };
function piecesAtHome(pos, color) {
  let n = 0;
  for (const t of ['n', 'b']) for (const s of HOME[color][t]) if (pos[s] && pos[s].type === t && pos[s].color === color) n++;
  return n;
}
const isDevelop = (m) => !!m && (m.piece === 'n' || m.piece === 'b') && HOME[m.color][m.piece].includes(m.from);
const isCastle = (m) => !!m && (m.isKingsideCastle() || m.isQueensideCastle());

// Plays a UCI line from `fen`. Stops at the first move that is not legal.
function walk(fen, line, max = 14) {
  const ch = new Chess(fen);
  const fens = [ch.fen()];
  const moves = [];
  for (const uci of (line || []).slice(0, max)) {
    let mv;
    try { mv = ch.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }); } catch (_) { break; }
    moves.push(mv);
    fens.push(ch.fen());
  }
  return { fens, moves };
}
const gainOf = (m) => (m.captured ? VAL[m.captured] : 0) + (m.promotion ? VAL[m.promotion] - 1 : 0);
// Material change for `side` from ply `from` on, read at the last quiet moment
// (no capture or promotion next) within the trusted horizon.
function settled(w, side, from = 0, horizon = HORIZON) {
  const end = Math.min(w.moves.length, from + horizon);
  if (end <= from) return 0;
  const diff = [0];
  for (let k = from; k < end; k++) diff.push(diff[diff.length - 1] + (w.moves[k].color === side ? 1 : -1) * gainOf(w.moves[k]));
  for (let k = end; k > from; k--) {
    const next = w.moves[k];
    if (!next || (!next.captured && !next.promotion)) return diff[k - from];
  }
  return diff[end - from];
}
// A move to play on `ch`: SAN ("Nf3") or UCI ("g1f3").
function toMove(ch, move) {
  const c = new Chess(ch.fen());
  if (/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)) return c.move({ from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] });
  return c.move(move);
}
const uciOf = (m) => m.from + m.to + (m.promotion || '');
function sanOf(fen, uci) {
  try { return toMove(new Chess(fen), uci).san; } catch (_) { return uci; }
}
// A one-move checkmate for the side not to move, if it were their turn.
function mateThreat(fen) {
  const ch = new Chess(fen);
  if (ch.inCheck()) return null;
  try { ch.move('--'); } catch (_) { return null; }
  for (const m of ch.moves()) {
    ch.move(m);
    const mate = ch.isCheckmate();
    ch.undo();
    if (mate) return m;
  }
  return null;
}
function mateInOne(fen) {
  const ch = new Chess(fen);
  for (const m of ch.moves()) {
    ch.move(m);
    const mate = ch.isCheckmate();
    ch.undo();
    if (mate) return m;
  }
  return null;
}

// ---------- tactic finder ----------
// Looks at the move at index `at` of a walked line, played by `side`, and says
// what it wins, but only if the line really wins material (at least `minGain`
// points once things settle). Returns null when the line wins nothing.
function classifyWin(w, side, at, minGain) {
  const key = w.moves[at];
  if (!key || key.color !== side) return null;
  const gain = settled(w, side, at);
  if (gain < minGain) return null;
  const foe = other(side);
  let c = -1;
  for (let k = at; k < Math.min(w.moves.length, at + HORIZON); k += 2) {
    if (w.moves[k].captured) { c = k; break; }
  }
  const pre = snap(w.fens[at]);
  const post = snap(w.fens[at + 1]);
  const base = { gain, key, payoff: c >= 0 ? w.moves[c] : null };
  const big = (t) => (gain >= 2 ? t : { ...t, type: 'material' });
  if (c < 0) return { ...base, type: 'material' };
  const pay = w.moves[c];
  // Every square `side` captures on within the trusted part of the line.
  const took = [];
  for (let k = at; k < Math.min(w.moves.length, at + HORIZON); k += 2) if (w.moves[k].captured) took.push(w.moves[k].to);

  if (c === at) {
    // The move takes something right away.
    const vs = key.to;
    const free = !attackersOf(pre, vs, foe).length;
    // Removing the defender: what it took was guarding a piece that falls next.
    if (!free) {
      for (let k = at + 2; k < Math.min(w.moves.length, at + 5); k += 2) {
        const m = w.moves[k];
        if (!m.captured || m.to === vs || m.color !== side) continue;
        if (pre[m.to] && pre[m.to].color === foe && attacksFrom(pre, vs).includes(m.to)) {
          return big({ ...base, type: 'removeDefender', removed: { type: key.captured, sq: vs }, target: { type: m.captured, sq: m.to }, second: m });
        }
      }
    }
    // "Hangs" or "free" only when the line keeps most of the piece; if most of
    // it comes back another way, it is just a loss of material.
    const keeps = key.captured === 'p' ? 1 : Math.max(2, VAL[key.captured] - 2);
    if ((free || enPrise(pre, vs)) && gain >= keeps) {
      // The cheapest piece aimed at it is what makes it hang.
      const cheap = attackersOf(pre, vs, side).sort((a, b) => VAL[pre[a].type] - VAL[pre[b].type])[0];
      return { ...base, type: 'hang', victim: { type: key.captured, sq: vs }, by: { type: key.piece, sq: key.from }, cheap: cheap ? { type: pre[cheap].type, sq: cheap } : null, free };
    }
    // Every capture lands on the same square: a trade that one side miscounted.
    let same = true;
    for (let k = at; k < Math.min(w.moves.length, at + HORIZON); k++) if (w.moves[k].captured && w.moves[k].to !== vs) same = false;
    if (same) return { ...base, type: 'exchange', victim: { type: key.captured, sq: vs }, by: { type: key.piece, sq: key.from } };
    return { ...base, type: 'material' };
  }

  // A quiet move (or a check) that wins something a move or two later.
  const X = { type: key.promotion || key.piece, sq: key.to };
  const hits = attacksFrom(post, X.sq);
  // Fork: the moved piece hits two or more targets at once.
  const targets = hits
    .filter((s) => {
      const p = post[s];
      if (!p || p.color !== foe || p.type === 'p') return false;
      return p.type === 'k' || VAL[p.type] > VAL[X.type] || !guarded(post, s);
    })
    .map((s) => ({ type: post[s].type, sq: s }));
  if (targets.length >= 2 && targets.some((t) => took.includes(t.sq))) return big({ ...base, type: 'fork', piece: X, targets });
  // Skewer: a long-range piece hits a big piece with a smaller one behind it.
  if (RAYS[X.type]) {
    for (const [dx, dy] of RAYS[X.type]) {
      const [a, b] = rayHits(post, X.sq, dx, dy, 2);
      if (!a || !b || post[a].color !== foe || post[b].color !== foe) continue;
      if ((post[a].type === 'k' || VAL[post[a].type] > VAL[post[b].type]) && pay.to === b && pay.from === X.sq) {
        return big({ ...base, type: 'skewer', piece: X, front: { type: post[a].type, sq: a }, back: { type: post[b].type, sq: b } });
      }
    }
  }
  // Pin: the piece that gets taken could not move because of what stood behind it.
  for (const s in post) {
    const P = post[s];
    if (P.color !== side || !RAYS[P.type]) continue;
    for (const [dx, dy] of RAYS[P.type]) {
      const [a, b] = rayHits(post, s, dx, dy, 2);
      if (!a || !b || a !== pay.to || post[a].color !== foe || post[b].color !== foe) continue;
      // Against the king it is a real pin. Against another piece only if losing
      // that piece would cost more than the pinner (or nothing guards it).
      const B = post[b];
      if (B.type === 'k' || (VAL[B.type] > VAL[post[a].type] && (VAL[B.type] > VAL[P.type] || !guarded(post, b)))) {
        return big({ ...base, type: 'pin', pinner: { type: P.type, sq: s }, pinned: { type: post[a].type, sq: a }, behind: { type: post[b].type, sq: b } });
      }
    }
  }
  // Discovered attack: moving away opened a line for a piece behind it.
  for (const s in post) {
    const Z = post[s];
    if (Z.color !== side || !RAYS[Z.type] || s === X.sq) continue;
    for (const [dx, dy] of RAYS[Z.type]) {
      if (rayHits(pre, s, dx, dy, 1)[0] !== key.from) continue;
      const t = rayHits(post, s, dx, dy, 1)[0];
      if (!t || post[t].color !== foe) continue;
      if (post[t].type !== 'k' && VAL[post[t].type] < 3) continue;
      if (pay.to === t || hits.includes(pay.to) || pay.from === X.sq) {
        return big({ ...base, type: 'discovered', mover: { type: key.piece, from: key.from, to: key.to }, slider: { type: Z.type, sq: s }, target: { type: post[t].type, sq: t } });
      }
    }
  }
  // Chasing a defender away: it has to move, and what it guarded falls.
  const reply = w.moves[at + 1];
  if (c === at + 2 && reply && reply.color === foe && hits.includes(reply.from) && attacksFrom(post, reply.from).includes(pay.to)) {
    return big({ ...base, type: 'removeDefender', chased: true, removed: { type: reply.piece, sq: reply.from }, target: { type: pay.captured, sq: pay.to }, second: pay });
  }
  return { ...base, type: 'material' };
}

// ---------- words ----------
const your = (p) => (p.type === 'k' ? 'your king' : `your ${NAME[p.type]} on ${p.sq}`);
const the = (p) => (p.type === 'k' ? 'the king' : `the ${NAME[p.type]} on ${p.sq}`);
const list = (arr) => (arr.length <= 2 ? arr.join(' and ') : arr.slice(0, -1).join(', ') + ', and ' + arr[arr.length - 1]);
const points = (n) => (n === 1 ? '1 point' : n + ' points');
const count = (n) => ['no', 'one', 'two', 'three', 'four'][n] || String(n);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// "It keeps more of an edge (+0.8 instead of +0.1)." Scores from the mover's side.
export function evalPhrase(best, played) {
  if (best && best.mate != null && best.mate > 0) return `It leads to checkmate in ${best.mate}.`;
  if (played && played.mate != null && played.mate < 0) return 'It avoids getting checkmated.';
  if (!best || !played || best.cp == null || played.cp == null) return 'The engine scores it higher.';
  const nums = `(${fmtScore(best)} instead of ${fmtScore(played)})`;
  if (best.cp >= 30 && played.cp >= 30) return `It keeps more of an edge ${nums}.`;
  if (best.cp >= 30) return `It keeps your edge ${nums}.`;
  if (best.cp > -30) return `It keeps the game about even ${nums}.`;
  return `It loses less ${nums}.`;
}

// What a winning line does, as { tag, headline, detail, short } for `side`.
function winWords(t, foeName) {
  const wins = t.gain >= 3 ? 'wins material' : t.gain === 2 ? 'wins material' : 'wins a pawn';
  switch (t.type) {
    case 'fork': {
      const names = t.targets.map((x) => (x.type === 'k' ? 'the king' : `the ${NAME[x.type]} on ${x.sq}`));
      const rest = t.targets.filter((x) => x.type !== 'k').map((x) => `the ${NAME[x.type]} on ${x.sq}`);
      const detail = t.targets.some((x) => x.type === 'k')
        ? `Your ${NAME[t.piece.type]} checks the king and attacks ${list(rest)} at once. The king has to move, so ${list(rest)} falls.`
        : `Your ${NAME[t.piece.type]} attacks ${list(names)} at once, and only one can be saved.`;
      return { tag: 'fork', headline: 'This is a fork.', detail, short: `It forks ${list(names)}.` };
    }
    case 'pin':
      return { tag: 'pin', headline: 'This wins a pinned piece.', detail: `The ${NAME[t.pinned.type]} on ${t.pinned.sq} is pinned to ${the(t.behind)}, so it cannot get away.`, short: `It wins the pinned ${NAME[t.pinned.type]} on ${t.pinned.sq}.` };
    case 'skewer':
      return { tag: 'skewer', headline: 'This is a skewer.', detail: `Your ${NAME[t.piece.type]} attacks ${the(t.front)}, and ${the(t.back)} behind it falls next.`, short: `It skewers ${the(t.front)} and wins ${the(t.back)} behind it.` };
    case 'discovered':
      return { tag: 'discovered', headline: 'This is a discovered attack.', detail: `Moving your ${NAME[t.mover.type]} opens a line for your ${NAME[t.slider.type]} on ${t.slider.sq}, so you make two threats at once.`, short: 'It makes two threats at once with a discovered attack.' };
    case 'removeDefender':
      return { tag: 'removeDefender', headline: 'This removes a defender.', detail: `Without ${the(t.removed)}, ${the(t.target)} has no guard, and you win it.`, short: `It removes the guard of ${the(t.target)}.` };
    case 'hang':
      return t.free
        ? { tag: 'free', headline: `You win a free ${NAME[t.victim.type]}.`, detail: `${foeName} cannot take back on ${t.victim.sq}.`, short: `It wins a free ${NAME[t.victim.type]}.` }
        : { tag: 'free', headline: `You win ${t.gain >= 2 ? 'material' : 'a pawn'} on ${t.victim.sq}.`, detail: `Even if ${foeName} takes back, you come out ${points(t.gain)} ahead.`, short: `It ${wins}.` };
    case 'exchange':
      return {
        tag: 'exchange', headline: `You win the trade on ${t.victim.sq}.`,
        detail: `You have more pieces aimed at ${t.victim.sq} than ${foeName} has guarding it.`,
        short: t.gain === 1 ? `It wins a pawn on ${t.victim.sq}.` : `It wins material on ${t.victim.sq}.`,
      };
    default:
      return { tag: 'material', headline: `This ${wins}.`, detail: `In the engine's line, you come out ${points(t.gain)} ahead.`, short: `It ${wins}.` };
  }
}

// Could the other side already play `key` before this move, against the same
// pieces? Then the move did not allow the trick; it missed the threat.
function threatenedBefore(ctx, key, squares) {
  const ch = new Chess(ctx.fen);
  if (ch.inCheck()) return false;
  try {
    ch.move('--');
    ch.move({ from: key.from, to: key.to, promotion: key.promotion });
  } catch (_) {
    return false;
  }
  return squares.every((s) => {
    const a = ctx.snapBefore[s];
    const b = ctx.snapAfter[s];
    return a && b && a.color === ctx.me && a.type === b.type;
  });
}

// Words for a confirmed loss, as { tag, headline, why[] }, from the loser's side.
function lossWords(t, ctx) {
  const { opp, mv } = ctx;
  const O = sideName(opp);
  const reply = t.key.san;
  switch (t.type) {
    case 'fork': {
      const king = t.targets.some((x) => x.type === 'k');
      const rest = t.targets.filter((x) => x.type !== 'k').map((x) => `your ${NAME[x.type]} on ${x.sq}`);
      const piece = NAME[t.piece.type];
      if (threatenedBefore(ctx, t.key, t.targets.map((x) => x.sq))) {
        return {
          tag: 'fork', headline: `This misses ${O}'s fork.`,
          why: [`${O} was already threatening ${reply}, and this move does not stop it.`, king ? `The ${piece} would check your king and hit ${list(rest)} too.` : `The ${piece} would attack ${list(rest)} at once.`],
        };
      }
      const s = king
        ? `After ${reply}, the ${piece} checks your king and attacks ${list(rest)} too.`
        : `After ${reply}, the ${piece} attacks ${list(rest)} at once.`;
      return { tag: 'fork', headline: 'This allows a fork.', why: [s, king ? `Your king has to move, and then ${O} takes.` : 'You can only save one.'] };
    }
    case 'pin': {
      const pinned = `Your ${NAME[t.pinned.type]} on ${t.pinned.sq}`;
      const by = `the ${NAME[t.pinner.type]} on ${t.pinner.sq}`;
      const first = t.behind.type === 'k'
        ? `${pinned} is pinned to your king by ${by}, so it cannot move.`
        : `${pinned} is pinned by ${by}: if it moves, your ${NAME[t.behind.type]} on ${t.behind.sq} is lost.`;
      // Was it already pinned before this move? Then the move failed to fix it.
      const was = ctx.snapBefore[t.pinned.sq] && ctx.snapBefore[t.pinned.sq].color === ctx.me && pinnedIn(ctx.snapBefore, t.pinned.sq, ctx.opp);
      return { tag: 'pin', headline: was ? `This leaves your ${NAME[t.pinned.type]} pinned.` : 'This allows a pin.', why: [first, `${O} wins the ${NAME[t.pinned.type]}.`] };
    }
    case 'skewer': {
      const front = t.front.type === 'k' ? 'checks your king' : `attacks your ${NAME[t.front.type]} on ${t.front.sq}`;
      if (threatenedBefore(ctx, t.key, [t.front.sq, t.back.sq])) {
        return {
          tag: 'skewer', headline: `This misses ${O}'s skewer.`,
          why: [`${O} was already threatening ${reply}, and this move does not stop it.`, `The ${NAME[t.piece.type]} ${front}, and your ${NAME[t.back.type]} on ${t.back.sq} is right behind it.`],
        };
      }
      return {
        tag: 'skewer', headline: 'This allows a skewer.',
        why: [`After ${reply}, the ${NAME[t.piece.type]} ${front}, and your ${NAME[t.back.type]} on ${t.back.sq} is right behind it.`, `When the ${NAME[t.front.type]} moves, ${O} takes the ${NAME[t.back.type]}.`],
      };
    }
    case 'discovered': {
      const hit = t.target.type === 'k' ? 'gives check' : `attacks your ${NAME[t.target.type]} on ${t.target.sq}`;
      return {
        tag: 'discovered', headline: 'This allows a discovered attack.',
        why: [`After ${reply}, the ${NAME[t.mover.type]} moves out of the way and the ${NAME[t.slider.type]} on ${t.slider.sq} ${hit}.`, 'That is two threats at once.'],
      };
    }
    case 'removeDefender':
      return {
        tag: 'removeDefender', headline: `This lets ${O} remove a defender.`,
        why: t.chased
          ? [`After ${reply}, your ${NAME[t.removed.type]} on ${t.removed.sq} has to move.`, `Then your ${NAME[t.target.type]} on ${t.target.sq} has no guard, and ${O} wins it.`]
          : [`${O} can take your ${NAME[t.removed.type]} on ${t.removed.sq}, the piece guarding your ${NAME[t.target.type]} on ${t.target.sq}.`, `Then the ${NAME[t.target.type]} falls too.`],
      };
    case 'hang': {
      const v = t.victim;
      const by = `The ${NAME[t.by.type]} on ${t.by.sq}`;
      const vName = NAME[v.type];
      // Guarded, but a cheaper piece attacks it: guarding does not help.
      const c = t.cheap && VAL[t.cheap.type] < VAL[v.type] ? t.cheap : null;
      const tail = t.free
        ? `${by} can take it for free (${reply}).`
        : c && c.sq === t.by.sq
          ? `${by} can take it (${reply}), and a ${NAME[c.type]} is worth less than a ${vName}.`
          : c
            ? `The ${NAME[c.type]} on ${c.sq} attacks it, and a ${NAME[c.type]} is worth less than a ${vName}.`
            : `${O} wins material with ${reply}.`;
      const before = ctx.snapBefore;
      const after = ctx.snapAfter;
      if (mv.to === v.sq) {
        ctx.victim = v;
        let why;
        if (t.free) why = [`Your ${vName} on ${v.sq} has no defender.`, tail];
        else if (c && c.sq === t.by.sq) why = [`${by} can take your ${vName} on ${v.sq} (${reply}).`, `Even if you take back, you lose a ${vName} (${VAL[v.type]}) for a ${NAME[c.type]} (${VAL[c.type]}).`];
        else if (c) why = [`The ${NAME[c.type]} on ${c.sq} attacks your ${vName} on ${v.sq}, and a ${NAME[c.type]} is worth less.`, `${O} wins material with ${reply}.`];
        else why = [`${O} can win your ${vName} on ${v.sq} (${reply}).`];
        return { tag: 'hang', headline: `This hangs your ${vName}.`, why };
      }
      ctx.victim = v;
      if (before[v.sq] && before[v.sq].color === ctx.me && before[v.sq].type === v.type && enPrise(before, v.sq)) {
        return { tag: 'threat', headline: `This misses ${O}'s threat.`, why: [`Your ${vName} on ${v.sq} was already under attack, and this move does not save it.`, tail] };
      }
      if (attacksFrom(before, mv.from).includes(v.sq) && !attacksFrom(after, mv.to).includes(v.sq)) {
        return { tag: 'hang', headline: `This leaves your ${vName} on ${v.sq} without a guard.`, why: [`Your ${NAME[mv.piece]} was guarding the ${vName} on ${v.sq}.`, tail] };
      }
      if (!attacksFrom(before, t.by.sq).includes(v.sq) && attacksFrom(after, t.by.sq).includes(v.sq)) {
        return { tag: 'hang', headline: `This opens a line to your ${vName}.`, why: [`Moving your ${NAME[mv.piece]} from ${mv.from} lets the ${NAME[t.by.type]} on ${t.by.sq} reach your ${vName} on ${v.sq}.`, tail] };
      }
      return { tag: 'hang', headline: `This leaves your ${vName} on ${v.sq} hanging.`, why: [tail] };
    }
    case 'exchange': {
      const s = t.victim.sq;
      const leftIt = mv.to !== s && attacksFrom(ctx.snapBefore, mv.from).includes(s) && !attacksFrom(ctx.snapAfter, mv.to).includes(s);
      return {
        tag: 'exchange', headline: `This loses the fight for ${s}.`,
        why: [
          leftIt
            ? `Your ${NAME[mv.piece]} was guarding your ${NAME[t.victim.type]} on ${s}. Now ${O} has more pieces aimed at it than you have guarding it.`
            : `${O} has more pieces aimed at your ${NAME[t.victim.type]} on ${s} than you have guarding it.`,
          `After the trades there, you are ${points(t.gain)} down.`,
        ],
      };
    }
    default:
      return null;
  }
}

// ---------- the explainer ----------
// Returns:
//   { grade, label, mark, loss, san, uci, headline, why: [..],
//     better: { uci, san, why } | null, tag, info: TAG_INFO[tag] | null,
//     lines: { played: [uci..], better: [uci..] } }
// `hint: true` explains the engine's own top move (the Hint arrow).
export function explainMove({ fen, move, pre, post, hint = false }) {
  const ch = new Chess(fen);
  const me = ch.turn();
  const opp = other(me);
  const O = sideName(opp);
  const mv = toMove(ch, move);
  const uci = uciOf(mv);
  const lines = (pre || []).filter((l) => l && l.pv && l.pv.length);
  const top = lines[0] || null;
  const isTop = !!top && top.pv[0] === uci;
  const afterCh = new Chess(mv.after);
  const before = top ? top.score : null;
  let after;
  if (afterCh.isCheckmate()) after = { mate: 1 };
  else if (afterCh.isDraw()) after = { cp: 0 };
  else if (post && post.score) after = flip(post.score);
  else after = isTop ? before : null;
  let { grade, loss } = after ? gradeMove(before, after, isTop) : { grade: isTop ? 'best' : 'good', loss: 0 };

  const playedLine = [uci, ...(post && post.pv ? post.pv : [])];
  const played = walk(fen, playedLine);
  const better = top && !isTop ? walk(fen, top.pv) : null;
  // In a won or lost game the grade is gentle, but a piece given away for
  // nothing (3+ points, shown by the engine's line) is still worth flagging.
  if (!isFlagged(grade) && better && after) {
    const gap = settled(better, me, 0) - settled(played, me, 0);
    if (gap >= 3 && scoreShowsGap({ before, after }, gap)) grade = 'inaccuracy';
  }
  const bestMv = better && better.moves[0] ? better.moves[0] : null;
  const bestSan = bestMv ? bestMv.san : null;
  const ctx = {
    fen, ch, me, opp, mv, uci, top, lines, before, after, grade, isTop, afterCh, played, better, bestMv, bestSan, hint,
    snapBefore: snap(ch),
    snapAfter: snap(afterCh),
    moveNo: Number(fen.split(' ')[5]) || 1,
  };

  const out = {
    grade, label: GRADE_LABEL[grade], mark: GRADE_MARK[grade], loss: Math.round(loss),
    san: mv.san, uci, headline: '', why: [], better: null, tag: null, info: null, lesson: null,
    lines: { played: playedLine.slice(0, 9), better: top ? top.pv.slice(0, 9) : [] },
  };

  const res = isFlagged(grade) ? badReason(ctx) : goodReason(ctx, played, mv);
  out.headline = res.headline;
  out.why = res.why || [];
  out.tag = res.tag || null;
  out.info = out.tag && TAG_INFO[out.tag] ? TAG_INFO[out.tag] : null;
  out.lesson = out.info ? out.info.lesson : (out.tag && GOOD_LESSON[out.tag]) || null;

  if (bestMv) {
    const bw = isFlagged(grade) || grade === 'good' ? betterWhy(ctx, res) : null;
    out.better = { uci: uciOf(bestMv), san: bestSan, why: bw };
  }
  if (hint && lines[1] && lines[1].pv.length) {
    const nextSan = sanOf(fen, lines[1].pv[0]);
    if (toCp(lines[0].score) - toCp(lines[1].score) >= 30) {
      out.why.push(`The next best move, ${nextSan}, scores lower (${fmtScore(lines[1].score)} instead of ${fmtScore(lines[0].score)}).`);
    } else {
      out.why.push(`${nextSan} is about as good (${fmtScore(lines[1].score)}).`);
    }
  }
  out.why = out.why.slice(0, 3);
  return out;
}

// Why a flagged move was bad. Always returns something; the last resort is the
// honest "the engine prefers X" line.
function badReason(ctx) {
  const { me, opp, mv, top, before, after, played, better, bestMv, bestSan, afterCh, snapBefore, snapAfter, moveNo, fen } = ctx;
  const O = sideName(opp);

  // Stalemate when winning.
  if (afterCh.isStalemate() && toCp(before) >= 200) {
    return {
      tag: 'stalemate', headline: 'Stalemate. The win slips away.',
      why: [`${O} has no legal move but is not in check, so the game is a draw.`, 'You were winning.'],
    };
  }

  // Lets the other side force checkmate.
  if (after && after.mate != null && after.mate < 0 && !(before && before.mate != null && before.mate <= 0)) {
    const n = -after.mate;
    let mateIdx = -1;
    for (let k = 1; k < played.moves.length; k++) {
      if (new Chess(played.fens[k + 1]).isCheckmate()) { mateIdx = k; break; }
    }
    const first = played.moves[1] ? played.moves[1].san : null;
    const last = mateIdx > 0 ? played.moves[mateIdx] : null;
    const threat = mateThreat(fen);
    if (threat && n === 1) {
      return { tag: 'mateThreat', headline: 'This misses a checkmate threat.', why: [`${O} was threatening ${threat}, and this move does not stop it.`] };
    }
    const backRank = last && isBackRankMate(played.fens[mateIdx + 1], me, last);
    const lead = n === 1 && last ? `${O} can checkmate you with ${last.san}.` : `${O} can force checkmate in ${n}${first ? `, starting with ${first}` : ''}.`;
    if (backRank) {
      return { tag: 'backRank', headline: 'This allows a back-rank mate.', why: [lead, 'Your king is stuck on the back row behind its own pawns.'] };
    }
    if (first) return { tag: 'allowMate', headline: 'This allows checkmate.', why: [lead] };
  }

  // Had a forced checkmate and let it go.
  if (before && before.mate != null && before.mate > 0 && !(after && after.mate != null && after.mate > 0) && top) {
    const s = sanOf(fen, top.pv[0]);
    return {
      tag: 'missedMate', headline: 'You missed checkmate.',
      why: [before.mate === 1 ? `You had checkmate in one move: ${s}.` : `You had a forced checkmate in ${before.mate}, starting with ${s}.`],
    };
  }

  // A pawn race: the engine's line queens a pawn for the other side, and the
  // better line does not. Races are long, so the whole line counts here.
  const runner = promotionIn(played, opp, 14);
  if (runner && better && !promotionIn(better, opp, 14) && settled(played, me, 0, 14) <= -3) {
    const takes = bestMv && bestMv.captured === 'p' && bestMv.to === runner;
    return {
      tag: 'passerAllowed', headline: `This lets ${O}'s pawn through.`,
      why: [`${O}'s pawn on ${runner} is free to run.`, "In the engine's line, it becomes a queen."],
      betterShort: takes ? 'It takes that pawn before it can run.' : 'It stops that pawn from becoming a queen.',
    };
  }

  // Material: what the played line loses, and what the better line wins. The
  // bigger of the two is the lesson, so a missed free knight is not hidden
  // behind a lost pawn.
  const pm = settled(played, me, 0);
  const bm = better ? settled(better, me, 0) : pm;
  // A passed pawn that queens is the most specific lesson, so it goes first.
  const order = bm >= 1 && bm > -pm ? [passerPush, missedWin, materialLoss] : [passerPush, materialLoss, missedWin];
  for (const step of order) {
    const r = step(ctx, pm, bm);
    if (r) return r;
  }
  return positional(ctx);
}

// The engine's line wins something from you.
function materialLoss(ctx, pm, bm) {
  const { opp, mv, played, me } = ctx;
  const O = sideName(opp);
  if (pm <= -1 && pm < bm && scoreShowsGap(ctx, bm - pm)) {
    const r1 = played.moves[1];
    if (mv.captured && r1 && r1.captured && r1.to === mv.to) {
      const simple = -pm === VAL[mv.piece] - VAL[mv.captured];
      return {
        tag: 'trade', headline: 'This trade loses material.',
        why: simple
          ? [`You took a ${NAME[mv.captured]} with your ${NAME[mv.piece]}, but it was guarded.`, `After ${O} takes back (${r1.san}), you have given a ${NAME[mv.piece]} (${VAL[mv.piece]}) for a ${NAME[mv.captured]} (${VAL[mv.captured]}).`]
          : [`You took on ${mv.to}, but ${O} has more pieces aimed there.`, `In the engine's line, you end up ${points(-pm)} down.`],
      };
    }
    const t = classifyWin(played, opp, 1, 1);
    if (t) {
      const words = lossWords(t, ctx);
      if (words) return words;
      // Confirmed loss, but not one of the named patterns. Name the piece only
      // when it is the whole loss.
      const lost = biggestLoss(played, me);
      return {
        tag: null, headline: 'This loses material.',
        why: [lost && VAL[lost] === -pm ? `In the engine's line, ${O} wins your ${NAME[lost]}, starting with ${t.key.san}.` : `In the engine's line, ${O} comes out ${points(-pm)} ahead, starting with ${t.key.san}.`],
      };
    }
  }
  return null;
}

// A passed pawn that the engine pushes all the way: that is the lesson,
// even though queening also "wins material".
function passerPush(ctx) {
  const { better, bestMv, snapBefore, me, mv, opp } = ctx;
  if (better && bestMv && bestMv.piece === 'p' && !bestMv.captured && isPassed(snapBefore, bestMv.from, me) && promotionIn(better, me, 14) && !(mv.piece === 'p' && isPassed(snapBefore, mv.from, me))) {
    return { tag: 'passer', headline: 'This holds back your passed pawn.', why: [`Your pawn on ${bestMv.from} is passed: no ${sideName(opp)} pawn can stop it.`, 'The engine pushes it and makes a new queen.'] };
  }
  return null;
}

// Missed a chance to win material.
function missedWin(ctx, pm, bm) {
  const { better, me, opp } = ctx;
  const O = sideName(opp);
  if (better && bm >= 1 && bm > pm && scoreShowsGap(ctx, bm - pm)) {
    const t = classifyWin(better, me, 0, 1);
    if (t) {
      const w = winWords(t, O);
      const missed = {
        fork: 'missedFork', pin: 'missedPin', skewer: 'missedSkewer', discovered: 'missedDiscovered',
        removeDefender: 'missedRemove', free: 'missedFree', exchange: 'missedExchange',
      }[w.tag];
      // `betterShort` says what the better move does, in the same words.
      if (w.tag === 'free' && t.free) {
        return {
          tag: 'missedFree', headline: `You missed a free ${NAME[t.victim.type]}.`,
          why: [`Your ${NAME[t.by.type]} on ${t.by.sq} could take the ${NAME[t.victim.type]} on ${t.victim.sq}, and nothing can take back.`],
          betterShort: w.short,
        };
      }
      const names = { missedFork: 'a fork', missedPin: 'a pin', missedSkewer: 'a skewer', missedDiscovered: 'a discovered attack', missedRemove: 'a chance to remove a defender', missedExchange: 'a winning trade', missedFree: 'a chance to win material' };
      if (missed) return { tag: missed, headline: `You missed ${names[missed]}.`, why: [w.detail.replace(/^Your/, `With ${t.key.san}, your`)], betterShort: w.short };
      return { tag: null, headline: 'You missed a chance to win material.', why: [`${t.key.san} wins ${points(t.gain)} in the engine's line.`], betterShort: w.short };
    }
  }
  return null;
}

// Reasons that are not about material: castling, opening principles, king
// safety and endgame ideas, each confirmed by the engine's choice. Last
// comes the honest "the engine prefers X" line.
function positional(ctx) {
  const { me, opp, mv, before, after, played, better, bestMv, bestSan, afterCh, snapBefore, moveNo } = ctx;
  const O = sideName(opp);

  // Giving up castling comes first: it is the clearest reason for a king or rook move.
  if (bestMv && !ctx.ch.inCheck() && moveNo <= 20 && !isCastle(mv)) {
    const rb = ctx.ch.getCastlingRights(me);
    const ra = afterCh.getCastlingRights(me);
    // Confirmed only when the engine's move keeps that right (or castles).
    const rBest = new Chess(better.fens[1]).getCastlingRights(me);
    const lostK = rb.k && !ra.k && (rBest.k || isCastle(bestMv));
    const lostQ = rb.q && !ra.q && (rBest.q || isCastle(bestMv));
    if (lostK || lostQ) {
      const castlesSoon = better.moves.slice(0, 5).some((m) => m.color === me && isCastle(m));
      const end = castlesSoon ? 'The engine castles soon instead.' : 'Your king stays in the middle, where it is easier to attack.';
      return mv.piece === 'k'
        ? { tag: 'castleLost', headline: 'This gives up castling.', why: ['Moving your king takes away the right to castle.', end] }
        : { tag: 'castleLost', headline: 'This gives up castling on that side.', why: ['Once this rook moves, you can no longer castle with it.', end] };
    }
  }

  // Opening principles (only with the engine preferring the principled move).
  if (moveNo <= 12 && bestMv) {
    const home = piecesAtHome(snapBefore, me);
    const r1 = played.moves[1];
    if (mv.piece === 'q' && moveNo <= 8 && home >= 2 && bestMv.piece !== 'q') {
      const snap2 = played.fens[2] ? snap(played.fens[2]) : null;
      const hitsQueen = r1 && snap2 && snap2[mv.to] && snap2[mv.to].type === 'q' && attacksFrom(snap2, r1.to).includes(mv.to);
      const movesAgain = played.moves.slice(2, 5).some((m) => m.color === me && m.piece === 'q');
      if (hitsQueen && (r1.piece === 'p' || isDevelop(r1))) {
        return {
          tag: 'earlyQueen', headline: 'Your queen came out too early.',
          why: [`After ${r1.san}, ${O} attacks your queen while bringing out a piece.`, 'Your queen has to move again, and you fall behind.'],
        };
      }
      if (movesAgain) {
        return {
          tag: 'earlyQueen', headline: 'Your queen came out too early.',
          why: [`You still have ${count(home)} knights and bishops at home.`, "In the engine's line, your queen has to move again soon, so you fall behind."],
        };
      }
      if (isDevelop(bestMv) || isCastle(bestMv)) {
        return { tag: 'earlyQueen', headline: 'Your queen came out too early.', why: [`You still have ${count(home)} knights and bishops at home, and the engine brings one out first.`] };
      }
    }
    if ((mv.piece === 'n' || mv.piece === 'b') && !HOME[me][mv.piece].includes(mv.from) && !mv.captured && moveNo <= 10 && home >= 2 && !enPrise(snapBefore, mv.from) && isDevelop(bestMv)) {
      return { tag: 'twice', headline: 'This moves the same piece twice.', why: [`Your ${NAME[mv.piece]} already moved, and ${count(home)} of your knights and bishops are still at home.`] };
    }
    if (moveNo <= 10 && home >= 2 && !isDevelop(mv) && !isCastle(mv) && !mv.captured && !(mv.piece === 'p' && 'de'.includes(mv.from[0])) && mv.piece !== 'q' && mv.piece !== 'k' && (isDevelop(bestMv) || isCastle(bestMv))) {
      return { tag: 'undeveloped', headline: 'This does not develop a piece.', why: [`${cap(count(home))} of your knights and bishops are still at home.`] };
    }
    if (moveNo <= 6 && mv.piece === 'p' && !'de'.includes(mv.from[0]) && bestMv.piece === 'p' && CENTER.includes(bestMv.to)) {
      return { tag: 'center', headline: 'This does not fight for the center.', why: ['Pawns in the middle of the board give your pieces room to come out.'] };
    }
  }

  // King safety.
  if (bestMv && !ctx.ch.inCheck()) {
    const rb = ctx.ch.getCastlingRights(me);
    const k = kingSq(snapBefore, me);
    if (moveNo >= 8 && k === (me === 'w' ? 'e1' : 'e8') && (rb.k || rb.q) && isCastle(bestMv) && !isCastle(mv)) {
      return { tag: 'kingCenter', headline: 'Your king needs to castle.', why: ['Your king is still in the center, and the engine wants to castle right now.'] };
    }
    if (k && mv.piece === 'p' && isShieldPawn(k, mv.from, me) && !(bestMv.piece === 'p' && isShieldPawn(k, bestMv.from, me))) {
      const check = played.moves.slice(1, 6).find((m) => m.color === opp && /[+#]/.test(m.san));
      if (check) {
        return { tag: 'shield', headline: 'This weakens your king.', why: [`Pushing the pawn in front of your king opens a way in.`, `In the engine's line, ${O} attacks it with ${check.san}.`] };
      }
    }
  }

  // Endgame ideas.
  if (bestMv && isEndgame(snapBefore)) {
    if (pawnEnding(snapBefore) && bestMv.piece === 'k' && inOpposition(better.fens[1]) && !inOpposition(mv.after)) {
      return { tag: 'opposition', headline: 'This misses the opposition.', why: [`${bestSan} puts the kings face to face with one square between them, and ${O} has to give way.`] };
    }
    if (bestMv.piece === 'p' && !bestMv.captured && isPassed(snapBefore, bestMv.from, me) && !(mv.piece === 'p' && isPassed(snapBefore, mv.from, me))) {
      const pushes = better.moves.filter((m) => m.color === me && m.piece === 'p').length;
      if (pushes >= 2 || promotionIn(better, me)) {
        return { tag: 'passer', headline: 'This holds back your passed pawn.', why: [`Your pawn on ${bestMv.from} is passed: no ${O} pawn can stop it.`, 'The engine wants to push it toward becoming a queen.'] };
      }
    }
    // Only when a piece moved instead: a pawn move changes the pawns, which is
    // more likely the real reason.
    const k = kingSq(snapBefore, me);
    if (bestMv.piece === 'k' && mv.piece !== 'k' && mv.piece !== 'p' && k && centerDist(bestMv.to) < centerDist(k)) {
      const kingMoves = better.moves.slice(0, 5).filter((m) => m.color === me && m.piece === 'k').length;
      if (kingMoves >= 2) {
        return { tag: 'activeKing', headline: 'Your king should join the fight.', why: [`In the endgame the king is a strong piece. The engine walks it toward the center, starting with ${bestSan}.`] };
      }
    }
  }

  // Nothing confirmed: say so honestly.
  return { tag: null, generic: true, headline: bestSan ? `The engine prefers ${bestSan}.` : 'The engine prefers another move.', why: [evalPhrase(before, after)] };
}

// Why a move was good (or why the hint move is the engine's choice).
function goodReason(ctx, w, m) {
  const { opp, afterCh, after, grade, bestSan, before, snapBefore, snapAfter, fen } = ctx;
  const O = sideName(opp);
  if (afterCh.isCheckmate()) return { tag: 'mateDone', headline: 'Checkmate!', why: [`${O}'s king is attacked and has no way out.`] };
  if (after && after.mate != null && after.mate > 0) {
    return { tag: 'forcesMate', headline: after.mate === 1 ? 'This sets up checkmate next move.' : `This forces checkmate in ${after.mate}.`, why: [] };
  }
  const r = positive(ctx, w, m, true, after);
  if (r) return r;
  if (grade === 'best') return { tag: null, generic: true, headline: "This is the engine's top choice.", why: [] };
  return {
    tag: null, generic: true, headline: 'Close to the best move.',
    why: bestSan ? [`The engine likes ${bestSan} a little more (${fmtScore(before)} instead of ${fmtScore(after)}).`] : [],
  };
}

// A confirmed good thing a move does: a tactic, a save, castling, a principle.
// `full` gives headline + detail (for the move itself); otherwise a short "It ..." line.
// `score` is the engine's score after the move m (from the mover's side).
function positive(ctx, w, m, full, score) {
  const { me, opp, fen, snapBefore } = ctx;
  const O = sideName(opp);
  const gain = settled(w, me, 0);
  // Pushing a passed pawn that goes on to queen.
  if (m.piece === 'p' && !m.captured && isPassed(snapBefore, m.from, me) && promotionIn(w, me, 14)) {
    return full
      ? { tag: 'pushPasser', headline: 'This pushes your passed pawn.', why: [`No ${O} pawn can stop it, and in the engine's line it becomes a queen.`] }
      : { short: 'It pushes your passed pawn, and it goes on to become a queen.' };
  }
  if (gain >= 1 && scoreShowsGain(ctx, gain, score)) {
    const t = classifyWin(w, me, 0, 1);
    if (t) {
      const words = winWords(t, O);
      return full ? { tag: 'win-' + words.tag, headline: words.headline, why: [words.detail] } : { short: words.short };
    }
  }
  const after = snap(w.fens[1]);
  // Saves a piece that was under attack.
  const loose = Object.keys(snapBefore)
    .filter((s) => snapBefore[s].color === me && enPrise(snapBefore, s))
    .sort((a, b) => VAL[snapBefore[b].type] - VAL[snapBefore[a].type]);
  if (loose.length && gain >= 0) {
    const s = loose[0];
    const p = snapBefore[s];
    let how = null;
    if (m.from === s && !enPrise(after, m.to)) how = m.captured ? 'tookWith' : 'moved';
    else if (after[s] && after[s].color === me && after[s].type === p.type && !enPrise(after, s)) how = m.captured && attackersOf(snapBefore, s, opp).includes(m.to) ? 'took' : 'guarded';
    if (how) {
      const name = NAME[p.type];
      const lead = `Your ${name} on ${s} was under attack.`;
      const tail = {
        moved: 'This moves it to a safe square.',
        tookWith: `This uses it to take on ${m.to}.`,
        took: 'This takes the attacker.',
        guarded: 'This move keeps it safe.',
      }[how];
      const short = {
        moved: `It moves your ${name} to safety.`,
        tookWith: `It uses your attacked ${name} to take on ${m.to}.`,
        took: `It takes the piece attacking your ${name}.`,
        guarded: `It keeps your ${name} on ${s} safe.`,
      }[how];
      return full ? { tag: 'saves', headline: `This keeps your ${name} safe.`, why: [lead, tail] } : { short };
    }
  }
  // Stops a checkmate threat.
  const threat = mateThreat(fen);
  if (threat && !mateInOne(w.fens[1])) {
    return full ? { tag: 'stopsMate', headline: 'This stops a checkmate threat.', why: [`${O} was threatening ${threat}.`] } : { short: `It stops ${O}'s checkmate threat (${threat}).` };
  }
  if (isCastle(m)) {
    return full ? { tag: 'castles', headline: 'Castling keeps your king safe.', why: ['Your king tucks into the corner, and a rook comes toward the middle.'] } : { short: 'It castles your king to safety.' };
  }
  if (ctx.moveNo <= 12 && isDevelop(m)) {
    return full ? { tag: 'develops', headline: 'This brings a new piece out.', why: [`Your ${NAME[m.piece]} joins the game.`] } : { short: `It brings your ${NAME[m.piece]} into the game.` };
  }
  if (ctx.moveNo <= 8 && m.piece === 'p' && CENTER.includes(m.to)) {
    return full ? { tag: 'centerPawn', headline: 'This takes the center.', why: ['A pawn in the middle gives your pieces room to come out.'] } : { short: 'It puts a pawn in the center.' };
  }
  if (isEndgame(snapBefore)) {
    if (pawnEnding(snapBefore) && m.piece === 'k' && inOpposition(w.fens[1])) {
      return full ? { tag: 'oppositionWin', headline: 'This takes the opposition.', why: [`The kings face each other with one square between them, and ${O} has to give way.`] } : { short: 'It takes the opposition.' };
    }
    if (m.piece === 'p' && !m.captured && isPassed(snapBefore, m.from, me)) {
      return full ? { tag: 'pushPasser', headline: 'This pushes your passed pawn.', why: [`No ${O} pawn can stop it, and it is closer to becoming a queen.`] } : { short: 'It pushes your passed pawn toward becoming a queen.' };
    }
    const k = kingSq(snapBefore, me);
    if (m.piece === 'k' && k && centerDist(m.to) < centerDist(k)) {
      return full ? { tag: 'kingUp', headline: 'This brings your king into play.', why: ['In the endgame the king is a strong piece.'] } : { short: 'It brings your king toward the center.' };
    }
  }
  return null;
}

// One sentence on why the engine's move is better than the one played.
function betterWhy(ctx, bad) {
  const { better, bestMv, top, before, after, me, played } = ctx;
  if (!better || !bestMv) return null;
  if (bad && bad.generic) return null; // the headline already names it and gives the scores
  if (new Chess(better.fens[1]).isCheckmate()) return 'It is checkmate.';
  if (bad && bad.betterShort) return bad.betterShort; // the reason already says what the better move does
  if (top && top.score && top.score.mate != null && top.score.mate > 0) return `It starts a forced checkmate in ${top.score.mate}.`;
  // Against a back-rank mate, a pawn move in front of the king makes an escape square.
  if (bad && (bad.tag === 'backRank' || bad.tag === 'allowMate' || bad.tag === 'mateThreat')) {
    const k = kingSq(ctx.snapBefore, me);
    if (bestMv.piece === 'p' && k && Math.abs(xy(bestMv.from)[0] - xy(k)[0]) <= 1 && Math.abs(xy(bestMv.from)[1] - xy(k)[1]) === 1) {
      return 'It gives your king a square to escape to, so a check on the back row is not mate.';
    }
    if (!(after && after.mate != null && after.mate < 0)) return 'It keeps your king safe.';
    return "It stops the checkmate.";
  }
  const r = positive(ctx, better, bestMv, false, top && top.score);
  const pm = settled(played, me, 0);
  const bm = settled(better, me, 0);
  const lostStuff = bad && ['hang', 'threat', 'trade', 'exchange', 'fork', 'pin', 'skewer', 'discovered', 'removeDefender', 'passerAllowed'].includes(bad.tag);
  if (lostStuff && bm > pm) {
    // After a lost piece, safety is the lesson; a win on top is a bonus.
    const v = ctx.victim;
    const plus = r && r.short && /^It wins /.test(r.short) ? ' ' + r.short.replace(/^It wins/, 'It also wins') : '';
    if (v && bestMv.from === v.sq && !bestMv.captured) return `It moves your ${NAME[v.type]} to safety.${plus}`;
    // A tactic or a save says more than "safe"; developing or castling says less.
    if (r && r.short && /forks|pinned|skewers|two threats|guard of|checkmate/.test(r.short)) return r.short;
    if (bm >= 0) return `It keeps all your pieces safe.${plus}`;
  }
  if (r && r.short) return r.short;
  return evalPhrase(before, after);
}

// ---------- pattern helpers ----------
function isBackRankMate(fenMate, victim, mateMove) {
  const pos = snap(fenMate);
  const k = kingSq(pos, victim);
  if (!k) return false;
  const back = victim === 'w' ? '1' : '8';
  if (k[1] !== back || mateMove.to[1] !== back || !'rq'.includes(mateMove.piece)) return false;
  const [x, y] = xy(k);
  const fwd = victim === 'w' ? 1 : -1;
  let own = 0;
  for (const dx of [-1, 0, 1]) {
    const s = sq(x + dx, y + fwd);
    if (s && pos[s] && pos[s].color === victim) own++;
  }
  return own >= 2;
}
// Is the piece on `s` pinned by one of `by`'s long-range pieces right now?
function pinnedIn(pos, s, by) {
  for (const t in pos) {
    const P = pos[t];
    if (P.color !== by || !RAYS[P.type]) continue;
    for (const [dx, dy] of RAYS[P.type]) {
      const [a, b] = rayHits(pos, t, dx, dy, 2);
      if (a !== s || !b || pos[b].color !== pos[s].color) continue;
      const B = pos[b];
      if (B.type === 'k' || (VAL[B.type] > VAL[pos[s].type] && (VAL[B.type] > VAL[P.type] || !guarded(pos, b)))) return true;
    }
  }
  return false;
}
function isShieldPawn(king, from, color) {
  const [kx, ky] = xy(king);
  const [px, py] = xy(from);
  const home = color === 'w' ? 0 : 7;
  if (ky !== home || Math.abs(px - kx) > 1) return false;
  if (kx === 3 || kx === 4) return false; // only a king that has gone to a side
  const step = color === 'w' ? py - ky : ky - py;
  return step === 1 || step === 2;
}
function inOpposition(fen) {
  const pos = snap(fen);
  const a = kingSq(pos, 'w');
  const b = kingSq(pos, 'b');
  if (!a || !b) return false;
  const [ax, ay] = xy(a);
  const [bx, by] = xy(b);
  return (ax === bx && Math.abs(ay - by) === 2) || (ay === by && Math.abs(ax - bx) === 2);
}
// The square, right after the first move of the line, of a `color` pawn that
// promotes within the trusted horizon.
function promotionIn(w, color, plies = HORIZON + 2) {
  if (!w) return null;
  for (let k = 0; k < Math.min(w.moves.length, plies); k++) {
    const m = w.moves[k];
    if (m.color !== color || !m.promotion) continue;
    let cur = m.from;
    for (let j = k - 2; j >= 1; j -= 2) if (w.moves[j].piece === 'p' && w.moves[j].to === cur) cur = w.moves[j].from;
    return cur;
  }
  return null;
}
function biggestLoss(w, side) {
  let best = null;
  for (let k = 1; k < Math.min(w.moves.length, HORIZON); k++) {
    const m = w.moves[k];
    if (m.color !== side && m.captured && (!best || VAL[m.captured] > VAL[best])) best = m.captured;
  }
  return best;
}

// ---------- "Show me" captions ----------
// "You play Nf3." / "Black plays dxe5 and takes your knight."
export function describePly(m, me) {
  const mine = m.color === me;
  const who = mine ? 'You play' : `${sideName(m.color)} plays`;
  let s = `${who} ${m.san}`;
  if (m.captured) s += mine ? ` and take the ${NAME[m.captured]}` : ` and takes your ${NAME[m.captured]}`;
  if (m.promotion) s += mine ? `, making a new ${NAME[m.promotion]}` : `, making a new ${NAME[m.promotion]}`;
  s += '.';
  if (m.san.endsWith('#')) s += ' Checkmate!';
  else if (m.san.endsWith('+')) s += ' Check.';
  return s;
}
// Plays a line for "Show me": [{ fen, move, text }], first entry = the start.
export function showLine(fen, line, me, max = 8) {
  const w = walk(fen, line, max);
  const steps = [{ fen: w.fens[0], move: null }];
  for (let k = 0; k < w.moves.length; k++) steps.push({ fen: w.fens[k + 1], move: w.moves[k], text: describePly(w.moves[k], me) });
  return { steps, net: settled(w, me, 0, w.moves.length), mate: w.moves.length ? w.moves[w.moves.length - 1].san.endsWith('#') : false };
}
// How a line ends, for the last "Show me" step.
export function netText(net, mate) {
  if (mate) return '';
  if (net === 0) return 'Material stays even.';
  return net > 0 ? `You come out ${points(net)} ahead.` : `You come out ${points(-net)} behind.`;
}
