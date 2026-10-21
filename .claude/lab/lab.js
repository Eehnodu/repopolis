// Repopolis 실험실 — 도시 HTML 을 화면 밖(offscreen) Electron 으로 열어 재고 JSON 으로 낸다.
// 화면 밖이라 사용자 창에 가려져도 1fps 로 떨어지지 않는다. 대신 프레임이 실제 창보다 느리므로
// fps 는 "같은 조건 전후 비교"에만 쓰고, 멈칫(긴 프레임) · 움직임 숫자 · 오류를 본다.
//
//   npx electron .claude/lab/lab.js <city.html> <mode> [out.json]
//   mode: feel  — 걷기 · 달리기 · 점프 · 돌기 · 멈추기 · 차에 치임을 매 프레임 기록
//         play  — 켜지는 시간 · 기준 fps · 동작별 멈칫 · 걷기 막힘 · 건물 들어갔다 나오기 · 콘솔 오류
//         shot  — 낮 · 밤 · 걷기 · 건물 안 사진 (out 은 폴더)
//
// 페이지는 #debug 로 열어 window.__rp(renderer · camera · walk · props · mode …)를 쓴다.
// #debug 는 셰이더 오류 검사를 켜므로(멈칫이 커진다) 재기 전에 끈다.
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), path = require('path'), { pathToFileURL } = require('url');

const [file, mode = 'play', out] = process.argv.slice(2).filter((a) => !a.startsWith('--') && !a.endsWith('lab.js'));
const W = 1280, H = 760;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');

