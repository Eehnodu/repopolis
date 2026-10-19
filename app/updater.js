// 새 버전: GitHub 의 최신 Release 를 확인하고, 내 컴퓨터용 파일을 받아 지금 실행 파일과 바꾼 뒤 다시 켠다.
// Windows = 지금 돌고 있는 Repopolis-windows.exe 자리에 덮어쓰기 / Mac = Repopolis.app 통째로 바꾸기.
// 바꿀 수 없는 상황(개발 중 · 쓰기 권한 없음)이면 받은 파일을 폴더에서 보여 준다.
const { app, net, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');

const REPO = 'Eehnodu/repopolis';
const PAGE = `https://github.com/${REPO}/releases/latest`;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

const ASSET = process.platform === 'win32' ? 'Repopolis-windows.exe'
  : process.platform === 'darwin' ? `Repopolis-macos-${process.arch === 'arm64' ? 'arm64' : 'x64'}.zip` : null;

// status: idle · checking · latest · available · downloading · ready · error
// REPOPOLIS_FAKE_VERSION: 업데이트 흐름을 시험할 때만 지금 버전을 낮춰 보이게
const state = { status: 'idle', current: process.env.REPOPOLIS_FAKE_VERSION || app.getVersion(), version: null, url: PAGE, notes: '', progress: 0, error: null, manual: false };
let listeners = [];
let asset = null; // { url, size }
let downloaded = null;

const newer = (a, b) => {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let k = 0; k < 3; k++) if ((pa[k] || 0) !== (pb[k] || 0)) return (pa[k] || 0) > (pb[k] || 0);
  return false;
};
function set(patch) {
  Object.assign(state, patch);
  for (const fn of listeners) fn({ ...state });
}

