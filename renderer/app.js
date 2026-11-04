// Chess Trainer — Play view logic.
// Rules/PGN/FEN: chess.js (vendored, offline). Engine: Stockfish in the main
// process via window.engine (preload.js). No network, no API keys.
import { Chess } from '../vendor/chess.js';
import { update, ensure } from './store.js';
import { matchOpening } from './openings.js';

const GLYPH = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' };
const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9 };
const DIFFICULTY = [
  { label: 'Very easy', skill: 0, movetime: 150 },
  { label: 'Easy', skill: 2, movetime: 250 },
  { label: 'Medium', skill: 5, movetime: 450 },
  { label: 'Hard', skill: 9, movetime: 700 },
  { label: 'Very hard', skill: 16, movetime: 1000 },
];
const MATE = 100000;
const COACH_THRESHOLD = 200; // centipawn drop that triggers a blunder warning
const PRACTICE = {
  kq: { fen: '8/8/8/4k3/8/8/4K3/3Q4 w - - 0 1', label: 'K+Q vs K' },
  kr: { fen: '8/8/8/4k3/8/8/4K3/3R4 w - - 0 1', label: 'K+R vs K' },
  '2r': { fen: '8/8/8/4k3/8/8/7R/R3K3 w - - 0 1', label: 'Two rooks vs K' },
  kp: { fen: '4k3/8/4K3/4P3/8/8/8/8 w - - 0 1', label: 'K+P (king in front)' },
};

ensure({ puzzles: [] });
const toCp = (s) => (!s ? 0 : s.mate != null ? (s.mate > 0 ? MATE - s.mate : -MATE - s.mate) : s.cp);

const game = new Chess();
let orientation = 'white';
let mode = 'computer';
let playerColor = 'w';
let diffIndex = 1;
let selected = null;
let legal = [];
let thinking = false;
let analyzing = false;
let coaching = false;
let animate = false;
let engineReqId = 0;
let evalReqId = 0;
let reviewMarks = {};
let coachMode = false;
let cctOn = false;
let practiceMode = false;
let practiceLabel = '';
const shownTips = new Set();

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const hasEngine = !!(window.engine && window.engine.bestMove);

const boardEl = document.getElementById('board');
const arrowsEl = document.getElementById('arrows');
const evalFillEl = document.getElementById('eval-fill');
const evalLineEl = document.getElementById('eval-line');
const statusEl = document.getElementById('status');
const openingEl = document.getElementById('opening');
const cctEl = document.getElementById('cct');
const coachTipEl = document.getElementById('coach-tip');
const coachEl = document.getElementById('coach');
const thinkingEl = document.getElementById('thinking');
const movesEl = document.getElementById('moves');
const movesEmptyEl = document.getElementById('moves-empty');
const materialEl = document.getElementById('material');
const reviewEl = document.getElementById('review');
const promotionEl = document.getElementById('promotion');
const gameoverEl = document.getElementById('gameover');
const copyHintEl = document.getElementById('copyhint');
const selMode = document.getElementById('sel-mode');
const selSide = document.getElementById('sel-side');
const selDiff = document.getElementById('sel-diff');
const selPractice = document.getElementById('sel-practice');
const chkCoach = document.getElementById('chk-coach');
const chkCct = document.getElementById('chk-cct');
const fieldSide = document.getElementById('field-side');
const fieldDiff = document.getElementById('field-diff');

const engineColor = () => (playerColor === 'w' ? 'b' : 'w');

// ---------- helpers ----------
function squareColor(square) {
  return (FILES.indexOf(square[0]) + Number(square[1])) % 2 === 0 ? 'light' : 'dark';
}
function positionMap() {
  const map = {};
  for (const row of game.board()) for (const cell of row) if (cell) map[cell.square] = cell;
  return map;
}
function kingSquare(color) {
  for (const row of game.board()) for (const cell of row) if (cell && cell.type === 'k' && cell.color === color) return cell.square;
  return null;
}
function lastMoveSquares() {
  const h = game.history({ verbose: true });
  if (!h.length) return null;
  const m = h[h.length - 1];
  return { from: m.from, to: m.to };
}
function displayFilesRanks() {
  const files = orientation === 'white' ? FILES : [...FILES].reverse();
  const ranks = orientation === 'white' ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8];
  return { files, ranks };
}
function squareCenter(square) {
  const { files, ranks } = displayFilesRanks();
  return { x: files.indexOf(square[0]) + 0.5, y: ranks.indexOf(Number(square[1])) + 0.5 };
}