app.whenReady().then(async () => {
  const w = new BrowserWindow({ width: W, height: H, show: false, webPreferences: { backgroundThrottling: false, offscreen: true } });
  w.webContents.setFrameRate(60);
  const errors = [];
  w.webContents.on('console-message', (e) => { if (e.level === 'error' || /Uncaught|UNHANDLED/.test(e.message)) errors.push(e.message.split('\n')[0].slice(0, 200)); });
  w.webContents.on('render-process-gone', (_, d) => errors.push(`CRASH ${d.reason}`));
  const js = (c) => w.webContents.executeJavaScript(c).catch((e) => { errors.push(`[lab] ${e.message.slice(0, 120)}`); return null; });
  const key = (code, down) => w.webContents.sendInputEvent({ type: down ? 'keyDown' : 'keyUp', keyCode: code });
  const tap = async (code, hold = 60) => { key(code, true); await wait(hold); key(code, false); };
  const result = { file: path.basename(file), mode, errors };
  const done = () => { const s = JSON.stringify(result, null, 1); if (out && mode !== 'shot') fs.writeFileSync(out, s); console.log(s); app.quit(); };
  setTimeout(() => { result.timeout = true; done(); }, 150000);

  // 켜지는 시간: 불러오기 시작 → __rp 가 생기고 첫 프레임이 돈 때
  const t0 = Date.now();
  await w.loadURL(`${pathToFileURL(path.resolve(file)).href}?v=${Date.now()}#sky=day&debug`);
  for (let i = 0; i < 200 && !(await js('!!window.__rp && __rp.renderer.info.render.frame > 2')); i++) await wait(100);
  result.loadMs = Date.now() - t0;
  await js("addEventListener('unhandledrejection', (e) => console.error('UNHANDLED ' + (e.reason && (e.reason.stack || e.reason))))");
  await js('__rp.renderer.debug.checkShaderErrors = false');
  await wait(4000); // 처음 짓는 연출 · 셰이더 미리 만들기가 끝나게
  // 화면 밖 창은 첫 키 입력 한 번이 200~300ms 걸린다 (실제 창에선 없음). 아무 일 없는 키로 미리 한 번 — 안 그러면 첫 동작이 멈칫한 것처럼 잰다
  await tap('F24'); await wait(600);
  // 프레임 기록기: 간격 + 주인공 · 카메라 상태
  await js(`(() => { const r = window.__lab = { f: [], on: true }; let last = performance.now();
    const loop = (t) => { const W = __rp.walk, c = __rp.camera.position;
      r.f.push([t, t - last, W.pos.x, W.pos.y, W.pos.z, W.jy, W.vy || 0, W.v || 0, W.heading, c.x, c.y, c.z, W.knock || 0, W.tumble || 0, W.scale]);
      if (r.f.length > 20000) r.f.splice(0, 10000);
      last = t; requestAnimationFrame(loop); }; requestAnimationFrame(loop); })()`);
  const now = () => js('performance.now()');
  const frames = (from, to = 1e12) => js(`__lab.f.filter(([t]) => t >= ${from} && t <= ${to})`);
  const hitch = (fr) => { const d = fr.map((x) => x[1]).slice(1).sort((a, b) => b - a); return { maxMs: Math.round(d[0] || 0), over100: d.filter((x) => x > 100).length, p50: Math.round(d[d.length >> 1] || 0) }; };
  const step = async (name, fn, after = 1200) => { const a = await now(); await fn(); await wait(after); return [name, hitch(await frames(a))]; };
  const startWalk = async () => { await js("document.querySelector('#walkBtn').click()"); for (let i = 0; i < 40 && !(await js('__rp.ready')); i++) await wait(200); await wait(400); };

  if (mode === 'feel') {
    await startWalk();
    const seg = async (name, fn) => { const a = await now(); await fn(); result[name] = await frames(a); };
    await seg('jump', async () => { await tap('Space'); await wait(1300); });
    await seg('walk', async () => { key('W', true); await wait(2500); key('W', false); await wait(1500); });
    await seg('run', async () => { key('W', true); key('Shift', true); await wait(3000); key('Shift', false); key('W', false); await wait(1800); });
    await seg('turn', async () => { key('A', true); await wait(1500); key('A', false); await wait(600); });
    await seg('runJump', async () => { key('W', true); key('Shift', true); await wait(1500); await tap('Space'); await wait(1200); key('Shift', false); key('W', false); await wait(1200); });
    // 차에 치인 것처럼 (hitByCars 와 같은 식): 옆으로 날아가며 구른다
    await seg('knock', async () => {
      await js(`(() => { const W = __rp.walk, H = W.scale, sp = 3; W.kx = Math.cos(W.heading) * 1.6; W.kz = -Math.sin(W.heading) * 1.6;
        W.vy = (3.5 + sp * 0.6) * H; W.jy = Math.max(W.jy, 0.01); W.knock = 1.1; W.knockCool = 0.8; W.v = 0; W.tumbleDir = 1; })()`);
      await wait(2500);
    });
    result.columns = ['t', 'dt', 'x', 'y', 'z', 'jy', 'vy', 'v', 'heading', 'camX', 'camY', 'camZ', 'knock', 'tumble', 'H'];
    return done();
  }

  if (mode === 'shot') {
    fs.mkdirSync(out, { recursive: true });
    const shot = async (name) => fs.writeFileSync(path.join(out, `${name}.png`), (await w.webContents.capturePage()).toPNG());
    await shot('day');
    await tap('N'); await wait(3000); await shot('night'); // 하늘은 자동 → 낮 → 밤 → 자동 순. #sky=day 에서 한 번이면 밤
    await tap('N'); await wait(1200); await tap('N'); await wait(2500); // 밤 → 자동 → 낮
    await startWalk(); await wait(1000); await shot('walk');
    key('W', true); await wait(2000); key('W', false); await wait(800); await shot('walk2');
    await tap('Escape'); await wait(2500);
    await js("document.querySelector('#hot li')?.click()"); await wait(2000);
    await js("document.querySelector('[data-act=enter]')?.click()"); await wait(4500); await shot('inside');
    result.shots = fs.readdirSync(out);
    return done();
  }

  // play
  result.city = await js(`({ buildings: document.querySelector('#stats')?.textContent, calls: __rp.renderer.info.render.calls, tris: __rp.renderer.info.render.triangles, programs: __rp.renderer.info.programs.length })`);
  const steps = [];
  steps.push(await step('둘러보기 (기준)', () => wait(2500)));
  steps.push(await step('밤으로', () => tap('N'), 3000));
  steps.push(await step('낮으로', async () => { await tap('N'); await wait(1200); await tap('N'); }, 2500));
  steps.push(await step('건물 고르기', () => js("document.querySelector('#hot li')?.click()"), 2000));
  steps.push(await step('걷기 시작', startWalk, 800));
  // 막힘: 4초 걷고 → 왼쪽으로 돌며 3초 → 달리기 3초. 움직인 거리가 작으면 갇힌 것
  const p0 = await js('[__rp.walk.pos.x, __rp.walk.pos.z]'), tw0 = await now();
  steps.push(await step('걷기 4초', async () => { key('W', true); await wait(4000); }, 0));
  steps.push(await step('돌며 걷기', async () => { key('A', true); await wait(3000); key('A', false); }, 0));
  steps.push(await step('달리며 점프', async () => { key('Shift', true); for (let i = 0; i < 4; i++) { await tap('Space'); await wait(700); } key('Shift', false); key('W', false); }, 600));
  const p1 = await js('[__rp.walk.pos.x, __rp.walk.pos.z]');
  // 걸은 길이(프레임마다 위치 차이의 합) — 돌며 걷기는 제자리로 돌아오므로 출발점과의 거리로는 갇힘을 못 가린다
  const wf = await frames(tw0);
  let walked = 0; for (let i = 1; i < wf.length; i++) walked += Math.hypot(wf[i][2] - wf[i - 1][2], wf[i][4] - wf[i - 1][4]);
  result.walk = { movedM: +walked.toFixed(1), netM: p0 && p1 ? +Math.hypot(p1[0] - p0[0], p1[1] - p0[1]).toFixed(1) : null };
  steps.push(await step('걷기 끝', () => tap('Escape'), 2500));
  steps.push(await step('들어가기', async () => { await js("document.querySelector('#hot li')?.click()"); await wait(1500); await js("document.querySelector('[data-act=enter]')?.click()"); }, 4000));
  result.inside = await js('__rp.mode');
  steps.push(await step('안에서 걷기', async () => { key('W', true); await wait(1500); await tap('Space'); await wait(600); key('W', false); }, 600));
  steps.push(await step('나가기', () => tap('Escape'), 3500));
  result.after = await js('__rp.mode');
  result.steps = Object.fromEntries(steps);
  done();
});
