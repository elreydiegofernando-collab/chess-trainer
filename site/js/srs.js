// Minimal spaced-repetition scheduler (Leitner-style boxes).
// INTERVALS are in days, indexed by box. Box 0 = brand new (due immediately);
// each correct answer promotes a box (longer wait), a miss drops back to 1 day.
export const INTERVALS = [0, 1, 3, 7, 16, 35, 90, 180];
const DAY = 86400000;

export function newItem(now) {
  return { box: 0, due: now, last: 0, seen: 0, correct: 0 };
}

export function isDue(item, now) {
  return !item || item.due == null || item.due <= now;
}

export function grade(item, correct, now) {
  item.seen = (item.seen || 0) + 1;
  if (correct) {
    item.correct = (item.correct || 0) + 1;
    item.box = Math.min((item.box || 0) + 1, INTERVALS.length - 1);
  } else {
    item.box = 1;
  }
  item.last = now;
  item.due = now + INTERVALS[item.box] * DAY;
  return item;
}

// Count due items in a { key: item } map.
export function dueCount(items, now) {
  let n = 0;
  for (const k in items) if (isDue(items[k], now)) n++;
  return n;
}
