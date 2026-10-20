// Repopolis 데스크톱 앱
// 프로젝트를 고르면 도시를 띄우고, 커밋이나 수정이 생기면 실시간으로 다시 짓는다.
const path = require('path');
const electron = require('electron');

// VS Code·Claude 터미널에서 띄우면 ELECTRON_RUN_AS_NODE=1이 따라와 창 없이 Node로 돈다 → 그 변수를 빼고 다시 실행
if (typeof electron === 'string' || !electron.app) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  // 설치 파일로 켰다면 원래 exe 를 다시 켠다 — 임시 폴더 안 exe 를 켜고 끝내면 실행기가 그 폴더를 지워 새 앱의 파일이 사라진다
  const exe = process.env.PORTABLE_EXECUTABLE_FILE;
  require('child_process').spawn(exe || process.execPath, exe ? [] : [path.join(__dirname, '..')], { env, detached: true, stdio: 'ignore' }).unref();
  process.exit(0);
}

const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, screen, Tray, Menu, Notification, nativeImage } = electron;
const fs = require('fs');
const { pathToFileURL } = require('url');
const { Worker } = require('worker_threads');
const { execFile } = require('child_process');
const { renderHtml, gitConfigIsRisky } = require('../scan.js');
const updater = require('./updater');

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
    w.once('error', (e) => reject(e.code === 'MODULE_NOT_FOUND'
      ? new Error('앱 파일 일부가 지워졌어요. 트레이 아이콘에서 끝내기로 앱을 완전히 끈 뒤 다시 켜 주세요.')
      : e));
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
  updateTray(data);
  if (mini && !mini.isDestroyed()) { if (mini.isVisible()) loadMini(hash); else mini.dirty = true; }
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
    if (newN > oldN) notify(`🎉 준공! — ${data.name}`, data.commits[newN - 1][3]);
    else if (wipNow > wipBefore) {
      const was = new Set(before.files.filter((f) => f.wip).map((f) => f.p));
      const fresh = data.files.find((f) => f.wip && !was.has(f.p));
      notify(`🏗️ 공사 시작 — ${data.name}`, `${fresh ? fresh.p : ''} · 공사 중 ${wipNow}곳`);
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

// 창 크기: 설정 패널의 프리셋(작게 · 보통 · 크게) · 최대화 · 전체 화면
const windowState = () => ({ size: win.getSize(), max: win.isMaximized(), full: win.isFullScreen() });
handle('window-state', () => (win ? windowState() : null));
handle('window', (_, cmd) => {
  if (!win) return null;
  if (cmd === 'full') win.setFullScreen(!win.isFullScreen());
  else if (cmd === 'max') {
    if (win.isFullScreen()) win.setFullScreen(false);
    else if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  } else if (Array.isArray(cmd) && cmd.length === 2 && cmd.every((n) => Number.isFinite(n) && n > 0)) {
    if (win.isFullScreen()) win.setFullScreen(false);
    if (win.isMaximized()) win.unmaximize();
    const wa = screen.getDisplayMatching(win.getBounds()).workAreaSize;
    win.setSize(Math.max(MIN_W, Math.min(Math.round(cmd[0]), wa.width)), Math.max(MIN_H, Math.min(Math.round(cmd[1]), wa.height)));
    win.center();
  }
  return windowState();
});
// 지난번 창 크기 · 위치로 연다 (그 자리가 지금 화면 밖이면 크기만)
const MIN_W = 720, MIN_H = 480;
function savedBounds() {
  const b = loadConfig().window;
  if (!b || !(b.width >= MIN_W && b.height >= MIN_H)) return { width: 1500, height: 940 };
  const wa = screen.getDisplayMatching(b).workArea;
  const onScreen = b.x >= wa.x - 40 && b.y >= wa.y - 40 && b.x + b.width <= wa.x + wa.width + 40 && b.y + b.height <= wa.y + wa.height + 40;
  return onScreen ? { x: b.x, y: b.y, width: b.width, height: b.height, max: b.max } : { width: Math.min(b.width, wa.width), height: Math.min(b.height, wa.height), max: b.max };
}

// ───────── 트레이 · 공사 현황 팝업 · 알림 ─────────
// 작업 표시줄 시계 옆 아이콘: 왼쪽 클릭 = 공사 현황 팝업(작은 도시 + 공사 중 · 최근 준공), 오른쪽 클릭 = 메뉴.
// 창을 닫아도 트레이에서 계속 지켜보다가 커밋 · 새 공사가 생기면 윈도우 알림을 띄운다
let tray = null, mini = null;
const MINI_W = 340, MINI_H = 500;
const notifyOn = () => loadConfig().notify !== false;
function showMain() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}
function notify(title, body) {
  if (!notifyOn() || !Notification.isSupported() || (win && win.isFocused())) return; // 창을 보고 있으면 화면 안 알림으로 충분하다
  const n = new Notification({ title, body, icon: path.join(__dirname, 'icon.png'), silent: false });
  n.on('click', showMain);
  n.show();
}
function updateItems() {
  const u = updater.state();
  if (u.status === 'available') return [{ label: `⬆️ 새 버전 ${u.version} 받기…`, click: () => { showMain(); promptUpdate(); } }, { type: 'separator' }];
  if (u.status === 'downloading') return [{ label: `⬇️ 새 버전 받는 중 ${Math.round(u.progress * 100)}%`, enabled: false }, { type: 'separator' }];
  if (u.status === 'ready') return [{ label: `🔄 다시 시작해서 ${u.version} 으로 업데이트…`, click: () => { showMain(); promptUpdate(); } }, { type: 'separator' }];
  return [];
}
function installUpdate() {
  return updater.install(() => { app.isQuitting = true; app.quit(); });
}
// 강제로 받거나 바꾸지 않는다 — 받기 전 · 바꾸기 전에 한 번씩 물어본다
let prompting = false;
const dialogParent = () => (win && !win.isDestroyed() && win.isVisible() ? win : undefined);
async function promptUpdate() {
  if (prompting) return updater.state();
  prompting = true;
  try {
    let u = updater.state();
    if (u.status === 'available') {
      const { response } = await dialog.showMessageBox(dialogParent(), {
        type: 'info', title: 'Repopolis 새 버전', noLink: true, defaultId: 0, cancelId: 1,
        message: `새 버전 ${u.version} 이 나왔어요`,
        detail: `지금 ${u.current} → ${u.version}${u.notes ? `\n\n${u.notes}` : ''}\n\n받은 뒤 다시 시작하면 바뀌어요. 받는 동안에도 계속 쓸 수 있어요.`,
        buttons: ['받기', '나중에', '바뀐 점 보기'],
      });
      if (response === 2) updater.openPage();
      if (response !== 0) return updater.state();
      u = await updater.download();
      if (u.status !== 'ready') return u;
    }
    if (u.status === 'ready') {
      const { response } = await dialog.showMessageBox(dialogParent(), {
        type: 'info', title: 'Repopolis 새 버전', noLink: true, defaultId: 0, cancelId: 1,
        message: `${u.version} 을 다 받았어요`,
        detail: '지금 다시 시작해서 업데이트할까요? 보던 프로젝트는 다시 열려요.\n나중에 하려면 위쪽 버튼이나 트레이 메뉴에서 할 수 있어요.',
        buttons: ['다시 시작', '나중에'],
      });
      if (response === 0) await installUpdate();
    }
    return updater.state();
  } finally {
    prompting = false;
  }
}
function trayMenu() {
  const d = current?.data, wip = d ? d.files.filter((f) => f.wip) : [];
  return Menu.buildFromTemplate([
    ...updateItems(),
    { label: d ? `🏙️ ${d.name}` : '🏙️ Repopolis', enabled: false },
    { label: d ? (wip.length ? `🏗️ 공사 중 ${wip.length}곳` : '🏗️ 공사 중인 곳 없음') : '열린 프로젝트 없음', enabled: false },
    ...wip.slice(0, 6).map((f) => ({ label: `   ${f.p}`, click: () => focusFile(f.p) })),
    { type: 'separator' },
    { label: '도시 열기', click: showMain },
    { label: '공사 현황 보기', click: () => toggleMini(true) },
    { label: '준공 · 공사 알림', type: 'checkbox', checked: notifyOn(), click: (it) => setNotify(it.checked) },
    { type: 'separator' },
    { label: '끝내기', click: () => { app.isQuitting = true; app.quit(); } },
  ]);
}
function updateTray(data) {
  if (!tray) return;
  const wip = data ? data.files.filter((f) => f.wip).length : 0;
  tray.setToolTip(data ? `Repopolis · ${data.name}${wip ? ` · 🏗️ 공사 중 ${wip}곳` : ''}` : 'Repopolis');
  tray.setContextMenu(trayMenu());
}
function setNotify(on) {
  const cfg = loadConfig();
  cfg.notify = !!on;
  saveConfig(cfg);
  updateTray(current?.data);
  return cfg.notify;
}
function createTray() {
  const img = nativeImage.createFromPath(path.join(__dirname, 'icon.png')).resize({ width: 16, height: 16 });
  tray = new Tray(img);
  tray.on('click', () => toggleMini());
  tray.on('double-click', showMain);
  updateTray(current?.data);
}
// 팝업은 트레이 아이콘 바로 위(작업 표시줄이 위 · 옆이면 그쪽)에 붙인다
function placeMini() {
  const b = tray.getBounds(), wa = screen.getDisplayNearestPoint({ x: b.x, y: b.y }).workArea;
  let x = Math.round(b.x + b.width / 2 - MINI_W / 2), y = wa.y + wa.height - MINI_H - 8;
  if (b.y < wa.y) y = wa.y + 8;
  if (b.x < wa.x) x = wa.x + 8;
  else if (b.x >= wa.x + wa.width) x = wa.x + wa.width - MINI_W - 8;
  x = Math.min(Math.max(x, wa.x + 8), wa.x + wa.width - MINI_W - 8);
  mini.setBounds({ x, y, width: MINI_W, height: MINI_H });
}
function loadMini(hash = '') {
  mini.dirty = false;
  const h = new URLSearchParams(hash);
  h.set('live', '1');
  return mini.loadURL(current ? `${ORIGIN}/city.html?mini=1&v=${Date.now()}#${h}` : LAUNCHER);
}
function toggleMini(force) {
  if (!current) return showMain(); // 열린 프로젝트가 없으면 고르는 화면으로
  if (!mini || mini.isDestroyed()) {
    mini = new BrowserWindow({
      width: MINI_W, height: MINI_H, show: false, frame: false, resizable: false, skipTaskbar: true, alwaysOnTop: true,
      backgroundColor: '#0b0f18', title: 'Repopolis 공사 현황', icon: path.join(__dirname, 'icon.png'),
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
    });
    mini.pinned = false;
    mini.dirty = true;
    mini.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    mini.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(ORIGIN)) e.preventDefault(); });
    // 다른 곳을 누르면 접힌다 (고정했으면 그대로)
    mini.on('blur', () => { if (!mini.pinned && !mini.isDestroyed()) mini.hide(); });
  }
  const show = force ?? !mini.isVisible();
  if (!show) return mini.hide();
  if (!mini.pinned) placeMini();
  if (mini.dirty) loadMini();
  mini.show();
  mini.focus();
}
function focusFile(rel) {
  showMain();
  win.webContents.send('focus-file', rel);
}
handle('show-main', () => showMain());
handle('focus-file', (_, rel) => { if (typeof rel === 'string') focusFile(rel); });
handle('mini', (_, cmd) => {
  if (cmd === 'open') return toggleMini(true);
  if (cmd === 'close') return mini?.hide();
  if (cmd === 'pin' && mini && !mini.isDestroyed()) { mini.pinned = !mini.pinned; mini.setAlwaysOnTop(true); return mini.pinned; }
  return null;
});
handle('notify-get', () => notifyOn());
// 새 버전 (확인 · 받기 · 바꾸고 다시 켜기)
handle('update-state', () => updater.state());
handle('update-check', () => updater.check());
handle('update-download', () => promptUpdate()); // 화면의 버튼도 확인 창을 거친다
handle('update-install', () => promptUpdate());
handle('update-page', () => updater.openPage());
let updateNotified = null;
function onUpdate(s) {
  for (const w of [win, mini]) if (w && !w.isDestroyed()) w.webContents.send('update', s);
  if (s.status !== 'downloading' || s.progress >= 1) updateTray(current?.data);
  // 새 버전을 처음 찾았을 때 한 번만: 창을 보고 있으면 확인 창, 트레이에 있으면 알림(누르면 확인 창)
  if (s.status === 'available' && updateNotified !== s.version) {
    updateNotified = s.version;
    if (dialogParent()) promptUpdate();
    else if (Notification.isSupported()) {
      const n = new Notification({ title: `⬆️ Repopolis ${s.version} 이 나왔어요`, body: '눌러서 받을지 고르세요', icon: path.join(__dirname, 'icon.png') });
      n.on('click', () => { showMain(); promptUpdate(); });
      n.show();
    }
  }
}
handle('notify-set', (_, on) => setNotify(on));

