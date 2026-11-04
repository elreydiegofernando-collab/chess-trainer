// Learn mode: gated beginner→master roadmap, lesson reader, spaced-repetition
// review (concept recall + puzzles), blunder reference, and study plan.
// Progress persists locally (store.js). Fully offline.
import { Chess } from '../vendor/chess.js';
import { getStore, update, ensure } from './store.js';
import { newItem, grade, isDue } from './srs.js';
import { STARTER_PUZZLES } from './puzzles.js';
import { CURRICULUM } from './curriculum.js';

// U+FE0E keeps the pawn a text glyph: some phones otherwise draw it as an emoji.
const GLYPH = { p: '♟︎', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' };
const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

ensure({ learned: {}, srs: {}, puzzles: [], stats: { reviews: 0, correct: 0 } });

const rootEl = document.getElementById('learn-view');
const badgeEl = document.getElementById('learn-due');

let view = 'roadmap'; // 'roadmap' | 'level' | 'lesson' | 'review' | 'reference' | 'plan'
let activeLevel = null;
let activeLesson = null;
let session = null; // review session
let fromPlay = false; // lesson opened from a link in the Play view

// ---------- helpers ----------
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const md = (s) =>
  esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('');

const lessonKey = (lv, ls) => lv.id + '/' + ls.id;
function levelComplete(lv) {
  const s = getStore();
  return lv.lessons.length > 0 && lv.lessons.every((ls) => s.learned[lessonKey(lv, ls)]);
}
function levelUnlocked(idx) {
  if (idx === 0) return true;
  return levelComplete(CURRICULUM.levels[idx - 1]);
}
function lessonsLearned(lv) {
  const s = getStore();
  return lv.lessons.filter((ls) => s.learned[lessonKey(lv, ls)]).length;
}

function ensureSrsItems() {
  update((s) => {
    const now = Date.now();
    for (const lv of CURRICULUM.levels) {
      for (const ls of lv.lessons) {
        const key = 'concept:' + lessonKey(lv, ls);
        if (s.learned[lessonKey(lv, ls)] && !s.srs[key]) s.srs[key] = newItem(now);
      }
    }
    for (const pz of STARTER_PUZZLES) {
      const key = 'spz:' + pz.id;
      if (!s.srs[key]) s.srs[key] = newItem(now);
    }
    for (const pz of s.puzzles) {
      const key = 'ppz:' + pz.id;
      if (!s.srs[key]) s.srs[key] = newItem(now);
    }
  });
}

function dueItems(now) {
  const s = getStore();
  const out = [];
  for (const key in s.srs) {
    if (!isDue(s.srs[key], now)) continue;
    if (key.startsWith('concept:')) {
      const [lvId, lsId] = key.slice(8).split('/');
      const lv = CURRICULUM.levels.find((l) => l.id === lvId);
      const lesson = lv && lv.lessons.find((x) => x.id === lsId);
      if (lesson) out.push({ key, type: 'concept', ref: { level: lv, lesson } });
    } else if (key.startsWith('spz:')) {
      const pz = STARTER_PUZZLES.find((p) => p.id === key.slice(4));
      if (pz) out.push({ key, type: 'puzzle', ref: pz });
    } else if (key.startsWith('ppz:')) {
      const pz = s.puzzles.find((p) => p.id === key.slice(4));
      if (pz) out.push({ key, type: 'puzzle', ref: pz });
    }
  }
  return out;
}
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function dueNow() {
  ensureSrsItems();
  return dueItems(Date.now()).length;
}
function updateBadge() {
  const n = dueNow();
  if (badgeEl) {
    badgeEl.textContent = n > 0 ? String(n) : '';
    badgeEl.classList.toggle('hidden', n === 0);
  }
}

// ---------- mini board (reuses .board / .sq / .piece styles) ----------
function buildBoard(boardEl, chess, opts) {
  const orientation = opts.orientation || (chess.turn() === 'w' ? 'white' : 'black');
  let selected = null;
  let legal = [];
  let highlight = null;
  const fr = () => ({
    files: orientation === 'white' ? FILES : [...FILES].reverse(),
    ranks: orientation === 'white' ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8],
  });
  function draw() {
    const pos = {};
    for (const row of chess.board()) for (const c of row) if (c) pos[c.square] = c;
    const { files, ranks } = fr();
    const targets = new Map();
    for (const mv of legal) targets.set(mv.to, mv.isCapture() || mv.isEnPassant() ? 'capture' : 'target');
    let html = '';
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const sq = files[f] + ranks[r];
        const cls = ['sq', (FILES.indexOf(sq[0]) + Number(sq[1])) % 2 === 0 ? 'light' : 'dark'];
        if (sq === selected) cls.push('sel');
        if (highlight && (sq === highlight.from || sq === highlight.to)) cls.push('last');
        const t = targets.get(sq);
        if (t) cls.push(t);
        const p = pos[sq];
        const glyph = p ? `<span class="piece ${p.color}">${GLYPH[p.type]}</span>` : '';
        html += `<div class="${cls.join(' ')}" data-square="${sq}">${glyph}</div>`;
      }
    }
    boardEl.innerHTML = html;
  }
  function onClick(e) {
    if (!opts.interactive) return;
    const cell = e.target.closest('[data-square]');
    if (!cell) return;
    const sq = cell.dataset.square;
    const piece = chess.get(sq);
    if (selected) {
      const mv = legal.find((m) => m.to === sq);
      if (mv) return doMove(mv);
      if (piece && piece.color === chess.turn()) { selected = sq; legal = chess.moves({ square: sq, verbose: true }); return draw(); }
      selected = null; legal = []; return draw();
    }
    if (piece && piece.color === chess.turn()) { selected = sq; legal = chess.moves({ square: sq, verbose: true }); draw(); }
  }
  function doMove(mv) {
    const desc = { from: mv.from, to: mv.to };
    if (mv.isPromotion()) desc.promotion = 'q';
    const res = chess.move(desc);
    selected = null;
    legal = [];
    opts.interactive = false;
    draw();
    if (opts.onMove) opts.onMove(res, chess);
  }
  boardEl.addEventListener('click', onClick);
  draw();
  return {
    showMove(uci) { highlight = { from: uci.slice(0, 2), to: uci.slice(2, 4) }; draw(); },
    stop() { opts.interactive = false; },
  };
}

