// Tip cards: one short tip taken from the lessons, matched to the Learn level
// being worked on, shown at the start of each game; and the same kind of card
// when a mistake category from the player's own games comes back.
// The mistake history stays in this browser (store.js).
import { CURRICULUM } from './curriculum.js';
import { getStore, update, ensure } from './store.js';
import { TAG_INFO } from './why.js';

ensure({ learned: {}, tips: { n: 0 }, mistakes: [] });

const HISTORY_MAX = 300;
const key = (lv, ls) => lv.id + '/' + ls.id;

// Short names for the blunder categories, for "This keeps coming up: ...".
const SHORT = {
  'Hanging a Piece (One-Move Blunder)': 'hanging pieces',
  "Missing the Opponent's Immediate Threat": "missing the other side's threats",
  'Failing to Recognize Checkmate Threats (Back-Rank, Smothered, etc.)': 'checkmate chances and threats',
  'Losing Material in a Simple Exchange (Miscounting Captures)': 'trades that lose material',
  'Falling for Basic Tactics (Forks, Pins, Skewers, Discovered Attacks)': 'forks, pins, and skewers',
  'Allowing or Missing Double Attacks and Loose-Piece Tactics': 'loose pieces and double attacks',
  'Neglecting Development in the Opening': 'slow development in the opening',
  'Delaying Castling / King-Safety Neglect': 'king safety and castling',
  "Weakening the King's Pawn Shield": 'the pawns in front of your king',
  'Endgame Technique Errors (Conversion and Defense)': 'endgame technique',
  'Mishandling Opposition, Zugzwang, and King Activity in Pawn Endings': 'the king in endgames',
};

// { level, lesson, index } for "levelId/lessonId", or null.
export function findLesson(k) {
  const [lvId, lsId] = String(k || '').split('/');
  const index = CURRICULUM.levels.findIndex((l) => l.id === lvId);
  if (index < 0) return null;
  const level = CURRICULUM.levels[index];
  const lesson = level.lessons.find((x) => x.id === lsId);
  return lesson ? { level, lesson, index } : null;
}

// The level being worked on: the first one not finished (the last if all are).
export function currentLevelIndex() {
  const learned = getStore().learned || {};
  for (let i = 0; i < CURRICULUM.levels.length; i++) {
    const lv = CURRICULUM.levels[i];
    if (!lv.lessons.every((ls) => learned[key(lv, ls)])) return i;
  }
  return CURRICULUM.levels.length - 1;
}

// A lesson's key principles, as short sentences.
function tipLines(lesson) {
  const out = [];
  for (const p of lesson.principles || []) {
    let t = String(p).trim();
    if (!t || /—/.test(t) || t.length > 150) continue;
    if (!/[.!?]$/.test(t)) t += '.';
    out.push(t);
  }
  if (!out.length && lesson.summary && !/—/.test(lesson.summary)) out.push(lesson.summary);
  return out;
}

function nextCount() {
  let n = 0;
  update((s) => {
    s.tips = s.tips || { n: 0 };
    n = s.tips.n || 0;
    s.tips.n = n + 1;
  });
  return n;
}

// The tip for the start of a game. It moves on to the next one each game.
export function startTip() {
  const index = currentLevelIndex();
  const level = CURRICULUM.levels[index];
  const pool = [];
  for (const lesson of level.lessons) for (const text of tipLines(lesson)) pool.push({ lesson, text });
  if (!pool.length) return null;
  const pick = pool[nextCount() % pool.length];
  return { kind: 'level', label: `Tip for level ${index + 1}`, text: pick.text, lessonKey: key(level, pick.lesson), lessonTitle: pick.lesson.title };
}

// Adds a confirmed mistake to the history (once per move). Returns how many
// times its category has come up so far.
export function recordMistake(tag, gameId, ply) {
  const info = TAG_INFO[tag];
  if (!info) return 0;
  let count = 0;
  update((s) => {
    s.mistakes = Array.isArray(s.mistakes) ? s.mistakes : [];
    if (!s.mistakes.some((m) => m.g === gameId && m.p === ply)) {
      s.mistakes.push({ t: tag, c: info.category, g: gameId, p: ply, at: Date.now() });
      if (s.mistakes.length > HISTORY_MAX) s.mistakes.splice(0, s.mistakes.length - HISTORY_MAX);
    }
    count = s.mistakes.filter((m) => m.c === info.category).length;
  });
  return count;
}

// The card for a mistake that keeps coming back, or null the first time.
export function repeatTip(tag) {
  const info = TAG_INFO[tag];
  if (!info) return null;
  const count = (getStore().mistakes || []).filter((m) => m.c === info.category).length;
  if (count < 2) return null;
  const found = findLesson(info.lesson);
  if (!found) return null;
  const lines = tipLines(found.lesson);
  if (!lines.length) return null;
  const name = SHORT[info.category] || info.category;
  return {
    kind: 'repeat',
    category: info.category,
    label: `This keeps coming up: ${name} (${count} times)`,
    text: lines[(count - 2) % lines.length],
    lessonKey: info.lesson,
    lessonTitle: found.lesson.title,
  };
}
