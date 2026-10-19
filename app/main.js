// Repopolis 데스크톱 앱
// 프로젝트를 고르면 도시를 띄우고, 커밋이나 수정이 생기면 실시간으로 다시 짓는다.
const path = require('path');
const electron = require('electron');

// VS Code·Claude 터미널에서 띄우면 ELECTRON_RUN_AS_NODE=1이 따라와 창 없이 Node로 돈다 → 그 변수를 빼고 다시 실행
if (typeof electron === 'string' || !electron.app) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  require('child_process').spawn(process.execPath, [path.join(__dirname, '..')], { env, detached: true, stdio: 'ignore' }).unref();
  process.exit(0);
}

const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net } = electron;
const fs = require('fs');
const { pathToFileURL } = require('url');
const { Worker } = require('worker_threads');
const { execFile } = require('child_process');
const { renderHtml, gitConfigIsRisky } = require('../scan.js');

const WIP_POLL_MS = 12000;
const debug = (...a) => process.env.CC_DEBUG && console.log('[cc]', ...a);

// 화면은 app://repopolis/ 아래에서 연다 — three.js 같은 라이브러리를 앱 안(app/vendor)에서 읽어 인터넷 없이 돈다
const ORIGIN = 'app://repopolis';
const LAUNCHER = `${ORIGIN}/launcher.html`;
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
const cityFile = () => path.join(app.getPath('userData'), 'city.html');
function resolveAppUrl(url) {
  const rel = decodeURIComponent(new URL(url).pathname).replace(/^\/+/, '');
  if (rel === 'city.html') return cityFile();
  const abs = path.normalize(path.join(__dirname, rel));
  return abs.startsWith(__dirname + path.sep) ? abs : null;
}
const LOCAL_ASSETS = { three: `${ORIGIN}/vendor/three/`, hljs: `${ORIGIN}/vendor/hljs/` };
const CSP = [
  "default-src 'self'", "script-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "font-src 'self' data: https://cdn.jsdelivr.net", "img-src 'self' data: blob:", "connect-src 'self'",
  "object-src 'none'", "base-uri 'none'", "frame-src 'none'", "form-action 'none'",
].join('; ');

let win = null;
let current = null; // { root, data, watcher, poll, busy, pending, wipKey }

// ───────── 설정 (최근 프로젝트) ─────────
const configPath = () => path.join(app.getPath('userData'), 'config.json');
function loadConfig() {
  try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')); } catch { return { recent: [] }; }
}
function saveConfig(cfg) {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2));
}
function remember(root, name) {
  const cfg = loadConfig();
  cfg.recent = [{ root, name, at: Date.now() }, ...cfg.recent.filter((r) => r.root !== root)].slice(0, 8);
  cfg.last = root;
  saveConfig(cfg);
}