function solutionSan(pz) {
  try {
    const ch = new Chess(pz.fen);
    return ch.move({ from: pz.solution.slice(0, 2), to: pz.solution.slice(2, 4), promotion: pz.solution[4] }).san;
  } catch (_) {
    return pz.solution;
  }
}

// ---------- views ----------
// On a phone the page scrolls, so opening a different screen (level, lesson,
// next review card) starts at the top instead of wherever the last one was.
let lastScreen = '';
function scrollToTopOnNewScreen() {
  const key = [view, activeLevel && activeLevel.id, activeLesson && activeLesson.id, session && session.index].join('|');
  if (key !== lastScreen && lastScreen && !rootEl.classList.contains('hidden')) {
    const top = rootEl.getBoundingClientRect().top + window.scrollY - 12;
    if (window.scrollY > top) window.scrollTo(0, Math.max(0, top));
  }
  lastScreen = key;
}

function renderLearn() {
  if (!CURRICULUM || !CURRICULUM.levels || !CURRICULUM.levels.length) {
    rootEl.innerHTML = '<div class="learn-pad">The training curriculum is still being prepared. Reopen the app shortly.</div>';
    return;
  }
  scrollToTopOnNewScreen();
  if (view === 'review') return renderReview();
  if (view === 'lesson') return renderLesson();
  if (view === 'level') return renderLevelView();
  if (view === 'reference') return renderReference();
  if (view === 'plan') return renderPlan();
  return renderRoadmap();
}

function nav(active) {
  const due = dueNow();
  return `<nav class="learn-nav">
    <button data-go="roadmap" class="${active === 'roadmap' ? 'on' : ''}">Roadmap</button>
    <button data-go="review" class="${active === 'review' ? 'on' : ''}">Daily review${due ? ` <span class="pill">${due}</span>` : ''}</button>
    <button data-go="reference" class="${active === 'reference' ? 'on' : ''}">Blunders</button>
    <button data-go="plan" class="${active === 'plan' ? 'on' : ''}">Plan</button>
  </nav>`;
}

