// Reads Stockfish's UCI "info" output into engine lines.
// Shared by the browser engine (engine.js) and the Node tests
// (scripts/test-why.mjs), so both read the engine the same way.

// One "info ... score ... pv ..." line, or null for any other output.
export function parseInfo(line) {
  if (typeof line !== 'string' || line.indexOf('info ') !== 0 || line.indexOf(' score ') < 0) return null;
  const t = line.trim().split(/\s+/);
  const out = { depth: 0, multipv: 1, score: null, bound: false, pv: [] };
  for (let i = 1; i < t.length; i++) {
    const k = t[i];
    if (k === 'depth') out.depth = parseInt(t[++i], 10) || 0;
    else if (k === 'multipv') out.multipv = parseInt(t[++i], 10) || 1;
    else if (k === 'score') {
      const kind = t[++i];
      const v = parseInt(t[++i], 10);
      out.score = kind === 'mate' ? { mate: v } : { cp: v };
      if (t[i + 1] === 'lowerbound' || t[i + 1] === 'upperbound') { out.bound = true; i++; }
    } else if (k === 'pv') {
      out.pv = t.slice(i + 1);
      break;
    }
  }
  return out.score ? out : null;
}

// Collects the latest line for each MultiPV slot during one search.
// lines() returns them best first: [{ depth, score, pv: ['e2e4', ...] }].
// Scores are from the side to move: { cp } or { mate } (mate > 0 = it mates).
export function collector() {
  const slots = new Map();
  return {
    add(line) {
      const info = parseInfo(line);
      if (!info || !info.pv.length) return;
      const prev = slots.get(info.multipv);
      // A bound score is a half-finished result; keep it only if nothing better is there.
      if (info.bound && prev && !prev.bound) return;
      slots.set(info.multipv, info);
    },
    lines() {
      return [...slots.keys()]
        .sort((a, b) => a - b)
        .map((k) => {
          const s = slots.get(k);
          return { depth: s.depth, score: s.score, pv: s.pv };
        });
    },
  };
}