// ---------- rendering ----------
function render() {
  clearArrows();
  const pos = positionMap();
  const last = lastMoveSquares();
  const { files, ranks } = displayFilesRanks();
  const checkSq = game.inCheck() ? kingSquare(game.turn()) : null;
  const targets = new Map();
  for (const m of legal) targets.set(m.to, m.isCapture() || m.isEnPassant() ? 'capture' : 'target');

  let html = '';
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const square = files[f] + ranks[r];
      const cls = ['sq', squareColor(square)];
      if (square === selected) cls.push('sel');
      if (last && (square === last.from || square === last.to)) cls.push('last');
      if (square === checkSq) cls.push('check');
      const t = targets.get(square);
      if (t) cls.push(t);
      const piece = pos[square];
      const glyph = piece ? `<span class="piece ${piece.color}">${GLYPH[piece.type]}</span>` : '';
      let coords = '';
      if (f === 0) coords += `<span class="coord rank">${ranks[r]}</span>`;
      if (r === 7) coords += `<span class="coord file">${files[f]}</span>`;
      html += `<div class="${cls.join(' ')}" data-square="${square}">${glyph}${coords}</div>`;
    }
  }
  boardEl.innerHTML = html;

  if (animate && last && !reduceMotion) animateLast(last);
  animate = false;

  renderStatus();
  renderOpening();
  renderMoves();
  renderMaterial();
  renderGameOver();
}

function animateLast(last) {
  const piece = boardEl.querySelector(`[data-square="${last.to}"] .piece`);
  if (!piece) return;
  const sq = boardEl.clientWidth / 8;
  const { files, ranks } = displayFilesRanks();
  const dx = (files.indexOf(last.from[0]) - files.indexOf(last.to[0])) * sq;
  const dy = (ranks.indexOf(Number(last.from[1])) - ranks.indexOf(Number(last.to[1]))) * sq;
  piece.parentElement.style.zIndex = '5';
  piece.style.transform = `translate(${dx}px, ${dy}px)`;
  requestAnimationFrame(() => {
    piece.style.transition = 'transform 180ms ease-out';
    piece.style.transform = 'translate(0, 0)';
    setTimeout(() => {
      piece.style.transition = '';
      if (piece.parentElement) piece.parentElement.style.zIndex = '';
    }, 220);
  });
}

function renderStatus() {
  let text;
  if (game.isCheckmate()) text = `Checkmate — ${game.turn() === 'w' ? 'Black' : 'White'} wins`;
  else if (game.isStalemate()) text = 'Stalemate — draw';
  else if (game.isThreefoldRepetition()) text = 'Draw by repetition';
  else if (game.isDrawByFiftyMoves()) text = 'Draw by 50-move rule';
  else if (game.isInsufficientMaterial()) text = 'Draw — insufficient material';
  else if (game.isDraw()) text = 'Draw';
  else {
    if (mode === 'computer') text = game.turn() === playerColor ? 'Your move' : 'Computer to move';
    else text = `${game.turn() === 'w' ? 'White' : 'Black'} to move`;
    if (game.inCheck()) text += ' — check!';
  }
  statusEl.textContent = text;
  thinkingEl.classList.toggle('hidden', !thinking);
  const showCct = cctOn && !game.isGameOver() && (mode === 'passplay' || game.turn() === playerColor);
  if (cctEl) cctEl.classList.toggle('hidden', !showCct);
}

function renderOpening() {
  if (!openingEl) return;
  if (practiceMode) { openingEl.textContent = 'Practice: ' + practiceLabel; return; }
  const name = matchOpening(game.history());
  openingEl.textContent = name ? 'Opening: ' + name : '';
}

function renderMoves() {
  const h = game.history({ verbose: true });
  if (!h.length) {
    movesEl.innerHTML = '';
    movesEmptyEl.style.display = '';
    return;
  }
  movesEmptyEl.style.display = 'none';
  const mark = (ply) => {
    const q = reviewMarks[ply];
    if (!q) return '';
    const cls = q === '??' ? 'blunder' : q === '?' ? 'mistake' : 'inacc';
    return `<span class="mk ${cls}">${q}</span>`;
  };
  let rows = '';
  for (let i = 0; i < h.length; i += 2) {
    const n = i / 2 + 1;
    const w = h[i] ? h[i].san + mark(i) : '';
    const b = h[i + 1] ? h[i + 1].san + mark(i + 1) : '';
    const wCur = i === h.length - 1 ? ' class="cur"' : '';
    const bCur = i + 1 === h.length - 1 ? ' class="cur"' : '';
    rows += `<tr><td class="num">${n}.</td><td${wCur}>${w}</td><td${bCur}>${b}</td></tr>`;
  }
  movesEl.innerHTML = rows;
  const wrap = movesEl.closest('.movelist-wrap');
  if (wrap) wrap.scrollTop = wrap.scrollHeight;
}