function renderRoadmap() {
  let cards = '';
  CURRICULUM.levels.forEach((lv, idx) => {
    const unlocked = levelUnlocked(idx);
    const complete = levelComplete(lv);
    const learned = lessonsLearned(lv);
    const status = complete ? 'Complete' : unlocked ? 'Available' : 'Locked';
    const cls = complete ? 'done' : unlocked ? 'open' : 'locked';
    cards += `<button class="level-card ${cls}" data-level="${idx}" ${unlocked ? '' : 'disabled'}>
      <div class="lc-top"><span class="lc-num">Level ${idx + 1}</span><span class="lc-status">${status}</span></div>
      <div class="lc-title">${esc(lv.title)}</div>
      <div class="lc-band">${esc(lv.band)}</div>
      <div class="lc-prog">${learned}/${lv.lessons.length} lessons</div>
    </button>`;
  });
  rootEl.innerHTML = nav('roadmap') +
    `<div class="learn-body"><div class="roadmap-intro">${md(CURRICULUM.overview ? CURRICULUM.overview.intro : '')}</div><div class="level-grid">${cards}</div></div>`;
  wireNav();
  rootEl.querySelectorAll('[data-level]').forEach((b) =>
    b.addEventListener('click', () => { activeLevel = CURRICULUM.levels[Number(b.dataset.level)]; view = 'level'; renderLearn(); }));
}

function renderLevelView() {
  const lv = activeLevel;
  const s = getStore();
  let items = '';
  lv.lessons.forEach((ls) => {
    const done = !!s.learned[lessonKey(lv, ls)];
    items += `<button class="lesson-row ${done ? 'done' : ''}" data-lesson="${esc(ls.id)}">
      <span class="ls-check">${done ? '✓' : ''}</span>
      <span class="ls-text"><span class="ls-title">${esc(ls.title)}</span><span class="ls-sum">${esc(ls.summary)}</span></span>
    </button>`;
  });
  rootEl.innerHTML = nav('roadmap') +
    `<div class="learn-body">
      <button class="back" data-back="roadmap">← Roadmap</button>
      <h2 class="lv-h">${esc(lv.title)}</h2>
      <div class="lv-band">${esc(lv.band)}</div>
      <div class="lesson-list">${items}</div>
    </div>`;
  wireNav();
  rootEl.querySelector('[data-back]').addEventListener('click', () => { view = 'roadmap'; renderLearn(); });
  rootEl.querySelectorAll('[data-lesson]').forEach((b) =>
    b.addEventListener('click', () => { activeLesson = lv.lessons.find((x) => x.id === b.dataset.lesson); view = 'lesson'; renderLearn(); }));
}

function renderLesson() {
  const lv = activeLevel;
  const ls = activeLesson;
  const s = getStore();
  const done = !!s.learned[lessonKey(lv, ls)];
  const list = (arr) => (arr && arr.length ? '<ul>' + arr.map((x) => `<li>${esc(x)}</li>`).join('') + '</ul>' : '');
  rootEl.innerHTML = nav('roadmap') +
    `<div class="learn-body lesson">
      ${fromPlay ? '<button class="back" data-back="game">← Back to the game</button>' : `<button class="back" data-back="level">← ${esc(lv.title)}</button>`}
      <h2 class="lv-h">${esc(ls.title)}</h2>
      <div class="lesson-content">${md(ls.content)}</div>
      ${ls.principles && ls.principles.length ? `<h3>Key principles</h3>${list(ls.principles)}` : ''}
      ${ls.blunders && ls.blunders.length ? `<h3>Blunders this prevents</h3>${list(ls.blunders)}` : ''}
      ${ls.drill ? `<h3>Drill</h3><p>${esc(ls.drill)}</p>` : ''}
      <div class="lesson-actions">
        <button id="mark" class="primary">${done ? 'Learned ✓ (review scheduled)' : 'Mark as learned'}</button>
        ${fromPlay ? '<button id="back-to-game">Back to the game</button>' : ''}
      </div>
    </div>`;
  wireNav();
  rootEl.querySelector('[data-back]').addEventListener('click', (e) => {
    const toGame = e.currentTarget.dataset.back === 'game';
    fromPlay = false;
    if (toGame && window.showPlay) return window.showPlay();
    view = 'level';
    renderLearn();
  });
  const backToGame = rootEl.querySelector('#back-to-game');
  if (backToGame) backToGame.addEventListener('click', () => { fromPlay = false; if (window.showPlay) window.showPlay(); });
  rootEl.querySelector('#mark').addEventListener('click', () => {
    update((st) => { st.learned[lessonKey(lv, ls)] = true; });
    ensureSrsItems();
    updateBadge();
    renderLearn();
  });
}

