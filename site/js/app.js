// Chess Trainer: Play view logic.
// Rules/PGN/FEN: chess.js (vendored). Engine: Stockfish in a Web Worker
// (engine.js). The "why" coach: why.js explains moves, tips.js picks tip
// cards. Everything runs in the browser; no accounts, no API keys.
import { Chess } from '../vendor/chess.js';
import { update, ensure } from './store.js';
import { matchOpening } from './openings.js';
import { engine } from './engine.js';
import { explainMove, gradeMove, isFlagged, flip as flipScore, showLine, netText, GRADE_LABEL, GRADE_MARK } from './why.js';
import { startTip, repeatTip, recordMistake, findLesson } from './tips.js';

// U+FE0E keeps the pawn a text glyph: some phones otherwise draw it as an emoji.
const GLYPH = { p: '♟︎', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' };
const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9 };
const DIFFICULTY = [
  { label: 'Very easy', skill: 0, movetime: 150 },
  { label: 'Easy', skill: 2, movetime: 250 },
  { label: 'Medium', skill: 5, movetime: 450 },
  { label: 'Hard', skill: 9, movetime: 700 },
  { label: 'Very hard', skill: 16, movetime: 1000 },
];
// The coach's time budget, so an explanation shows in about a second on a
// phone. The player's own position is searched while he thinks (three lines,
// for the better move); the position after his move gets one quick line.
const COACH_PRE = { movetime: 700, multipv: 3 };
const COACH_POST = { movetime: 600, multipv: 1 };
const HINT_SEARCH = { movetime: 700, multipv: 3 };
const EVAL_SEARCH = { movetime: 220, multipv: 1 };
const NUDGE_LOSS = 200; // centipawns lost before the coach offers a takeback
const PRACTICE = {
  kq: { fen: '8/8/8/4k3/8/8/4K3/3Q4 w - - 0 1', label: 'K+Q vs K' },
  kr: { fen: '8/8/8/4k3/8/8/4K3/3R4 w - - 0 1', label: 'K+R vs K' },
  '2r': { fen: '8/8/8/4k3/8/8/7R/R3K3 w - - 0 1', label: 'Two rooks vs K' },
  kp: { fen: '4k3/8/4K3/4P3/8/8/8/8 w - - 0 1', label: 'K+P (king in front)' },
};
const START_FEN = new Chess().fen();

ensure({ puzzles: [] });
const toCp = (s) => (!s ? 0 : s.mate != null ? (s.mate > 0 ? 100000 - s.mate : -100000 - s.mate) : s.cp);

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
let reviewItems = [];
let coachMode = false;
let cctOn = false;
let practiceMode = false;
let practiceLabel = '';
let gameId = newGameId();
let whyState = null; // what the coach panel shows
let preview = null; // "Show me": a line played out on the board
let boardArrows = []; // [{ uci, kind: 'hint' | 'good' | 'bad' | 'next' }]
let tipState = null; // the one tip card
const shownRepeats = new Set(); // repeat-mistake cards already shown this game
let whyFolded = readFolded();

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const hasEngine = engine.supported;