function renderMaterial() {
  const counts = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };
  for (const row of game.board()) for (const cell of row) if (cell && cell.type !== 'k') counts[cell.color][cell.type]++;
  const start = { p: 8, n: 2, b: 2, r: 2, q: 1 };
  const byWhite = [];
  const byBlack = [];
  let wMat = 0;
  let bMat = 0;
  for (const t of ['q', 'r', 'b', 'n', 'p']) {
    for (let i = 0; i < start[t] - counts.b[t]; i++) byWhite.push(t);
    for (let i = 0; i < start[t] - counts.w[t]; i++) byBlack.push(t);
    wMat += counts.w[t] * VALUE[t];
    bMat += counts.b[t] * VALUE[t];
  }
  const net = wMat - bMat;
  const glyphs = (arr, color) =>
    arr.length ? arr.map((t) => `<span class="cap ${color}">${GLYPH[t]}</span>`).join('') : '<span class="cap-none">—</span>';
  const netText = net === 0 ? 'Material even' : net > 0 ? `White ahead +${net}` : `Black ahead +${-net}`;
  materialEl.innerHTML =
    `<div class="mat-row"><span class="mat-label">White took</span><span class="mat-pieces">${glyphs(byWhite, 'b')}</span></div>` +
    `<div class="mat-row"><span class="mat-label">Black took</span><span class="mat-pieces">${glyphs(byBlack, 'w')}</span></div>` +
    `<div class="mat-net">${netText}</div>`;
}

function renderGameOver() {
  if (!game.isGameOver()) {
    gameoverEl.classList.add('hidden');
    gameoverEl.innerHTML = '';
    return;
  }
  let title;
  if (game.isCheckmate()) title = `Checkmate — ${game.turn() === 'w' ? 'Black' : 'White'} wins`;
  else if (game.isStalemate()) title = 'Stalemate — draw';
  else title = 'Game over — draw';
  gameoverEl.innerHTML = `
    <div class="go-card">
      <div class="go-title">${title}</div>
      <button id="go-analyze">Review my game</button>
      <button id="go-review" class="primary">Copy for Claude</button>
      <button id="go-new">New game</button>
    </div>`;
  gameoverEl.classList.remove('hidden');
  document.getElementById('go-analyze').addEventListener('click', () => { gameoverEl.classList.add('hidden'); analyzeGame(); });
  document.getElementById('go-review').addEventListener('click', copyForReview);
  document.getElementById('go-new').addEventListener('click', newGame);
}

// ---------- eval bar ----------
function whiteScore(score, turn) {
  if (!score) return null;
  if (score.mate != null) return { mate: turn === 'w' ? score.mate : -score.mate };
  return { cp: turn === 'w' ? score.cp : -score.cp };
}
function setEvalBar(score, turn) {
  const w = whiteScore(score, turn);
  if (!w) { evalFillEl.style.height = '50%'; evalLineEl.textContent = ''; return; }
  let pct;
  let label;
  if (w.mate != null) {
    pct = w.mate > 0 ? 98 : 2;
    label = `Eval: M${Math.abs(w.mate)} (${w.mate > 0 ? 'White' : 'Black'})`;
  } else {
    const cp = Math.max(-1500, Math.min(1500, w.cp));
    pct = 100 / (1 + Math.exp(-cp / 350));
    const n = w.cp / 100;
    label = `Eval: ${n > 0 ? '+' : ''}${n.toFixed(1)}`;
  }
  evalFillEl.style.height = pct + '%';
  evalLineEl.textContent = label;
}
async function updateEval() {
  if (!hasEngine) return;
  if (game.isGameOver()) {
    if (game.isCheckmate()) setEvalBar({ mate: 0 }, game.turn() === 'w' ? 'b' : 'w');
    else { evalFillEl.style.height = '50%'; evalLineEl.textContent = 'Eval: draw'; }
    return;
  }
  const id = ++evalReqId;
  const fen = game.fen();
  const turn = game.turn();
  let r;
  try { r = await window.engine.evaluate(fen, { movetime: 220 }); } catch (_) { return; }
  if (id !== evalReqId) return;
  setEvalBar(r.score, turn);
}