function renderReference() {
  const cats = (CURRICULUM.blunders && CURRICULUM.blunders.categories) || [];
  let html = '';
  cats.forEach((c) => {
    html += `<div class="blunder">
      <div class="bl-head"><span class="bl-name">${esc(c.name)}</span><span class="bl-lv">Level ${esc(c.firstLevel)}</span></div>
      <div class="bl-def">${esc(c.definition)}</div>
      <div class="bl-ex"><b>Example:</b> ${esc(c.example)}</div>
      <div class="bl-fix"><b>Avoid it:</b> ${esc(c.howToAvoid)}</div>
    </div>`;
  });
  rootEl.innerHTML = nav('reference') +
    `<div class="learn-body"><h2 class="lv-h">Every kind of blunder</h2><p class="ref-sub">Every kind of mistake your training covers, from hanging pieces to long-term plans.</p>${html || '<p>Reference is being prepared.</p>'}</div>`;
  wireNav();
}

function renderPlan() {
  const o = CURRICULUM.overview || {};
  const steps = (o.dailyRoutine || []).map((x) => `<li>${esc(x)}</li>`).join('');
  const miles = (o.milestones || []).map((m) => `<li><b>Level ${esc(m.level)}:</b> ${esc(m.milestone)}</li>`).join('');
  rootEl.innerHTML = nav('plan') +
    `<div class="learn-body">
      <h2 class="lv-h">Your learning plan</h2>
      <div class="plan-block">${md(o.howItWorks || '')}</div>
      ${steps ? `<h3>A good daily routine (~20–30 min)</h3><ol>${steps}</ol>` : ''}
      ${o.gating ? `<h3>Advancing levels</h3><p>${esc(o.gating)}</p>` : ''}
      ${miles ? `<h3>Milestones</h3><ul>${miles}</ul>` : ''}
    </div>`;
  wireNav();
}

// ---------- review session ----------
function startReview() {
  ensureSrsItems();
  const items = dueItems(Date.now());
  if (!items.length) {
    view = 'roadmap';
    renderLearn();
    return;
  }
  session = { queue: shuffle(items), index: 0, results: [] };
  view = 'review';
  renderLearn();
}

function gradeItem(item, correct) {
  update((s) => {
    const it = s.srs[item.key] || newItem(Date.now());
    grade(it, correct, Date.now());
    s.srs[item.key] = it;
    s.stats.reviews++;
    if (correct) s.stats.correct++;
  });
  session.results.push(correct);
}

function nextReview() {
  session.index++;
  renderLearn();
}

function renderReview() {
  if (!session) return startReview();
  const item = session.queue[session.index];
  if (!item) {
    const got = session.results.filter(Boolean).length;
    const total = session.results.length;
    rootEl.innerHTML = nav('review') +
      `<div class="learn-body review-done">
        <h2 class="lv-h">Review complete</h2>
        <p>You got <b>${got}/${total}</b>. Items you missed will come back sooner; ones you nailed return later. Come back tomorrow to keep the streak going.</p>
        <button class="primary" data-go="roadmap">Back to roadmap</button>
      </div>`;
    wireNav();
    updateBadge();
    session = null;
    return;
  }
  const head = `<div class="rv-progress">Review ${session.index + 1} of ${session.queue.length}</div>`;
  if (item.type === 'concept') return renderConcept(item, head);
  return renderPuzzle(item, head);
}