async function check({ quiet = false } = {}) {
  if (['checking', 'downloading', 'ready'].includes(state.status)) return { ...state };
  set({ status: 'checking', error: null });
  try {
    const res = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { 'User-Agent': `Repopolis/${state.current}`, Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) throw new Error(`GitHub 응답 ${res.status}`);
    const rel = await res.json();
    const version = String(rel.tag_name || '').replace(/^v/, '');
    const a = (rel.assets || []).find((x) => x.name === ASSET);
    asset = a ? { url: a.browser_download_url, size: a.size } : null;
    // 릴리스 노트에서 글머리표만 짧게 — 확인 창에 "바뀐 점" 으로 보여 준다
    const notes = String(rel.body || '').split(/\r?\n/).filter((l) => /^\s*[-*] /.test(l))
      .map((l) => l.replace(/^\s*[-*] /, '• ').replace(/\*\*|`/g, '').replace(/\s+—.*$/, '')).slice(0, 6)
      .map((l) => (l.length > 70 ? `${l.slice(0, 69)}…` : l)).join('\n');
    const url = typeof rel.html_url === 'string' && rel.html_url.startsWith(`https://github.com/${REPO}/`) ? rel.html_url : PAGE;
    if (!/^\d+\.\d+\.\d+$/.test(version) || !newer(version, state.current)) set({ status: 'latest', version, url });
    else set({ status: 'available', version, url, notes, manual: !asset });
  } catch (e) {
    // 인터넷이 없을 때 자동 확인은 조용히 넘긴다
    set(quiet ? { status: 'idle' } : { status: 'error', error: e.message });
  }
  return { ...state };
}

async function download() {
  if (state.status !== 'available') return { ...state };
  if (!asset) { shell.openExternal(state.url); return { ...state }; }
  const dir = path.join(app.getPath('userData'), 'update');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, ASSET), part = `${file}.part`;
  set({ status: 'downloading', progress: 0, error: null });
  try {
    const res = await net.fetch(asset.url, { headers: { 'User-Agent': `Repopolis/${state.current}` } });
    if (!res.ok || !res.body) throw new Error(`내려받기 실패 (${res.status})`);
    const total = Number(res.headers.get('content-length')) || asset.size || 0;
    const out = fs.createWriteStream(part);
    let got = 0, lastSent = 0;
    for await (const chunk of res.body) {
      got += chunk.length;
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
      const p = total ? got / total : 0;
      if (p - lastSent >= 0.01) { lastSent = p; set({ progress: p }); }
    }
    await new Promise((r, j) => out.end((err) => (err ? j(err) : r())));
    if (asset.size && fs.statSync(part).size !== asset.size) throw new Error('받은 파일 크기가 맞지 않아요');
    fs.rmSync(file, { force: true });
    fs.renameSync(part, file);
    downloaded = file;
    set({ status: 'ready', progress: 1 });
  } catch (e) {
    fs.rmSync(part, { force: true });
    set({ status: 'available', error: e.message });
  }
  return { ...state };
}

const writable = (dir) => { try { fs.accessSync(dir, fs.constants.W_OK); return true; } catch { return false; } };
const cleanEnv = () => { const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; return env; };

// 지금 실행 파일과 바꾸고 다시 켠다. 바꿀 수 없으면 받은 파일을 보여 주고 'manual' 을 돌려준다
async function install(quit) {
  if (state.status !== 'ready' || !downloaded) return 'not-ready';

  if (process.platform === 'win32') {
    // electron-builder portable 은 원래 exe 경로를 이 변수로 알려 준다 (개발 중엔 없다)
    const target = process.env.PORTABLE_EXECUTABLE_FILE;
    if (!target || !writable(path.dirname(target))) { shell.showItemInFolder(downloaded); return 'manual'; }
    // 앱이 완전히 꺼져 exe 잠금이 풀릴 때까지 기다렸다가 덮어쓰고 다시 켠다 (경로는 인수로 — 한글 경로 안전)
    const script = path.join(os.tmpdir(), `repopolis-update-${Date.now()}.cmd`);
    fs.writeFileSync(script, [
      '@echo off',
      'set tries=0',
      ':retry',
      'move /y "%~1" "%~2" >nul 2>&1',
      'if not errorlevel 1 goto run',
      'set /a tries+=1',
      'if %tries% geq 90 goto run',
      'ping -n 2 127.0.0.1 >nul',
      'goto retry',
      ':run',
      'start "" "%~2"',
      'del "%~f0"',
    ].join('\r\n'));
    spawn('cmd.exe', ['/d', '/c', script, downloaded, target], { detached: true, stdio: 'ignore', windowsHide: true, env: cleanEnv() }).unref();
    quit();
    return 'restarting';
  }

  if (process.platform === 'darwin') {
    const bundle = path.resolve(process.execPath, '../../..');
    if (!bundle.endsWith('.app') || !writable(path.dirname(bundle))) { shell.showItemInFolder(downloaded); return 'manual'; }
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'repopolis-update-'));
    await new Promise((r, j) => execFile('ditto', ['-x', '-k', downloaded, tmp], (err) => (err ? j(err) : r())));
    const fresh = path.join(tmp, 'Repopolis.app');
    if (!fs.existsSync(fresh)) { shell.showItemInFolder(downloaded); return 'manual'; }
    // 이 프로세스가 끝나길 기다렸다가 앱 묶음을 통째로 바꾸고 다시 연다
    const script = path.join(tmp, 'swap.sh');
    fs.writeFileSync(script, [
      '#!/bin/bash',
      'while kill -0 "$1" 2>/dev/null; do sleep 0.3; done',
      'rm -rf "$3" && ditto "$2" "$3"',
      'xattr -dr com.apple.quarantine "$3" 2>/dev/null',
      'open "$3"',
      'rm -rf "$(dirname "$2")"',
    ].join('\n'), { mode: 0o755 });
    spawn('/bin/bash', [script, String(process.pid), fresh, bundle], { detached: true, stdio: 'ignore', env: cleanEnv() }).unref();
    quit();
    return 'restarting';
  }

  shell.showItemInFolder(downloaded);
  return 'manual';
}

function start(onChange) {
  listeners.push(onChange);
  if (!ASSET) return;
  setTimeout(() => check({ quiet: true }), 8000);
  setInterval(() => check({ quiet: true }), CHECK_EVERY_MS);
}

module.exports = { start, check, download, install, state: () => ({ ...state }), openPage: () => shell.openExternal(state.url) };