// ───────── 창 ─────────
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', showMain);
app.on('activate', showMain); // 맥: 창을 닫은 뒤 Dock 아이콘을 누르면 다시
app.on('before-quit', () => { app.isQuitting = true; });
if (process.platform === 'win32') app.setAppUserModelId('com.repopolis.app');

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
  const { max, ...bounds } = savedBounds();
  win = new BrowserWindow({
    ...bounds, minWidth: MIN_W, minHeight: MIN_H,
    backgroundColor: '#090c14', title: 'Repopolis', autoHideMenuBar: true, icon: path.join(__dirname, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  if (max) win.maximize();
  win.on('close', (e) => {
    const cfg = loadConfig();
    cfg.window = { ...win.getNormalBounds(), max: win.isMaximized() };
    // 닫기 = 트레이로 내리기 (계속 지켜본다). 끝내려면 트레이 메뉴의 '끝내기'
    if (tray && !app.isQuitting) {
      e.preventDefault();
      win.hide();
      if (!cfg.trayHinted) { cfg.trayHinted = true; notify('Repopolis 는 트레이에서 계속 지켜봐요', '시계 옆 아이콘을 누르면 공사 현황, 오른쪽 클릭하면 끝내기가 있어요'); }
    }
    try { saveConfig(cfg); } catch {}
  });
  createTray();
  updater.start(onUpdate);
  // 링크(vscode:// 등)는 앱 안에서 열지 않는다
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(ORIGIN)) e.preventDefault(); });

  await win.loadURL(LAUNCHER);
  const last = loadConfig().last;
  if (last && fs.existsSync(last)) openProject(last);
});
app.on('window-all-closed', () => { stopWatching(); app.quit(); });
app.on('will-quit', () => { tray?.destroy(); });