function renderConcept(item, head) {
  const ls = item.ref.lesson;
  const lv = item.ref.level;
  rootEl.innerHTML = nav('review') +
    `<div class="learn-body review">
      ${head}
      <div class="rv-kind">Concept · ${esc(lv.title)}</div>
      <div class="rv-q">${esc(ls.recallQ)}</div>
      <button id="rv-reveal">Show answer</button>
      <div class="rv-a hidden" id="rv-a">${md(ls.recallA)}</div>
      <div class="rv-actions hidden" id="rv-grade"><button id="rv-miss">Missed it</button><button id="rv-got" class="primary">Got it</button></div>
    </div>`;
  wireNav();
  rootEl.querySelector('#rv-reveal').addEventListener('click', () => {
    rootEl.querySelector('#rv-a').classList.remove('hidden');
    rootEl.querySelector('#rv-grade').classList.remove('hidden');
    rootEl.querySelector('#rv-reveal').classList.add('hidden');
  });
  rootEl.querySelector('#rv-got').addEventListener('click', () => { gradeItem(item, true); nextReview(); });
  rootEl.querySelector('#rv-miss').addEventListener('click', () => { gradeItem(item, false); nextReview(); });
}

function renderPuzzle(item, head) {
  const pz = item.ref;
  rootEl.innerHTML = nav('review') +
    `<div class="learn-body review">
      ${head}
      <div class="rv-kind">Puzzle · ${esc(pz.theme || '')}</div>
      <div class="rv-q">${esc(pz.prompt || 'Find the best move.')}</div>
      <div class="rv-boardwrap"><div id="rv-board" class="board"></div></div>
      <div class="rv-feedback" id="rv-fb"></div>
      <div class="rv-actions"><button id="rv-sol">Show solution</button><button id="rv-next" class="primary hidden">Next</button></div>
    </div>`;
  wireNav();
  const boardEl = rootEl.querySelector('#rv-board');
  const fb = rootEl.querySelector('#rv-fb');
  const nextBtn = rootEl.querySelector('#rv-next');
  const solBtn = rootEl.querySelector('#rv-sol');
  const ch = new Chess(pz.fen);
  let answered = false;
  const board = buildBoard(boardEl, ch, {
    interactive: true,
    onMove: (res) => {
      if (answered) return;
      answered = true;
      const uci = res.from + res.to + (res.promotion || '');
      const correct = pz.goal === 'mate' ? ch.isCheckmate() : uci === pz.solution;
      gradeItem(item, correct);
      if (correct) {
        fb.innerHTML = '<span class="ok">Correct!</span> ' + esc(pz.idea || '');
      } else {
        fb.innerHTML = `<span class="no">Not quite.</span> Best was <b>${esc(solutionSan(pz))}</b>. ` + esc(pz.idea || '');
        board.showMove(pz.solution);
      }
      solBtn.classList.add('hidden');
      nextBtn.classList.remove('hidden');
    },
  });
  solBtn.addEventListener('click', () => {
    if (answered) return;
    answered = true;
    gradeItem(item, false);
    board.stop();
    board.showMove(pz.solution);
    fb.innerHTML = `Solution: <b>${esc(solutionSan(pz))}</b>. ` + esc(pz.idea || '');
    solBtn.classList.add('hidden');
    nextBtn.classList.remove('hidden');
  });
  nextBtn.addEventListener('click', nextReview);
}

function wireNav() {
  rootEl.querySelectorAll('[data-go]').forEach((b) =>
    b.addEventListener('click', () => {
      const go = b.dataset.go;
      if (go === 'review') return startReview();
      view = go;
      renderLearn();
    }));
}

// ---------- public hook (used by the Learn tab) ----------
window.learnView = {
  refresh() {
    fromPlay = false;
    if (view === 'review' && session) { renderLearn(); }
    else { view = 'roadmap'; renderLearn(); }
    updateBadge();
  },
  // Opens one lesson ("levelId/lessonId"), e.g. from a link in the coach's explanation.
  openLesson(key) {
    const [lvId, lsId] = String(key || '').split('/');
    const lv = CURRICULUM.levels.find((l) => l.id === lvId);
    const ls = lv && lv.lessons.find((x) => x.id === lsId);
    if (!ls) return this.refresh();
    activeLevel = lv;
    activeLesson = ls;
    view = 'lesson';
    fromPlay = true;
    renderLearn();
    updateBadge();
  },
};

updateBadge();
renderLearn();
