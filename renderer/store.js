// Persistent local store (localStorage) for learning progress, spaced-repetition
// state, and the personal puzzle deck. Survives app restarts; fully offline.
const KEY = 'chessTrainer.v1';

function read() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch (_) {
    return {};
  }
}

let state = read();

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (_) {}
}

export function getStore() {
  return state;
}

// Run a mutator against the state object, then persist.
export function update(mutator) {
  mutator(state);
  persist();
}

// Ensure top-level keys exist with sensible defaults (shallow).
export function ensure(defaults) {
  let changed = false;
  for (const k of Object.keys(defaults)) {
    if (state[k] === undefined) {
      state[k] = defaults[k];
      changed = true;
    }
  }
  if (changed) persist();
  return state;
}