// ---------- arrows / hint ----------
function clearArrows() { arrowsEl.innerHTML = ''; }
function drawArrow(from, to) {
  const a = squareCenter(from);
  const b = squareCenter(to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const ex = b.x - ux * 0.3;
  const ey = b.y - uy * 0.3;
  const hw = 0.16;
  const lx = ex - uy * hw;
  const ly = ey + ux * hw;
  const rx = ex + uy * hw;
  const ry = ey - ux * hw;
  arrowsEl.innerHTML =
    `<line x1="${a.x}" y1="${a.y}" x2="${ex}" y2="${ey}" />` +
    `<polygon points="${b.x - ux * 0.04},${b.y - uy * 0.04} ${lx},${ly} ${rx},${ry}" />`;
}

async function hint() {
  if (!hasEngine) return flashHint('Engine unavailable.');
  if (thinking || analyzing || coaching || game.isGameOver()) return;
  if (mode === 'computer' && game.turn() !== playerColor) return;
  flashHint('Thinking of a hint…');
  const id = ++engineReqId;
  let r;
  try { r = await window.engine.evaluate(game.fen(), { movetime: 600 }); } catch (_) { return flashHint('Engine error.'); }
  if (id !== engineReqId) return;
  if (!r || !r.best) return flashHint('No hint available.');
  const from = r.best.slice(0, 2);
  const to = r.best.slice(2, 4);
  drawArrow(from, to);
  let san = r.best;
  try { const mv = game.move({ from, to, promotion: r.best[4] }); san = mv.san; game.undo(); } catch (_) {}
  flashHint('Hint: try ' + san);
}

// ---------- interaction ----------
function clearSelection() { selected = null; legal = []; }
function clearReview() { reviewMarks = {}; reviewEl.classList.add('hidden'); reviewEl.innerHTML = ''; }
function canSelect(square) {
  const piece = game.get(square);
  if (!piece || piece.color !== game.turn()) return false;
  if (mode === 'computer' && piece.color !== playerColor) return false;
  return true;
}
function selectSquare(square) {
  selected = square;
  legal = game.moves({ square, verbose: true });
  render();
}

function onSquareClick(square) {
  if (!promotionEl.classList.contains('hidden')) return;
  if (!coachEl.classList.contains('hidden')) return;
  if (thinking || analyzing || coaching || game.isGameOver()) return;
  if (selected) {
    const mv = legal.find((m) => m.to === square);
    if (mv) return playMove(mv);
    if (canSelect(square)) return selectSquare(square);
    clearSelection();
    render();
    return;
  }
  if (canSelect(square)) selectSquare(square);
}

function playMove(mv) {
  if (mv.isPromotion()) {
    askPromotion(mv.color, (p) => commitMove({ from: mv.from, to: mv.to, promotion: p }, true));
    return;
  }
  commitMove({ from: mv.from, to: mv.to }, true);
}

function commitMove(desc, human) {
  const preFen = human ? game.fen() : null;
  try {
    game.move(desc);
  } catch (_) {
    clearSelection();
    render();
    return;
  }
  clearSelection();
  if (human) clearReview();
  animate = true;
  render();
  updateEval();
  if (human) afterHumanMove(preFen);
}

async function afterHumanMove(preFen) {
  if (coachMode) openingTip();
  if (coachMode && mode === 'computer' && hasEngine && !game.isGameOver()) {
    coaching = true;
    const reqId = ++engineReqId;
    let pre;
    let post;
    try {
      pre = await window.engine.evaluate(preFen, { movetime: 240 });
      post = await window.engine.evaluate(game.fen(), { movetime: 240 });
    } catch (_) { coaching = false; return maybeEngineMove(); }
    if (reqId !== engineReqId) { coaching = false; return; }
    coaching = false;
    const loss = toCp(pre.score) + toCp(post.score);
    if (loss >= COACH_THRESHOLD) return showCoachNudge(loss);
  }
  maybeEngineMove();
}

function showCoachNudge(loss) {
  const pawns = (loss / 100).toFixed(1);
  coachEl.innerHTML = `<div class="coach-card">
    <div class="coach-title">Heads up — that looks like a blunder</div>
    <div class="coach-sub">It drops about ${pawns} points of material/advantage. Take it back and try a different move?</div>
    <div class="coach-actions"><button id="coach-takeback" class="primary">Take it back</button><button id="coach-keep">Keep playing</button></div>
  </div>`;
  coachEl.classList.remove('hidden');
  document.getElementById('coach-takeback').addEventListener('click', () => {
    coachEl.classList.add('hidden');
    coachEl.innerHTML = '';
    engineReqId++;
    game.undo();
    clearSelection();
    render();
    updateEval();
  });
  document.getElementById('coach-keep').addEventListener('click', () => {
    coachEl.classList.add('hidden');
    coachEl.innerHTML = '';
    maybeEngineMove();
  });
}

function openingTip() {
  const h = game.history({ verbose: true });
  if (!h.length) return;
  const last = h[h.length - 1];
  if (mode === 'computer' && last.color !== playerColor) return;
  const moveNo = Math.ceil(h.length / 2);
  if (last.piece === 'q' && (last.from === 'd1' || last.from === 'd8') && moveNo <= 4 && !shownTips.has('q')) {
    shownTips.add('q');
    return coachTip('Tip: bringing the queen out this early lets your opponent develop with tempo by attacking it. Develop knights and bishops first.');
  }
  if (last.piece === 'k' && !last.isKingsideCastle() && !last.isQueensideCastle() && moveNo <= 12 && !shownTips.has('k')) {
    shownTips.add('k');
    return coachTip('Tip: moving your king (instead of castling) gives up the right to castle and can leave it exposed.');
  }
  if (moveNo >= 12 && !shownTips.has('castle')) {
    const myColor = mode === 'computer' ? playerColor : last.color;
    const home = myColor === 'w' ? 'e1' : 'e8';
    const castled = h.some((m) => m.color === myColor && (m.isKingsideCastle() || m.isQueensideCastle()));
    if (!castled && kingSquare(myColor) === home) {
      shownTips.add('castle');
      coachTip('Tip: you haven’t castled yet. Castling tucks your king to safety and connects your rooks — consider it soon.');
    }
  }
}

let tipTimer = null;
function coachTip(msg) {
  if (!coachTipEl) return;
  coachTipEl.textContent = msg || '';
  coachTipEl.classList.toggle('hidden', !msg);
  if (tipTimer) clearTimeout(tipTimer);
  if (msg) tipTimer = setTimeout(() => { coachTipEl.textContent = ''; coachTipEl.classList.add('hidden'); }, 8000);
}

async function maybeEngineMove() {
  if (mode !== 'computer' || game.isGameOver() || game.turn() !== engineColor()) return;
  if (!hasEngine) return flashHint('Engine unavailable — switch to Pass & play.');
  thinking = true;
  const reqId = ++engineReqId;
  renderStatus();
  const d = DIFFICULTY[diffIndex];
  let uci;
  try {
    uci = await window.engine.bestMove(game.fen(), { skill: d.skill, movetime: d.movetime });
  } catch (_) {
    if (reqId === engineReqId) { thinking = false; flashHint('Engine error.'); renderStatus(); }
    return;
  }
  if (reqId !== engineReqId) return;
  thinking = false;
  if (uci && uci !== '(none)') {
    const desc = { from: uci.slice(0, 2), to: uci.slice(2, 4) };
    if (uci.length > 4) desc.promotion = uci[4];
    try { game.move(desc); animate = true; } catch (_) {}
  }
  render();
  updateEval();
}

function askPromotion(color, cb) {
  const pieces = ['q', 'r', 'b', 'n'];
  promotionEl.innerHTML =
    `<div class="promo-card"><div class="promo-title">Promote to</div><div class="promo-row">` +
    pieces.map((p) => `<button class="promo-btn ${color}" data-piece="${p}">${GLYPH[p]}</button>`).join('') +
    `</div></div>`;
  promotionEl.classList.remove('hidden');
  function cleanup() {
    promotionEl.classList.add('hidden');
    promotionEl.removeEventListener('click', handler);
    promotionEl.innerHTML = '';
  }
  function handler(e) {
    if (e.target === promotionEl) { cleanup(); clearSelection(); render(); return; }
    const btn = e.target.closest('[data-piece]');
    if (!btn) return;
    cleanup();
    cb(btn.dataset.piece);
  }
  promotionEl.addEventListener('click', handler);
}

// ---------- game review ----------
async function analyzeGame() {
  if (!hasEngine) return flashHint('Engine unavailable.');
  if (game.history().length === 0) return flashHint('Play a game first, then review it.');
  if (analyzing) return;
  analyzing = true;
  clearReview();
  const verbose = game.history({ verbose: true });
  const N = verbose.length;
  const tmp = new Chess();
  const fens = [tmp.fen()];
  for (const m of verbose) {
    tmp.move({ from: m.from, to: m.to, promotion: m.promotion });
    fens.push(tmp.fen());
  }
  const scores = new Array(fens.length).fill(null);
  const bests = new Array(fens.length).fill(null);
  const reviewId = ++engineReqId;
  for (let i = 0; i < fens.length; i++) {
    flashHint(`Reviewing… ${i}/${N}`);
    let r;
    try { r = await window.engine.evaluate(fens[i], { movetime: 220 }); } catch (_) { analyzing = false; return flashHint('Review failed.'); }
    if (reviewId !== engineReqId) { analyzing = false; return; }
    scores[i] = r.score;
    bests[i] = r.best;
  }

  const items = [];
  for (let i = 0; i < N; i++) {
    const mover = i % 2 === 0 ? 'w' : 'b';
    const loss = toCp(scores[i]) + toCp(scores[i + 1]);
    let q = '';
    if (loss >= 300) q = '??';
    else if (loss >= 150) q = '?';
    else if (loss >= 90) q = '?!';
    if (q) reviewMarks[i] = q;
    let bestSan = '';
    if (bests[i]) {
      try {
        const tb = new Chess(fens[i]);
        bestSan = tb.move({ from: bests[i].slice(0, 2), to: bests[i].slice(2, 4), promotion: bests[i][4] }).san;
      } catch (_) {}
    }
    items.push({ i, mover, san: verbose[i].san, q, loss: Math.round(loss), bestSan, fen: fens[i], bestUci: bests[i] });
  }
  analyzing = false;
  renderMoves();
  renderReview(items);
  flashHint('Review complete — see the flagged moves.');
}

function renderReview(items) {
  const scope = mode === 'computer' ? items.filter((it) => it.mover === playerColor) : items;
  const counts = { '??': 0, '?': 0, '?!': 0 };
  for (const it of scope) if (it.q) counts[it.q]++;
  const worst = scope.filter((it) => it.q).sort((a, b) => b.loss - a.loss).slice(0, 6);
  const moveNo = (i) => `${Math.floor(i / 2) + 1}${i % 2 === 0 ? '.' : '...'}`;

  let html = `<div class="review-head">Game review${mode === 'computer' ? ' — your moves' : ''}</div>`;
  html += `<div class="review-counts"><span class="rq blunder">${counts['??']} blunders</span><span class="rq mistake">${counts['?']} mistakes</span><span class="rq inacc">${counts['?!']} inaccuracies</span></div>`;
  if (worst.length === 0) {
    html += `<div class="review-empty">No serious mistakes flagged — well played!</div>`;
  } else {
    html += '<ul class="review-list">';
    for (let k = 0; k < worst.length; k++) {
      const it = worst[k];
      const cls = it.q === '??' ? 'blunder' : it.q === '?' ? 'mistake' : 'inacc';
      const save = hasEngine && it.bestUci && it.fen ? ` <button class="rv-save" data-k="${k}">Save as puzzle</button>` : '';
      html += `<li><span class="rq ${cls}">${moveNo(it.i)} ${it.san}${it.q}</span> — better was <b>${it.bestSan || '—'}</b>${save}</li>`;
    }
    html += '</ul>';
    html += `<div class="review-tip">Save any of these to your <b>Learn → Daily review</b> deck, or copy the game and ask Claude to explain them.</div>`;
  }
  reviewEl.innerHTML = html;
  reviewEl.classList.remove('hidden');
  reviewEl.querySelectorAll('.rv-save').forEach((btn) =>
    btn.addEventListener('click', () => addGamePuzzle(worst[Number(btn.dataset.k)], btn)));
}

function addGamePuzzle(item, btn) {
  if (!item || !item.bestUci || !item.fen) return;
  const id = 'g' + Date.now().toString(36) + item.i;
  const side = item.mover;
  const prompt = `${side === 'w' ? 'White' : 'Black'} to move — find the best move.`;
  const idea = `From your game: you played ${item.san}${item.q}.` + (item.bestSan ? ` Stronger was ${item.bestSan}.` : '');
  update((s) => {
    s.puzzles = s.puzzles || [];
    if (!s.puzzles.some((p) => p.fen === item.fen)) {
      s.puzzles.push({ id, theme: 'From your game', level: 0, side, goal: 'best', fen: item.fen, solution: item.bestUci, prompt, idea });
    }
  });
  if (btn) { btn.textContent = 'Saved ✓'; btn.disabled = true; }
  flashHint('Saved to your puzzle deck (Learn → Daily review).');
}

// ---------- controls ----------
async function applyFreshGame() {
  engineReqId++;
  thinking = false;
  analyzing = false;
  coaching = false;
  practiceMode = false;
  practiceLabel = '';
  if (selPractice) selPractice.value = '';
  shownTips.clear();
  coachTip('');
  game.reset();
  clearSelection();
  clearReview();
  orientation = mode === 'computer' && playerColor === 'b' ? 'black' : 'white';
  flashHint('');
  if (hasEngine) { try { await window.engine.newGame(); } catch (_) {} }
  render();
  updateEval();
  if (mode === 'computer' && engineColor() === game.turn()) maybeEngineMove();
}

function newGame() {
  if (game.history().length > 0 && !game.isGameOver()) {
    if (!window.confirm('Start a new game? The current game will be cleared.')) return;
  }
  applyFreshGame();
}

function loadPractice(v) {
  const p = PRACTICE[v];
  if (!p) return;
  engineReqId++;
  thinking = false;
  analyzing = false;
  coaching = false;
  shownTips.clear();
  coachTip('');
  mode = 'computer';
  selMode.value = 'computer';
  try { game.load(p.fen); } catch (_) { return; }
  practiceMode = true;
  practiceLabel = p.label;
  playerColor = game.turn();
  selSide.value = playerColor;
  orientation = playerColor === 'w' ? 'white' : 'black';
  clearSelection();
  clearReview();
  updateSetupVisibility();
  if (hasEngine) { try { window.engine.newGame(); } catch (_) {} }
  flashHint(`Practice: ${p.label}. You play ${playerColor === 'w' ? 'White' : 'Black'} — execute the technique; the computer defends.`);
  render();
  updateEval();
}

function undo() {
  if (thinking || analyzing || coaching || game.history().length === 0) return;
  engineReqId++;
  clearReview();
  if (mode === 'computer') {
    game.undo();
    if (game.history().length > 0 && game.turn() !== playerColor) game.undo();
  } else {
    game.undo();
  }
  clearSelection();
  render();
  updateEval();
}

function flip() {
  orientation = orientation === 'white' ? 'black' : 'white';
  render();
}

// ---------- export ----------
function pad(n) { return String(n).padStart(2, '0'); }
function resultString() {
  if (game.isCheckmate()) return game.turn() === 'w' ? '0-1' : '1-0';
  if (game.isGameOver()) return '1/2-1/2';
  return '*';
}
function setPgnHeaders() {
  const d = new Date();
  const sf = `Stockfish (${DIFFICULTY[diffIndex].label})`;
  const white = mode === 'computer' ? (playerColor === 'w' ? 'Player' : sf) : 'Player';
  const black = mode === 'computer' ? (playerColor === 'b' ? 'Player' : sf) : 'Player';
  game.setHeader('Event', 'Chess Trainer');
  game.setHeader('Site', 'Chess Trainer (offline)');
  game.setHeader('Date', `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`);
  game.setHeader('White', white);
  game.setHeader('Black', black);
  game.setHeader('Result', resultString());
}

async function copyPgn() {
  if (game.history().length === 0) return flashHint('No moves to copy yet.');
  setPgnHeaders();
  const ok = await copyText(game.pgn());
  flashHint(ok ? 'PGN copied to clipboard.' : 'Copy failed — select and copy manually.');
}
async function copyFen() {
  const ok = await copyText(game.fen());
  flashHint(ok ? 'FEN copied to clipboard.' : 'Copy failed.');
}
async function copyForReview() {
  if (game.history().length === 0) return flashHint('Play some moves first, then copy the game.');
  setPgnHeaders();
  const result = resultString();
  const youAre = mode === 'computer' ? (playerColor === 'w' ? 'White' : 'Black') : 'both sides';
  const lines = [
    "I'm a beginner learning chess. Please review this game I just played and coach me:",
    '- What were my best and worst moves?',
    '- Where did the game turn, and what should I have played?',
    '- 2-3 concrete things to work on next time.',
    '',
    `I played: ${youAre}`,
    `Result: ${result === '*' ? 'unfinished' : result}`,
    `Moves played: ${game.history().length}`,
    '',
    'PGN:',
    game.pgn(),
    '',
    `Final position (FEN): ${game.fen()}`,
  ];
  const ok = await copyText(lines.join('\n'));
  flashHint(ok ? 'Game copied — paste it to Claude in chat.' : 'Copy failed — select and copy manually.');
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (_) {
      return false;
    }
  }
}