// ───────── 스캔 (별도 스레드라 창이 멈추지 않는다) ─────────
function scan(root) {
  return new Promise((resolve, reject) => {
    const w = new Worker(path.join(__dirname, 'scan-worker.js'), { workerData: { root } });
    w.once('message', (m) => (m.error ? reject(new Error(m.error)) : resolve(m.data)));
    w.once('error', reject);
  });
}
// scan.js 와 같은 방어 옵션 (저장소 설정이 외부 명령을 띄우지 못하게)
function git(args, cwd) {
  return new Promise((resolve) => {
    execFile('git', ['-c', 'core.quotepath=off', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', ...args],
      { cwd, maxBuffer: 1 << 26, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' } },
      (err, out) => resolve(err ? null : out));
  });
}

function showCity(data, hash) {
  fs.writeFileSync(cityFile(), renderHtml(data, { assets: LOCAL_ASSETS }));
  win.setTitle(`Repopolis — ${data.name}`);
  return win.loadURL(`${ORIGIN}/city.html?v=${Date.now()}${hash ? `#${hash}` : ''}`); // 해시만 바뀌면 새로고침이 안 되므로
}

function send(status) {
  if (win && !win.isDestroyed()) win.webContents.send('status', status);
}

// 열기가 겹치면(자동으로 여는 중에 폴더를 끌어다 놓는 등) 마지막 요청만 화면에 올린다
let openSeq = 0;
async function openProject(root) {
  stopWatching();
  const seq = ++openSeq;
  const name = path.basename(root);
  send({ loading: name });
  let data;
  try {
    data = await scan(root);
  } catch (e) {
    if (seq === openSeq) send({ error: e.message });
    return;
  }
  if (seq !== openSeq) return;
  remember(root, name);
  current = { root, data };
  await showCity(data, '');
  watch(current);
}

// ───────── 실시간 감시 ─────────
// 커밋: .git/logs/HEAD 변경을 감지 / 공사 현황: git status를 주기적으로 비교
async function watch(proj) {
  if (!proj.data.git || gitConfigIsRisky(proj.root)) return; // git 을 안 쓰는 프로젝트는 실시간 감시도 없다
  proj.wipKey = await git(['status', '--porcelain', '--untracked-files=all'], proj.root);
  const gitDir = (await git(['rev-parse', '--absolute-git-dir'], proj.root))?.trim();
  if (proj.stopped) return; // 기다리는 사이 다른 프로젝트로 바뀌었다 — 감시자를 남기지 않는다
  if (gitDir && fs.existsSync(path.join(gitDir, 'logs', 'HEAD'))) {
    let timer;
    try {
      debug('watching', path.join(gitDir, 'logs', 'HEAD'));
      proj.watcher = fs.watch(path.join(gitDir, 'logs', 'HEAD'), (ev) => {
        debug('HEAD log changed', ev);
        clearTimeout(timer);
        timer = setTimeout(() => refresh(proj), 1500);
      });
    } catch {}
  }
  proj.poll = setInterval(async () => {
    const key = await git(['status', '--porcelain', '--untracked-files=all'], proj.root);
    if (key !== null && key !== proj.wipKey) refresh(proj);
  }, WIP_POLL_MS);
}

function stopWatching() {
  if (!current) return;
  current.watcher?.close();
  clearInterval(current.poll);
  current.stopped = true;
  current = null;
}

async function refresh(proj) {
  if (proj.stopped) return;
  if (proj.busy) { proj.pending = true; return; }
  proj.busy = true;
  debug('refresh');
  try {
    const data = await scan(proj.root);
    if (proj.stopped) return;
    proj.wipKey = await git(['status', '--porcelain', '--untracked-files=all'], proj.root);
    const before = proj.data, oldN = before.commits.length, newN = data.commits.length;
    const wipBefore = before.files.filter((f) => f.wip).length, wipNow = data.files.filter((f) => f.wip).length;
    proj.data = data;

    const params = new URLSearchParams({ live: '1' });
    if (newN > oldN) {
      // 새 커밋 → 직전 상태부터 타임랩스로 재생하면 건물이 자라는 장면이 된다
      const subject = data.commits[newN - 1][3];
      params.set('time', String(oldN));
      params.set('play', '1');
      params.set('toast', newN - oldN === 1 ? `🎉 준공! ${subject}` : `🎉 새 커밋 ${newN - oldN}개 — ${subject}`);
    } else if (wipNow !== wipBefore) {
      params.set('toast', wipNow > wipBefore ? `🏗️ 공사 시작 — 공사 중 ${wipNow}곳` : `🏗️ 공사 중 ${wipNow}곳`);
    }
    await showCity(data, params.toString());
  } catch (e) {
    debug('refresh failed', e);
    // git 작업 도중(리베이스 등)엔 실패할 수 있다 — 다음 변화 때 다시 시도
  } finally {
    proj.busy = false;
    if (proj.pending && !proj.stopped) { proj.pending = false; refresh(proj); }
  }
}

// ───────── IPC ─────────
// 앱 화면(app://repopolis)에서 온 요청만 받는다
function handle(name, fn) {
  ipcMain.handle(name, (e, ...args) => (e.senderFrame?.url?.startsWith(ORIGIN) ? fn(e, ...args) : null));
}
handle('home', () => {
  stopWatching();
  win.setTitle('Repopolis');
  return win.loadURL(LAUNCHER);
});
handle('pick', async () => {
  const r = await dialog.showOpenDialog(win, { title: '도시로 만들 프로젝트 폴더', properties: ['openDirectory'] });
  if (!r.canceled && r.filePaths[0]) await openProject(r.filePaths[0]);
});
handle('open-project', (_, root) => {
  if (typeof root !== 'string' || !fs.statSync(root, { throwIfNoEntry: false })?.isDirectory()) return null;
  return openProject(root);
});
handle('recent', () => loadConfig().recent.filter((r) => fs.existsSync(r.root)));
handle('forget', (_, root) => {
  const cfg = loadConfig();
  cfg.recent = cfg.recent.filter((r) => r.root !== root);
  if (cfg.last === root) delete cfg.last;
  saveConfig(cfg);
});
// 프로젝트 안의 파일만 — 심볼릭 링크로 밖을 가리키는 것도 실제 경로로 막는다
const inProject = (rel) => {
  if (typeof rel !== 'string') return null;
  const root = path.resolve(current.root), abs = path.resolve(root, rel);
  if (!abs.startsWith(root + path.sep)) return null;
  try {
    const realRoot = fs.realpathSync(root), real = fs.realpathSync(abs);
    return real.startsWith(realRoot + path.sep) ? real : null;
  } catch { return null; }
};
// "파일 열기"가 저장소 안의 스크립트를 실행하지 않게: 에디터(VS Code)가 있으면 에디터로,
// 없으면 실행될 수 있는 확장자는 폴더에서 보여 주기만 한다
const RUNNABLE = new Set(['.js', '.jse', '.mjs', '.cjs', '.vbs', '.vbe', '.wsf', '.wsh', '.hta', '.bat', '.cmd', '.com', '.exe', '.scr', '.pif',
  '.lnk', '.url', '.scf', '.cpl', '.msc', '.msi', '.reg', '.ps1', '.psm1', '.jar', '.command', '.terminal', '.app', '.desktop', '.sh', '.py', '.pyw']);
function openSafely(p) {
  if (app.getApplicationNameForProtocol('vscode://')) {
    return shell.openExternal('vscode://file/' + p.split(path.sep).map((s, k) => (k === 0 && /^[A-Za-z]:$/.test(s) ? s : encodeURIComponent(s))).join('/'));
  }
  if (RUNNABLE.has(path.extname(p).toLowerCase())) return shell.showItemInFolder(p);
  return shell.openPath(p);
}
handle('open-file', (_, rel) => { const p = current && inProject(rel); if (p) openSafely(p); });
handle('reveal-file', (_, rel) => { const p = current && inProject(rel); if (p) shell.showItemInFolder(p); });
handle('read-file', (_, rel) => {
  const p = current && inProject(rel);
  if (!p) return null;
  const st = fs.statSync(p, { throwIfNoEntry: false });
  if (!st || !st.isFile() || st.size > 2 * 1024 * 1024) return null;
  return fs.readFileSync(p, 'utf8');
});

// ───────── 창 ─────────
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

app.whenReady().then(async () => {
  protocol.handle('app', async (req) => {
    const file = resolveAppUrl(req.url);
    if (!file || !fs.existsSync(file)) return new Response('not found', { status: 404 });
    const res = await net.fetch(pathToFileURL(file).toString());
    if (!file.endsWith('.html')) return res;
    // 화면에는 앱 안의 스크립트만 (글꼴 CSS 만 CDN), 외부로 데이터를 보내는 연결은 막는다
    const headers = new Headers(res.headers);
    headers.set('Content-Security-Policy', CSP);
    return new Response(res.body, { status: res.status, headers });
  });
  win = new BrowserWindow({
    width: 1500, height: 940, minWidth: 900, minHeight: 600,
    backgroundColor: '#090c14', title: 'Repopolis', autoHideMenuBar: true, icon: path.join(__dirname, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  // 링크(vscode:// 등)는 앱 안에서 열지 않는다
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(ORIGIN)) e.preventDefault(); });

  await win.loadURL(LAUNCHER);
  const last = loadConfig().last;
  if (last && fs.existsSync(last)) openProject(last);
});
app.on('window-all-closed', () => { stopWatching(); app.quit(); });
