// Electron main process.
// Hosts the Stockfish engine (Node side — no browser fetch/worker issues) and
// serves moves + evaluations to the renderer over IPC. Loads the offline chess UI.
const { app, BrowserWindow, Menu, ipcMain } = require('electron');
const path = require('path');

// ---------- Stockfish (lite, single-threaded WASM) in the main process ----------
const SF_DIR = path.join(__dirname, 'node_modules', 'stockfish', 'bin');
const SF_JS = path.join(SF_DIR, 'stockfish-18-lite-single.js');
const SF_WASM = path.join(SF_DIR, 'stockfish-18-lite-single.wasm');

let engine = null;
let engineReady = null; // Promise, created on first use
let currentSkill = null;
const lineHandlers = new Set();

function emitLine(line) {
  const s = String(line);
  for (const h of [...lineHandlers]) h(s);
}

function loadEngine() {
  if (engineReady) return engineReady;
  engineReady = new Promise((resolve, reject) => {
    let INIT;
    try {
      INIT = require(SF_JS);
    } catch (e) {
      return reject(e);
    }
    // The build emits all output through `listener`
    // (print = e => listener ? listener(e) : console.log(e)).
    const mod = {
      locateFile: (p) => (p.indexOf('.wasm') > -1 ? SF_WASM : SF_JS),
      listener: emitLine,
    };
    INIT()(mod)
      .then(function check() {
        if (mod._isReady && !mod._isReady()) return setTimeout(check, 10);
        mod.sendCommand = (cmd) =>
          setImmediate(() => mod.ccall('command', null, ['string'], [cmd], { async: /^go\b/.test(cmd) }));
        engine = mod;
        const onReady = (l) => {
          if (l === 'readyok') {
            lineHandlers.delete(onReady);
            resolve();
          }
        };
        lineHandlers.add(onReady);
        engine.sendCommand('uci');
        engine.sendCommand('isready');
      })
      .catch(reject);
  });
  return engineReady;
}

// Serialize engine searches — only one `go` may be in flight at a time.
let chain = Promise.resolve();
function enqueue(task) {
  const run = chain.then(task, task);
  chain = run.then(() => {}, () => {});
  return run;
}

function setSkill(skill) {
  const s = typeof skill === 'number' ? skill : 20;
  if (s !== currentSkill) {
    engine.sendCommand('setoption name Skill Level value ' + s);
    currentSkill = s;
  }
}

// One search. Resolves { best, score } where score is { cp } or { mate },
// from the perspective of the side to move in `fen`.
function search(fen, movetime) {
  return new Promise((resolve) => {
    let score = null;
    const onLine = (l) => {
      if (l.indexOf('info ') === 0) {
        const m = l.match(/ score (cp|mate) (-?\d+)/);
        if (m) score = m[1] === 'cp' ? { cp: parseInt(m[2], 10) } : { mate: parseInt(m[2], 10) };
      } else if (l.indexOf('bestmove') === 0) {
        lineHandlers.delete(onLine);
        const best = l.split(/\s+/)[1] || null;
        resolve({ best: best === '(none)' ? null : best, score });
      }
    };
    lineHandlers.add(onLine);
    engine.sendCommand('position fen ' + fen);
    engine.sendCommand('go movetime ' + (Number(movetime) || 400));
  });
}

async function engineBestMove({ fen, skill, movetime }) {
  await loadEngine();
  const r = await enqueue(() => {
    setSkill(typeof skill === 'number' ? skill : 20);
    return search(fen, movetime || 500);
  });
  return r.best || '(none)';
}

async function engineEvaluate({ fen, movetime }) {
  await loadEngine();
  return enqueue(() => {
    setSkill(20); // analysis is always full strength
    return search(fen, movetime || 300);
  });
}

ipcMain.handle('engine:bestmove', (_e, a) => engineBestMove(a || {}));
ipcMain.handle('engine:evaluate', (_e, a) => engineEvaluate(a || {}));
ipcMain.handle('engine:newgame', async () => {
  await loadEngine();
  return enqueue(() => {
    engine.sendCommand('ucinewgame');
    engine.sendCommand('isready');
    currentSkill = null;
    return true;
  });
});

// ---------- Window ----------
function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 900,
    minWidth: 980,
    minHeight: 740,
    backgroundColor: '#0f1320',
    title: 'Chess Trainer',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', 'chess.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile('index.html');
}

Menu.setApplicationMenu(null);

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