let hintTimer = null;
function flashHint(msg) {
  copyHintEl.textContent = msg;
  if (hintTimer) clearTimeout(hintTimer);
  if (msg) hintTimer = setTimeout(() => { copyHintEl.textContent = ''; }, 4500);
}

// ---------- setup controls ----------
function updateSetupVisibility() {
  const computer = mode === 'computer';
  fieldSide.style.display = computer ? '' : 'none';
  fieldDiff.style.display = computer ? '' : 'none';
}

selMode.addEventListener('change', () => {
  const v = selMode.value;
  if (v === mode) return;
  if (game.history().length > 0 && !game.isGameOver() && !window.confirm('Change opponent and start a new game?')) {
    selMode.value = mode;
    return;
  }
  mode = v;
  updateSetupVisibility();
  applyFreshGame();
});
selSide.addEventListener('change', () => {
  const v = selSide.value;
  if (v === playerColor) return;
  if (game.history().length > 0 && !game.isGameOver() && !window.confirm('Switch sides and start a new game?')) {
    selSide.value = playerColor;
    return;
  }
  playerColor = v;
  applyFreshGame();
});
selDiff.addEventListener('change', () => {
  diffIndex = Number(selDiff.value);
  flashHint('Difficulty: ' + DIFFICULTY[diffIndex].label);
});
if (selPractice) {
  selPractice.addEventListener('change', () => {
    const v = selPractice.value;
    if (!v) { applyFreshGame(); return; }
    if (game.history().length > 0 && !game.isGameOver() && !window.confirm('Load this practice position? The current game will be cleared.')) {
      selPractice.value = practiceMode ? v : '';
      return;
    }
    loadPractice(v);
  });
}
if (chkCoach) chkCoach.addEventListener('change', () => { coachMode = chkCoach.checked; if (!coachMode) coachTip(''); });
if (chkCct) chkCct.addEventListener('change', () => { cctOn = chkCct.checked; renderStatus(); });

