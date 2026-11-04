// Stockfish 18 (lite, single-threaded WASM) running in a Web Worker.
//
// This replaces the desktop app's main-process engine (main.js + preload.js)
// with the same API the UI already used: bestMove(fen, {skill, movetime}),
// evaluate(fen, {movetime}) and newGame(). Single-threaded on purpose: GitHub
// Pages cannot send the cross-origin isolation headers the threaded build needs.
//
// The worker script finds its .wasm next to itself (same name, .wasm).
const ENGINE_URL = new URL('../vendor/stockfish/stockfish-18-lite-single.js', import.meta.url);
const LOAD_TIMEOUT = 120000; // first load downloads ~7 MB; allow for a slow connection
const SEARCH_GRACE = 15000; // a search may run this much past its movetime before we give up

const supported = typeof Worker === 'function' && typeof WebAssembly === 'object';

let worker = null;
let loading = null; // Promise while starting or once started
let ready = false;
let currentSkill = null;
const lineHandlers = new Set();
const failHandlers = new Set();

function emitLine(line) {
  for (const h of [...lineHandlers]) h(line);
}

// Tear down a broken or stuck worker; anything waiting on it is rejected and the
// next request starts a fresh one.
function fail(err) {
  if (worker) {
    try { worker.terminate(); } catch (_) {}
  }
  worker = null;
  loading = null;
  ready = false;
  currentSkill = null;
  lineHandlers.clear();
  const waiting = [...failHandlers];
  failHandlers.clear();
  for (const h of waiting) h(err);
}

function send(cmd) {
  if (!worker) throw new Error('Engine is not running');
  worker.postMessage(cmd);
}

function start() {
  return new Promise((resolve, reject) => {
    let timer = null;
    const onFail = (err) => { clearTimeout(timer); reject(err); };
    failHandlers.add(onFail);
    try {
      worker = new Worker(ENGINE_URL);
    } catch (e) {
      fail(e);
      return;
    }
    worker.onmessage = (e) => { if (typeof e.data === 'string') emitLine(e.data); };
    worker.onerror = (e) => {
      if (e && e.preventDefault) e.preventDefault();
      fail(new Error((e && e.message) || 'The engine failed to load'));
    };
    const onLine = (l) => {
      if (l !== 'readyok') return;
      lineHandlers.delete(onLine);
      failHandlers.delete(onFail);
      clearTimeout(timer);
      ready = true;
      resolve();
    };
    lineHandlers.add(onLine);
    timer = setTimeout(() => fail(new Error('The engine took too long to load')), LOAD_TIMEOUT);
    // The worker queues commands until its WASM is ready.
    send('uci');
    send('isready');
  });
}

function load() {
  if (!supported) return Promise.reject(new Error('This browser cannot run the engine'));
  if (!loading) {
    const p = start();
    loading = p;
    // A failed start must not stick: the next request tries again.
    p.catch(() => { if (loading === p) loading = null; });
  }
  return loading;
}

// Serialize engine work: only one `go` may be in flight at a time.
let chain = Promise.resolve();
function enqueue(task) {
  const run = chain.then(task, task);
  chain = run.then(() => {}, () => {});
  return run;
}

function setSkill(skill) {
  const s = typeof skill === 'number' ? skill : 20;
  if (s !== currentSkill) {
    send('setoption name Skill Level value ' + s);
    currentSkill = s;
  }
}

// One search. Resolves { best, score } where score is { cp } or { mate },
// from the perspective of the side to move in `fen`.
function search(fen, movetime) {
  return new Promise((resolve, reject) => {
    let score = null;
    let timer = null;
    const done = () => {
      lineHandlers.delete(onLine);
      failHandlers.delete(onFail);
      clearTimeout(timer);
    };
    const onLine = (l) => {
      if (l.indexOf('info ') === 0) {
        const m = l.match(/ score (cp|mate) (-?\d+)/);
        if (m) score = m[1] === 'cp' ? { cp: parseInt(m[2], 10) } : { mate: parseInt(m[2], 10) };
      } else if (l.indexOf('bestmove') === 0) {
        done();
        const best = l.split(/\s+/)[1] || null;
        resolve({ best: best === '(none)' ? null : best, score });
      }
    };
    const onFail = (err) => { done(); reject(err); };
    lineHandlers.add(onLine);
    failHandlers.add(onFail);
    timer = setTimeout(() => fail(new Error('The engine stopped responding')), movetime + SEARCH_GRACE);
    send('position fen ' + fen);
    send('go movetime ' + movetime);
  });
}

const num = (v) => (typeof v === 'number' ? v : undefined);

export const engine = {
  supported,
  isReady: () => ready,
  // Starts the engine if needed; resolves once it answers `readyok`.
  ready: () => load(),
  // Returns a UCI move string (e.g. "e2e4") or "(none)".
  async bestMove(fen, opts) {
    const skill = opts ? num(opts.skill) : undefined;
    const movetime = Number(opts && opts.movetime) || 500;
    const r = await enqueue(async () => {
      await load();
      setSkill(typeof skill === 'number' ? skill : 20);
      return search(fen, movetime);
    });
    return r.best || '(none)';
  },
  // Returns { best: "e2e4"|null, score: { cp } | { mate } | null } at full strength.
  evaluate(fen, opts) {
    const movetime = Number(opts && opts.movetime) || 300;
    return enqueue(async () => {
      await load();
      setSkill(20); // analysis is always full strength
      return search(fen, movetime);
    });
  },
  newGame() {
    return enqueue(async () => {
      await load();
      send('ucinewgame');
      send('isready');
      currentSkill = null;
      return true;
    });
  },
};