const boardEl = document.getElementById('board');
const boardAreaEl = document.querySelector('.board-area');
const arrowsEl = document.getElementById('arrows');
const evalFillEl = document.getElementById('eval-fill');
const evalLineEl = document.getElementById('eval-line');
const statusEl = document.getElementById('status');
const openingEl = document.getElementById('opening');
const cctEl = document.getElementById('cct');
const whyEl = document.getElementById('why');
const tipEl = document.getElementById('tipcard');
const thinkingEl = document.getElementById('thinking');
const thinkingTextEl = document.getElementById('thinking-text');
const copySheetEl = document.getElementById('copy-sheet');
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
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------- helpers ----------
function newGameId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
function readFolded() {
  try { return localStorage.getItem('chessTrainer.whyFolded') === '1'; } catch (_) { return false; }
}
function saveFolded() {
  try { localStorage.setItem('chessTrainer.whyFolded', whyFolded ? '1' : '0'); } catch (_) {}
}
const uciOf = (m) => m.from + m.to + (m.promotion || '');
function sanOf(fen, uci) {
  try { return new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san; } catch (_) { return uci; }
}
function squareColor(square) {
  return (FILES.indexOf(square[0]) + Number(square[1])) % 2 === 0 ? 'light' : 'dark';
}
// The position on the board: the game, or a "Show me" line.
const shown = () => (preview ? preview.chess : game);
function positionMap(g) {
  const map = {};
  for (const row of g.board()) for (const cell of row) if (cell) map[cell.square] = cell;
  return map;
}
function kingSquare(color, g = game) {
  for (const row of g.board()) for (const cell of row) if (cell && cell.type === 'k' && cell.color === color) return cell.square;
  return null;
}
function lastMoveSquares() {
  if (preview) return preview.last;
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
function startingFen() {
  const h = game.getHeaders();
  return (h && h.FEN) || START_FEN;
}

// ---------- engine lines, shared by the eval bar, the coach and the hint ----------
// Keyed by position (without the move counters). A pending search is shared,
// so the coach and the eval bar never search the same position twice.
const cache = new Map();
const pending = new Map();
const posKey = (fen) => fen.split(' ').slice(0, 4).join(' ');
function analyzeCached(fen, opts) {
  const key = posKey(fen);
  const enough = (e) => e && e.multipv >= opts.multipv && e.movetime >= opts.movetime;
  const hit = cache.get(key);
  if (enough(hit)) return Promise.resolve(hit.r);
  const wait = pending.get(key);
  if (enough(wait)) return wait.promise;
  const promise = engine.analyze(fen, opts).then((r) => {
    cache.set(key, { r, multipv: opts.multipv, movetime: opts.movetime });
    if (cache.size > 80) cache.delete(cache.keys().next().value);
    return r;
  });
  const entry = { promise, multipv: opts.multipv, movetime: opts.movetime };
  pending.set(key, entry);
  const clear = () => { if (pending.get(key) === entry) pending.delete(key); };
  promise.then(clear, clear);
  return promise;
}
// With Coach mode on, the player's own positions get the coach's search (it
// also feeds the eval bar), and the position after his move the quick one.
function searchFor(fen) {
  if (coachMode && mode === 'computer' && hasEngine) return fen.split(' ')[1] === playerColor ? COACH_PRE : COACH_POST;
  return EVAL_SEARCH;
}

// ---------- rendering ----------
function render() {
  const g = shown();
  const pos = positionMap(g);
  const last = lastMoveSquares();
  const { files, ranks } = displayFilesRanks();
  const checkSq = g.inCheck() ? kingSquare(g.turn(), g) : null;
  const targets = new Map();
  if (!preview) for (const m of legal) targets.set(m.to, m.isCapture() || m.isEnPassant() ? 'capture' : 'target');

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
  boardEl.classList.toggle('previewing', !!preview);
  drawArrows(preview ? preview.arrows : boardArrows);

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
  if (game.isCheckmate()) text = `Checkmate! ${game.turn() === 'w' ? 'Black' : 'White'} wins.`;
  else if (game.isStalemate()) text = 'Stalemate. It is a draw.';
  else if (game.isThreefoldRepetition()) text = 'Draw by repetition';
  else if (game.isDrawByFiftyMoves()) text = 'Draw by the 50-move rule';
  else if (game.isInsufficientMaterial()) text = 'Draw: not enough pieces to mate';
  else if (game.isDraw()) text = 'Draw';
  else {
    if (mode === 'computer') text = game.turn() === playerColor ? 'Your move' : 'Computer to move';
    else text = `${game.turn() === 'w' ? 'White' : 'Black'} to move`;
    if (game.inCheck()) text = 'Check! ' + text;
  }
  statusEl.textContent = text;
  thinkingEl.classList.toggle('hidden', !thinking);
  if (thinkingTextEl) thinkingTextEl.textContent = engine.isReady() ? 'Computer is thinking…' : 'Loading the engine…';
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
  // A Black first move (from a set-up position) starts the list on the right.
  const offset = h[0].color === 'b' ? 1 : 0;
  const firstNo = Number((startingFen().split(' ')[5]) || 1);
  let rows = '';
  for (let i = -offset; i < h.length; i += 2) {
    const n = firstNo + (i + offset) / 2;
    const w = i >= 0 && h[i] ? h[i].san + mark(i) : '';
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
    arr.length ? arr.map((t) => `<span class="cap ${color}">${GLYPH[t]}</span>`).join('') : '<span class="cap-none">none</span>';
  const netText = net === 0 ? 'Material even' : net > 0 ? `White ahead +${net}` : `Black ahead +${-net}`;
  materialEl.innerHTML =
    `<div class="mat-row"><span class="mat-label">White took</span><span class="mat-pieces">${glyphs(byWhite, 'b')}</span></div>` +
    `<div class="mat-row"><span class="mat-label">Black took</span><span class="mat-pieces">${glyphs(byBlack, 'w')}</span></div>` +
    `<div class="mat-net">${netText}</div>`;
}

function renderGameOver() {
  if (!game.isGameOver() || preview) {
    gameoverEl.classList.add('hidden');
    gameoverEl.innerHTML = '';
    return;
  }
  let title;
  if (game.isCheckmate()) title = `Checkmate! ${game.turn() === 'w' ? 'Black' : 'White'} wins.`;
  else if (game.isStalemate()) title = 'Stalemate. It is a draw.';
  else title = 'Game over. It is a draw.';
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
// The fill size goes through --eval so CSS can draw the bar vertically (wide
// screens) or horizontally (phones).
function setEvalFill(pct) { evalFillEl.style.setProperty('--eval', pct + '%'); }
function setEvalBar(score, turn) {
  const w = whiteScore(score, turn);
  if (!w) { setEvalFill(50); evalLineEl.textContent = ''; return; }
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
  setEvalFill(pct);
  evalLineEl.textContent = label;
}
async function updateEval() {
  if (!hasEngine) return;
  // New request id first: it also discards any evaluation still running for an earlier position.
  const id = ++evalReqId;
  if (game.isGameOver()) {
    if (game.isCheckmate()) {
      // The side to move is mated. (A "mate in 0" score is neither side's, so say it directly.)
      const whiteWon = game.turn() === 'b';
      setEvalFill(whiteWon ? 100 : 0);
      evalLineEl.textContent = `Eval: checkmate (${whiteWon ? 'White' : 'Black'} wins)`;
    } else { setEvalFill(50); evalLineEl.textContent = 'Eval: draw'; }
    return;
  }
  const fen = game.fen();
  const turn = game.turn();
  if (!engine.isReady()) evalLineEl.textContent = 'Loading the engine…';
  let r;
  try {
    r = await analyzeCached(fen, searchFor(fen));
  } catch (_) {
    if (id === evalReqId && !engine.isReady()) evalLineEl.textContent = 'Engine did not load. Check your connection, then reload.';
    return;
  }
  if (id !== evalReqId) return;
  setEvalBar(r.score, turn);
}

// ---------- arrows ----------
function arrowSvg(from, to, kind) {
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
  return `<g class="arrow ${kind || 'hint'}"><line x1="${a.x}" y1="${a.y}" x2="${ex}" y2="${ey}" />` +
    `<polygon points="${b.x - ux * 0.04},${b.y - uy * 0.04} ${lx},${ly} ${rx},${ry}" /></g>`;
}
function drawArrows(list) {
  let html = '';
  for (const a of list || []) {
    const from = a.from || (a.uci && a.uci.slice(0, 2));
    const to = a.to || (a.uci && a.uci.slice(2, 4));
    if (from && to) html += arrowSvg(from, to, a.kind);
  }
  arrowsEl.innerHTML = html;
}

// ---------- the coach panel (under the board) ----------
function setWhy(state) {
  whyState = state;
  renderWhy();
}
const CHEVRON = '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
const ICON_BACK = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>';
const ICON_NEXT = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>';

function lessonLink(key) {
  const found = key && findLesson(key);
  if (!found) return '';
  return `<button class="linkish" data-lesson="${esc(key)}">Lesson: ${esc(found.lesson.title)} ›</button>`;
}
function betterHtml(exp) {
  if (!exp.better || exp.grade === 'best') return '';
  const label = isFlagged(exp.grade) ? 'Better' : "Engine's choice";
  return `<p class="why-better"><span class="better-move">${label}: ${esc(exp.better.san)}.</span>${exp.better.why ? ' ' + esc(exp.better.why) : ''}</p>`;
}
// The reasons read as one short paragraph.
const whyHtml = (exp) => (exp.why && exp.why.length ? `<p>${esc(exp.why.join(' '))}</p>` : '');
function lessonHtml(exp) {
  const link = lessonLink(exp.lesson);
  if (!link) return '';
  const cat = exp.info ? `<span class="why-cat">Mistake type: ${esc(exp.info.category)}</span>` : '';
  return `<div class="why-lesson">${cat}${link}</div>`;
}
const hasLines = (exp) => (exp.lines.played && exp.lines.played.length) || (exp.lines.better && exp.lines.better.length > 1);

function renderWhy() {
  if (preview) return renderStepper();
  const st = whyState;
  if (!st) {
    whyEl.classList.add('hidden');
    whyEl.innerHTML = '';
    return;
  }
  whyEl.classList.remove('hidden');
  if (st.kind === 'loading') {
    whyEl.innerHTML = `<div class="why-card loading"><span class="dots"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span> ${esc(st.text)}</div>`;
    return;
  }
  if (st.kind === 'hint') return renderHintCard(st);
  const exp = st.exp;
  const g = exp.grade;
  const actions = [];
  if (hasLines(exp)) actions.push('<button data-act="showme">Show me</button>');
  if (st.nudge) actions.push('<button data-act="takeback" class="primary">Take it back</button>', '<button data-act="keep">Keep playing</button>');
  const note = st.tookBack ? '<p class="why-note">Move taken back. The green arrow shows the better move, or find your own.</p>' : '';
  const body = `<div class="why-body">${whyHtml(exp)}${betterHtml(exp)}${lessonHtml(exp)}${note}</div>`;
  const acts = actions.length ? `<div class="why-actions">${actions.join('')}</div>` : '';
  // While the computer waits for a decision, the buttons come first so they
  // stay on screen under the board, even on a small phone.
  whyEl.innerHTML = `
    <div class="why-card g-${g}${whyFolded ? ' folded' : ''}${st.nudge ? ' nudge' : ''}">
      <button class="why-head" data-act="fold" aria-expanded="${whyFolded ? 'false' : 'true'}">
        <span class="grade g-${g}">${GRADE_LABEL[g]}</span>
        <span class="why-title"><b>${esc(exp.san)}</b> ${esc(exp.headline)}</span>
        ${CHEVRON}
      </button>
      ${st.nudge ? acts + body : body + acts}
    </div>`;
}

function renderHintCard(st) {
  const exp = st.exp;
  whyEl.innerHTML = `
    <div class="why-card hint">
      <div class="why-head static">
        <span class="grade g-hint">Hint</span>
        <span class="why-title">Try <b>${esc(st.san)}</b></span>
      </div>
      ${exp ? `<div class="why-body"><p class="why-lead">${esc(exp.headline)}</p>${whyHtml(exp)}${lessonHtml(exp)}</div>` : ''}
      <div class="why-actions">
        ${exp ? '' : '<button data-act="whyhint" class="primary">Why this move?</button>'}
        <button data-act="showme">Show me</button>
        <button data-act="close">Close</button>
      </div>
    </div>`;
}

// ---------- "Show me": step through the engine's line on the board ----------
function showMe(src) {
  const me = new Chess(src.fen).turn();
  const lines = {};
  if (src.played && src.played.length) lines.played = showLine(src.fen, src.played, me);
  if (src.better && src.better.length) lines.better = showLine(src.fen, src.better, me);
  const which = src.which && lines[src.which] ? src.which : lines.played ? 'played' : 'better';
  if (!lines[which]) return;
  clearSelection();
  preview = { src, me, lines, which, step: 0, chess: null, last: null, arrows: [] };
  stepTo(0);
  if (src.back) {
    const top = boardAreaEl.getBoundingClientRect().top + window.scrollY - 8;
    window.scrollTo({ top: Math.max(0, top), behavior: reduceMotion ? 'auto' : 'smooth' });
  }
}
function stepTo(k) {
  const L = preview.lines[preview.which];
  const max = L.steps.length - 1;
  const step = Math.max(0, Math.min(max, k));
  animate = step === preview.step + 1;
  preview.step = step;
  const st = L.steps[step];
  preview.chess = new Chess(st.fen);
  preview.last = st.move ? { from: st.move.from, to: st.move.to } : null;
  const next = L.steps[step + 1];
  const first = preview.which === 'better' ? 'good' : 'bad';
  preview.arrows = next ? [{ from: next.move.from, to: next.move.to, kind: step === 0 ? first : 'next' }] : [];
  render();
  renderWhy();
}
function endShowMe(scrollBack = true) {
  if (!preview) return;
  const back = preview.src.back;
  preview = null;
  render();
  renderWhy();
  if (scrollBack && back && back.isConnected) back.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
}
function renderStepper() {
  const p = preview;
  const L = p.lines[p.which];
  const max = L.steps.length - 1;
  const st = L.steps[p.step];
  const first = L.steps[1] && L.steps[1].move;
  let text;
  if (p.step === 0) {
    if (!first) text = 'No moves to show.';
    else if (p.which === 'played') text = `You played ${first.san} here. Tap Next to see what happens.`;
    else text = p.src.hint ? `The engine's move here is ${first.san}. Tap Next to see how it plays out.` : `The better move here is ${first.san}. Tap Next to see how it plays out.`;
  } else {
    text = st.text;
    if (p.step === max) {
      const end = netText(L.net, L.mate);
      if (end) text += ' ' + end;
    }
  }
  const tabs = p.lines.played && p.lines.better
    ? `<div class="step-tabs" role="tablist">
        <button role="tab" data-line="played" class="${p.which === 'played' ? 'on' : ''}" aria-selected="${p.which === 'played'}">Your move</button>
        <button role="tab" data-line="better" class="${p.which === 'better' ? 'on' : ''}" aria-selected="${p.which === 'better'}">Better move</button>
      </div>`
    : '';
  whyEl.classList.remove('hidden');
  whyEl.innerHTML = `
    <div class="why-card stepper">
      ${tabs}
      <p class="step-text" aria-live="polite">${esc(text)}</p>
      <div class="step-ctl">
        <button data-step="-1" aria-label="Back one move" ${p.step === 0 ? 'disabled' : ''}>${ICON_BACK}</button>
        <span class="step-count">${p.step === 0 ? 'Start' : `${p.step} of ${max}`}</span>
        <button data-step="1" aria-label="Next move" ${p.step === max ? 'disabled' : ''}>${ICON_NEXT}</button>
        <button data-act="done" class="primary">Done</button>
      </div>
    </div>`;
}

// ---------- tip card ----------
function showTip(card) {
  tipState = card ? { card, moves: 0 } : null;
  renderTip();
}
function renderTip() {
  if (!tipState) {
    tipEl.classList.add('hidden');
    tipEl.innerHTML = '';
    return;
  }
  const c = tipState.card;
  tipEl.innerHTML = `
    <div class="tip-card ${c.kind}">
      <div class="tip-top"><span class="tip-label">${esc(c.label)}</span><button class="tip-x" data-act="tipclose" aria-label="Dismiss tip">×</button></div>
      <p class="tip-text">${esc(c.text)}</p>
      ${lessonLink(c.lessonKey)}
    </div>`;
  tipEl.classList.remove('hidden');
}
// A tip card steps aside on its own after a few moves.
function tipTick() {
  if (tipState && ++tipState.moves >= 4) showTip(null);
}
function noteMistake(tag, gid, ply) {
  const n = recordMistake(tag, gid, ply);
  if (n < 2) return;
  const card = repeatTip(tag);
  if (card && !shownRepeats.has(card.category)) {
    shownRepeats.add(card.category);
    showTip(card);
  }
}

// ---------- hint ----------
async function hint() {
  if (!hasEngine) return flashHint('Engine unavailable.');
  if (thinking || analyzing || coaching || preview || game.isGameOver()) return;
  if (mode === 'computer' && game.turn() !== playerColor) return;
  if (whyState && whyState.nudge) return;
  const fen = game.fen();
  const id = ++engineReqId;
  setWhy({ kind: 'loading', text: 'Thinking of a hint…' });
  let r;
  try { r = await analyzeCached(fen, HINT_SEARCH); } catch (_) { setWhy(null); return flashHint('Engine error.'); }
  if (id !== engineReqId || fen !== game.fen()) return;
  const top = r.lines && r.lines[0];
  if (!top || !top.pv.length) { setWhy(null); return flashHint('No hint available.'); }
  boardArrows = [{ uci: top.pv[0], kind: 'hint' }];
  render();
  setWhy({ kind: 'hint', fen, lines: r.lines, uci: top.pv[0], san: sanOf(fen, top.pv[0]), exp: null });
}
function explainHint() {
  const st = whyState;
  if (!st || st.kind !== 'hint') return;
  const top = st.lines[0];
  try {
    st.exp = explainMove({ fen: st.fen, move: top.pv[0], pre: st.lines, post: { pv: top.pv.slice(1), score: flipScore(top.score) }, hint: true });
  } catch (_) {
    st.exp = { headline: "This is the engine's top choice.", why: [], lesson: null, info: null };
  }
  renderWhy();
}

// ---------- interaction ----------
function clearSelection() { selected = null; legal = []; }
function clearReview() { reviewMarks = {}; reviewItems = []; reviewEl.classList.add('hidden'); reviewEl.innerHTML = ''; }
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
  if (preview || (whyState && whyState.nudge)) return;
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
  const preFen = game.fen();
  let mv;
  try {
    mv = game.move(desc);
  } catch (_) {
    clearSelection();
    render();
    return;
  }
  clearSelection();
  boardArrows = [];
  if (human) clearReview();
  animate = true;
  render();
  updateEval();
  if (human) afterHumanMove(preFen, mv);
}

function afterHumanMove(preFen, mv) {
  tipTick();
  if (coachMode && mode === 'computer' && hasEngine) return coachMove(preFen, mv);
  if (whyState) setWhy(null); // an old hint no longer fits the board
  maybeEngineMove();
}

// Coach mode: grade the move just played and say why, then let the computer reply.
async function coachMove(preFen, mv) {
  coaching = true;
  const reqId = ++engineReqId;
  const postFen = game.fen();
  const ply = game.history().length - 1;
  const gid = gameId;
  setWhy({ kind: 'loading', text: 'Checking your move…' });
  let pre;
  let post = null;
  try {
    pre = await analyzeCached(preFen, COACH_PRE);
    if (!game.isGameOver()) post = await analyzeCached(postFen, COACH_POST);
  } catch (_) {
    if (reqId === engineReqId) { coaching = false; setWhy(null); maybeEngineMove(); }
    return;
  }
  if (reqId !== engineReqId) return; // a new game or an undo came first
  coaching = false;
  let exp = null;
  try {
    exp = explainMove({ fen: preFen, move: uciOf(mv), pre: pre.lines, post: post && post.lines[0] });
  } catch (_) {}
  if (!exp) { setWhy(null); return maybeEngineMove(); }
  if (isFlagged(exp.grade) && exp.tag) noteMistake(exp.tag, gid, ply);
  const nudge = !game.isGameOver() && exp.loss >= NUDGE_LOSS && (exp.grade === 'mistake' || exp.grade === 'blunder' || (isFlagged(exp.grade) && !!exp.tag));
  setWhy({ kind: 'coach', exp, fen: preFen, nudge });
  if (nudge) {
    // Show how the computer would punish it, and wait for the player's choice.
    const reply = exp.lines.played[1];
    boardArrows = reply ? [{ uci: reply, kind: 'bad' }] : [];
    render();
    return;
  }
  maybeEngineMove();
}

function takeBack() {
  if (!whyState || !whyState.nudge) return;
  endShowMe(false);
  engineReqId++;
  game.undo();
  clearSelection();
  const exp = whyState.exp;
  whyState = { ...whyState, nudge: false, tookBack: true };
  boardArrows = exp.better ? [{ uci: exp.better.uci, kind: 'good' }] : [];
  render();
  updateEval();
  renderWhy();
}
function keepPlaying() {
  if (!whyState || !whyState.nudge) return;
  endShowMe(false);
  whyState = { ...whyState, nudge: false };
  boardArrows = [];
  render();
  renderWhy();
  maybeEngineMove();
}

async function maybeEngineMove() {
  if (mode !== 'computer' || game.isGameOver() || game.turn() !== engineColor()) return;
  if (!hasEngine) return flashHint('The engine is not available. Switch to Pass & play.');
  thinking = true;
  const reqId = ++engineReqId;
  renderStatus();
  // On the very first move the engine may still be downloading; switch the
  // indicator from "Loading the engine…" to "Computer is thinking…" once it is up.
  if (!engine.isReady()) engine.ready().then(() => { if (reqId === engineReqId) renderStatus(); }, () => {});
  const d = DIFFICULTY[diffIndex];
  let uci;
  try {
    uci = await engine.bestMove(game.fen(), { skill: d.skill, movetime: d.movetime });
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
  boardArrows = [];
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
// The score after a move from the mover's side, given the engine's line for
// the position it leads to (or the game result there).
function scoreAfter(fenAfter, line) {
  const c = new Chess(fenAfter);
  if (c.isCheckmate()) return { mate: 1 };
  if (c.isDraw()) return { cp: 0 };
  return line && line.score ? flipScore(line.score) : null;
}

async function analyzeGame() {
  if (!hasEngine) return flashHint('Engine unavailable.');
  if (game.history().length === 0) return flashHint('Play a game first, then review it.');
  if (analyzing) return;
  endShowMe(false);
  analyzing = true;
  clearReview();
  const verbose = game.history({ verbose: true });
  const N = verbose.length;
  // Replay from where this game began (a practice position starts from its own setup).
  const tmp = new Chess(startingFen());
  const fens = [tmp.fen()];
  for (const m of verbose) {
    tmp.move({ from: m.from, to: m.to, promotion: m.promotion });
    fens.push(tmp.fen());
  }
  const inScope = (i) => mode !== 'computer' || verbose[i].color === playerColor;
  const lines = new Array(fens.length).fill(null);
  const items = [];
  const marks = {};
  const reviewId = ++engineReqId;
  const gid = gameId;

  // The move that led to position i, explained while the engine searches the next one.
  const judge = (j) => {
    const m = verbose[j];
    const uci = uciOf(m);
    const pre = lines[j] && lines[j].pv.length ? [lines[j]] : [];
    if (inScope(j)) {
      let exp = null;
      try { exp = explainMove({ fen: fens[j], move: uci, pre, post: lines[j + 1] && lines[j + 1].pv.length ? lines[j + 1] : null }); } catch (_) {}
      if (!exp) return;
      if (GRADE_MARK[exp.grade]) marks[j] = GRADE_MARK[exp.grade];
      if (isFlagged(exp.grade)) items.push({ i: j, mover: m.color, exp, fen: fens[j], uci });
    } else if (pre.length) {
      const after = scoreAfter(fens[j + 1], lines[j + 1]);
      if (!after) return;
      const { grade } = gradeMove(pre[0].score, after, pre[0].pv[0] === uci);
      if (GRADE_MARK[grade]) marks[j] = GRADE_MARK[grade];
    }
  };

  let next = engine.analyze(fens[0], EVAL_SEARCH);
  for (let i = 0; i < fens.length; i++) {
    flashHint(`Reviewing… ${i}/${N}`);
    let r;
    try { r = await next; } catch (_) { analyzing = false; return flashHint('Review failed.'); }
    if (reviewId !== engineReqId) { analyzing = false; return; }
    if (i + 1 < fens.length) {
      next = engine.analyze(fens[i + 1], EVAL_SEARCH);
      next.catch(() => {});
    }
    lines[i] = r.lines && r.lines[0] ? r.lines[0] : { pv: [], score: r.score };
    if (i > 0) judge(i - 1);
  }
  analyzing = false;
  reviewMarks = marks;
  reviewItems = items;
  renderMoves();
  renderReview();
  // Remember confirmed mistakes; a category that keeps coming back gets the tip card.
  let repeat = null;
  for (const it of items) {
    if (!it.exp.tag) continue;
    const n = recordMistake(it.exp.tag, gid, it.i);
    if (n >= 2 && (!repeat || n > repeat.n)) repeat = { n, tag: it.exp.tag };
  }
  if (repeat) {
    const card = repeatTip(repeat.tag);
    if (card && !shownRepeats.has(card.category)) { shownRepeats.add(card.category); showTip(card); }
  }
  flashHint(items.length ? 'Review done. Tap a flagged move to see why.' : 'Review done.');
}

function renderReview() {
  const items = reviewItems;
  const counts = { blunder: 0, mistake: 0, inaccuracy: 0 };
  for (const it of items) counts[it.exp.grade]++;
  const moveNo = (i) => {
    const firstNo = Number(startingFen().split(' ')[5]) || 1;
    const blackFirst = startingFen().split(' ')[1] === 'b';
    const ply = i + (blackFirst ? 1 : 0);
    return `${firstNo + Math.floor(ply / 2)}${ply % 2 === 0 ? '.' : '...'}`;
  };
  const cls = (g) => (g === 'blunder' ? 'blunder' : g === 'mistake' ? 'mistake' : 'inacc');
  let html = `<div class="review-head">Game review${mode === 'computer' ? ': your moves' : ''}</div>`;
  const many = (n, one, more) => `${n} ${n === 1 ? one : more}`;
  html += `<div class="review-counts"><span class="rq blunder">${many(counts.blunder, 'blunder', 'blunders')}</span><span class="rq mistake">${many(counts.mistake, 'mistake', 'mistakes')}</span><span class="rq inacc">${many(counts.inaccuracy, 'inaccuracy', 'inaccuracies')}</span></div>`;
  if (!items.length) {
    html += '<div class="review-empty">No serious mistakes. Well played!</div>';
  } else {
    html += '<ul class="review-list">';
    items.forEach((it, k) => {
      const e = it.exp;
      const save = it.exp.better ? `<button class="rv-save" data-k="${k}">Save as puzzle</button>` : '';
      html += `<li class="rv-item"><details${k === 0 ? ' open' : ''}>
        <summary><span class="rq ${cls(e.grade)}">${moveNo(it.i)} ${esc(e.san)}${e.mark}</span> <span class="rv-head">${esc(e.headline)}</span></summary>
        <div class="rv-body">
          ${whyHtml(e)}
          ${betterHtml(e)}
          ${lessonHtml(e)}
          <div class="rv-actions"><button data-show="${k}">Show me</button>${save}</div>
        </div>
      </details></li>`;
    });
    html += '</ul>';
    html += '<div class="review-tip">Save any of these to your <b>Learn, Daily review</b> deck, or copy the game and ask Claude about them.</div>';
  }
  reviewEl.innerHTML = html;
  reviewEl.classList.remove('hidden');
}
reviewEl.addEventListener('click', (e) => {
  const show = e.target.closest('[data-show]');
  if (show) {
    const it = reviewItems[Number(show.dataset.show)];
    if (it) showMe({ fen: it.fen, played: it.exp.lines.played, better: it.exp.lines.better, which: 'played', back: show });
    return;
  }
  const save = e.target.closest('.rv-save');
  if (save) addGamePuzzle(reviewItems[Number(save.dataset.k)], save);
});

function addGamePuzzle(item, btn) {
  if (!item || !item.exp.better || !item.fen) return;
  const e = item.exp;
  const id = 'g' + Date.now().toString(36) + item.i;
  const side = item.mover;
  const prompt = `${side === 'w' ? 'White' : 'Black'} to move. Find the best move.`;
  const idea = `From your game: you played ${e.san}${e.mark}. ${e.headline} Stronger was ${e.better.san}.${e.better.why ? ' ' + e.better.why : ''}`;
  update((s) => {
    s.puzzles = s.puzzles || [];
    if (!s.puzzles.some((p) => p.fen === item.fen)) {
      s.puzzles.push({ id, theme: 'From your game', level: 0, side, goal: 'best', fen: item.fen, solution: e.better.uci, prompt, idea });
    }
  });
  if (btn) { btn.textContent = 'Saved ✓'; btn.disabled = true; }
  flashHint('Saved to your puzzle deck (Learn, Daily review).');
}

// ---------- controls ----------
function resetCoach() {
  preview = null;
  whyState = null;
  boardArrows = [];
  shownRepeats.clear();
  renderWhy();
}

async function applyFreshGame() {
  engineReqId++;
  thinking = false;
  analyzing = false;
  coaching = false;
  practiceMode = false;
  practiceLabel = '';
  if (selPractice) selPractice.value = '';
  game.reset();
  gameId = newGameId();
  clearSelection();
  clearReview();
  resetCoach();
  showTip(startTip());
  orientation = mode === 'computer' && playerColor === 'b' ? 'black' : 'white';
  flashHint('');
  if (hasEngine) { try { await engine.newGame(); } catch (_) {} }
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
  mode = 'computer';
  selMode.value = 'computer';
  try { game.load(p.fen); } catch (_) { return; }
  gameId = newGameId();
  practiceMode = true;
  practiceLabel = p.label;
  playerColor = game.turn();
  selSide.value = playerColor;
  orientation = playerColor === 'w' ? 'white' : 'black';
  clearSelection();
  clearReview();
  resetCoach();
  showTip(null);
  updateSetupVisibility();
  if (hasEngine) engine.newGame().catch(() => {});
  flashHint(`Practice: ${p.label}. You play ${playerColor === 'w' ? 'White' : 'Black'}. Use the technique; the computer defends.`);
  render();
  updateEval();
}

function undo() {
  if (whyState && whyState.nudge) return takeBack();
  if (thinking || analyzing || coaching || preview || game.history().length === 0) return;
  engineReqId++;
  clearReview();
  if (mode === 'computer') {
    game.undo();
    if (game.history().length > 0 && game.turn() !== playerColor) game.undo();
  } else {
    game.undo();
  }
  clearSelection();
  boardArrows = [];
  setWhy(null);
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

const COPY_BLOCKED = 'The browser blocked copying, so the text is shown for you to copy.';
async function copyPgn() {
  if (game.history().length === 0) return flashHint('No moves to copy yet.');
  setPgnHeaders();
  const ok = await copyText(game.pgn());
  flashHint(ok ? 'PGN copied to clipboard.' : COPY_BLOCKED);
}
async function copyFen() {
  const ok = await copyText(game.fen());
  flashHint(ok ? 'FEN copied to clipboard.' : COPY_BLOCKED);
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
  flashHint(ok ? 'Game copied. Paste it to Claude in chat.' : COPY_BLOCKED);
}

// Clipboard: the async Clipboard API first (it needs HTTPS, which GitHub Pages
// has), then the older execCommand route, and if both are blocked, a sheet that
// shows the text already selected so it can be copied by hand.
async function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {}
  }
  if (legacyCopy(text)) return true;
  showCopySheet(text);
  return false;
}

function legacyCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.top = '0';
  ta.style.left = '0';
  ta.style.opacity = '0';
  ta.style.fontSize = '16px'; // stops iPhone zooming in on focus
  document.body.appendChild(ta);
  let ok = false;
  try {
    ta.select();
    ta.setSelectionRange(0, text.length); // iPhone ignores select()
    ok = document.execCommand('copy');
  } catch (_) {
    ok = false;
  }
  ta.remove();
  return ok;
}

function showCopySheet(text) {
  copySheetEl.innerHTML = `<div class="copy-card">
    <div class="copy-title" id="copy-title">Copy this text</div>
    <div class="copy-sub">Copying was blocked, so here it is. Select it all, copy it, then paste it to Claude.</div>
    <textarea class="copy-text" readonly spellcheck="false" aria-label="Text to copy"></textarea>
    <div class="copy-actions"><button id="copy-select">Select all</button><button id="copy-done" class="primary">Done</button></div>
  </div>`;
  const ta = copySheetEl.querySelector('textarea');
  ta.value = text;
  copySheetEl.classList.remove('hidden');
  const selectAll = () => { ta.focus(); ta.select(); ta.setSelectionRange(0, ta.value.length); };
  copySheetEl.querySelector('#copy-select').addEventListener('click', selectAll);
  copySheetEl.querySelector('#copy-done').addEventListener('click', hideCopySheet);
  selectAll();
}
function hideCopySheet() {
  copySheetEl.classList.add('hidden');
  copySheetEl.innerHTML = '';
}
copySheetEl.addEventListener('click', (e) => { if (e.target === copySheetEl) hideCopySheet(); });

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
if (chkCoach) {
  chkCoach.addEventListener('change', () => {
    coachMode = chkCoach.checked;
    if (!coachMode && whyState && whyState.nudge) keepPlaying();
    // Start the coach's look at the current position right away.
    if (coachMode) updateEval();
  });
}
if (chkCct) chkCct.addEventListener('change', () => { cctOn = chkCct.checked; renderStatus(); });

// ---------- wiring ----------
boardEl.addEventListener('click', (e) => {
  const cell = e.target.closest('[data-square]');
  if (cell) onSquareClick(cell.dataset.square);
});
document.getElementById('btn-new').addEventListener('click', () => { endShowMe(false); newGame(); });
document.getElementById('btn-undo').addEventListener('click', () => { if (preview) return endShowMe(false); undo(); });
document.getElementById('btn-flip').addEventListener('click', flip);
document.getElementById('btn-hint').addEventListener('click', hint);
document.getElementById('btn-analyze').addEventListener('click', analyzeGame);
document.getElementById('btn-review').addEventListener('click', copyForReview);
document.getElementById('btn-pgn').addEventListener('click', copyPgn);
document.getElementById('btn-fen').addEventListener('click', copyFen);

whyEl.addEventListener('click', (e) => {
  const step = e.target.closest('[data-step]');
  if (step && preview) return stepTo(preview.step + Number(step.dataset.step));
  const line = e.target.closest('[data-line]');
  if (line && preview) {
    preview.which = line.dataset.line;
    preview.step = 0;
    return stepTo(0);
  }
  const act = e.target.closest('[data-act]');
  if (!act) return;
  const a = act.dataset.act;
  if (a === 'done') return endShowMe(true);
  if (a === 'fold') {
    whyFolded = !whyFolded;
    saveFolded();
    return renderWhy();
  }
  if (a === 'takeback') return takeBack();
  if (a === 'keep') return keepPlaying();
  if (a === 'whyhint') return explainHint();
  if (a === 'close') {
    boardArrows = [];
    render();
    return setWhy(null);
  }
  if (a === 'showme' && whyState) {
    if (whyState.kind === 'hint') return showMe({ fen: whyState.fen, better: whyState.lines[0].pv, which: 'better', hint: true });
    const exp = whyState.exp;
    // A best move has no better line to compare with.
    const better = exp.grade === 'best' ? null : exp.lines.better;
    return showMe({ fen: whyState.fen, played: whyState.tookBack ? null : exp.lines.played, better, which: whyState.tookBack ? 'better' : 'played' });
  }
});
tipEl.addEventListener('click', (e) => {
  if (e.target.closest('[data-act="tipclose"]')) showTip(null);
});
// Lesson links in the coach panel, the tip card and the review open that lesson.
document.getElementById('play-view').addEventListener('click', (e) => {
  const link = e.target.closest('[data-lesson]');
  if (!link) return;
  if (preview) endShowMe(false);
  showTab('learn', link.dataset.lesson);
  window.scrollTo(0, 0);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !copySheetEl.classList.contains('hidden')) { hideCopySheet(); return; }
  // Leave arrow keys alone while a text box or dropdown has focus.
  if (e.target && e.target.closest && e.target.closest('textarea, select, input:not([type=checkbox]):not([type=radio])')) return;
  if (preview) {
    if (e.key === 'ArrowLeft') { e.preventDefault(); stepTo(preview.step - 1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); stepTo(preview.step + 1); }
    else if (e.key === 'Escape') endShowMe(true);
    return;
  }
  if (e.key === 'ArrowLeft') undo();
});

// Play / Learn tabs
const tabPlay = document.getElementById('tab-play');
const tabLearn = document.getElementById('tab-learn');
const playView = document.getElementById('play-view');
const learnViewEl = document.getElementById('learn-view');
function showTab(which, lessonKey) {
  const learn = which === 'learn';
  playView.classList.toggle('hidden', learn);
  learnViewEl.classList.toggle('hidden', !learn);
  tabPlay.classList.toggle('on', !learn);
  tabLearn.classList.toggle('on', learn);
  if (learn && window.learnView) {
    if (lessonKey) window.learnView.openLesson(lessonKey);
    else window.learnView.refresh();
  }
}
// "Back to the game" in a lesson opened from the coach.
window.showPlay = () => {
  showTab('play');
  window.scrollTo(0, 0);
};
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
  flashHint('No engine found, so the game is in Pass & play mode.');
}
updateSetupVisibility();
showTip(startTip());
render();
updateEval();