// ---------- wiring ----------
boardEl.addEventListener('click', (e) => {
  const cell = e.target.closest('[data-square]');
  if (cell) onSquareClick(cell.dataset.square);
});
document.getElementById('btn-new').addEventListener('click', newGame);
document.getElementById('btn-undo').addEventListener('click', undo);
document.getElementById('btn-flip').addEventListener('click', flip);
document.getElementById('btn-hint').addEventListener('click', hint);
document.getElementById('btn-analyze').addEventListener('click', analyzeGame);
document.getElementById('btn-review').addEventListener('click', copyForReview);
document.getElementById('btn-pgn').addEventListener('click', copyPgn);
document.getElementById('btn-fen').addEventListener('click', copyFen);
document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') undo();
});

// Play / Learn tabs
const tabPlay = document.getElementById('tab-play');
const tabLearn = document.getElementById('tab-learn');
const playView = document.getElementById('play-view');
const learnViewEl = document.getElementById('learn-view');
function showTab(which) {
  const learn = which === 'learn';
  playView.classList.toggle('hidden', learn);
  learnViewEl.classList.toggle('hidden', !learn);
  tabPlay.classList.toggle('on', !learn);
  tabLearn.classList.toggle('on', learn);
  if (learn && window.learnView) window.learnView.refresh();
}
tabPlay.addEventListener('click', () => showTab('play'));
tabLearn.addEventListener('click', () => showTab('learn'));

if (!hasEngine) {
  mode = 'passplay';
  selMode.value = 'passplay';
  const opt = selMode.querySelector('option[value="computer"]');
  if (opt) opt.disabled = true;
  document.getElementById('btn-hint').disabled = true;
  document.getElementById('btn-analyze').disabled = true;
  if (selPractice) selPractice.disabled = true;
  if (chkCoach) chkCoach.disabled = true;
  flashHint('Engine not detected — running in Pass & play mode.');
}
updateSetupVisibility();
render();
updateEval();
