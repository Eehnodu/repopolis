#!/usr/bin/env node
// Repopolis 스캐너 — 프로젝트 폴더를 읽어 3D 도시 HTML 한 장을 만든다.
// 사용법: node scan.js <프로젝트 경로> [--out 파일] [--no-open] [--exclude 패턴]
const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

const HELP = `
Repopolis — 코드가 사는 도시

  node scan.js <프로젝트 경로> [옵션]

옵션
  -o, --out <파일>       결과 HTML 경로 (기본: output/<프로젝트명>.html)
  -x, --exclude <패턴>   제외할 경로 패턴, 여러 번 사용 가능 (예: -x "zz_*" -x "*.md")
      --no-open          만든 뒤 브라우저를 열지 않음
      --docs             .md/.txt 같은 문서 파일도 건물로 포함
      --no-source        HTML에 코드 원문을 넣지 않음 (건물 안에서 코드 보기 불가)
  -h, --help             도움말
`;

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', 'coverage',
  '__pycache__', '.venv', 'venv', '.idea', '.vscode', 'target', '.gradle', '.cache', '.turbo',
]);
const SKIP_NAMES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'poetry.lock', 'uv.lock',
  'Cargo.lock', 'composer.lock', 'Gemfile.lock', '.DS_Store',
]);
const SKIP_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.svg', '.avif', '.psd',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.zip', '.gz', '.tar', '.7z', '.rar',
  '.mp3', '.wav', '.ogg', '.mp4', '.mov', '.webm',
  '.pdf', '.exe', '.dll', '.so', '.dylib', '.class', '.jar', '.pyc',
  '.db', '.sqlite', '.map', '.lock', '.pem', '.crt', '.key', '.p12',
]);
const DOC_EXT = new Set(['.md', '.mdx', '.txt', '.rst', '.adoc']); // 기본으로 제외 (--docs로 포함)
const MAX_BYTES = 1024 * 1024;

const LANGS = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript', '.js': 'JavaScript', '.jsx': 'JavaScript',
  '.mjs': 'JavaScript', '.cjs': 'JavaScript', '.py': 'Python', '.java': 'Java', '.kt': 'Kotlin',
  '.go': 'Go', '.rs': 'Rust', '.c': 'C', '.h': 'C', '.cpp': 'C++', '.cc': 'C++', '.hpp': 'C++',
  '.cs': 'C#', '.rb': 'Ruby', '.php': 'PHP', '.swift': 'Swift', '.dart': 'Dart',
  '.vue': 'Vue', '.svelte': 'Svelte', '.css': 'CSS', '.scss': 'CSS', '.sass': 'CSS', '.less': 'CSS',
  '.html': 'HTML', '.md': 'Markdown', '.mdx': 'Markdown', '.json': 'JSON',
  '.yml': 'YAML', '.yaml': 'YAML', '.toml': 'Config', '.ini': 'Config', '.env': 'Config',
  '.sql': 'SQL', '.sh': 'Shell', '.ps1': 'Shell', '.bat': 'Shell', '.txt': 'Text', '.xml': 'XML',
};

// 대략적인 함수 개수 — 정확한 파서가 아니라 건물 넓이를 정하는 용도
const METHOD_RE = /^[ \t]*(?:(?:public|private|protected|static|async|override|get|set|export|default)\s+)*(?!if\b|for\b|while\b|switch\b|catch\b|return\b|else\b|do\b)[A-Za-z_$][\w$]*\s*\([^)\n]*\)\s*(?::\s*[^{\n]+)?\{/gm;
const JS_RE = [/\bfunction\b\s*\*?\s*[\w$]*\s*\(/g, /=>/g, METHOD_RE];
const FN_PATTERNS = {
  TypeScript: JS_RE, JavaScript: JS_RE, Vue: JS_RE, Svelte: JS_RE,
  Python: [/^[ \t]*(?:async\s+)?def\s+\w+/gm],
  Go: [/^func\s/gm], Rust: [/\bfn\s+\w+/g], Kotlin: [/\bfun\s+\w+/g], Swift: [/\bfunc\s+\w+/g],
  Ruby: [/^[ \t]*def\s/gm], PHP: [/\bfunction\b/g],
  Java: [METHOD_RE], 'C#': [METHOD_RE], C: [METHOD_RE], 'C++': [METHOD_RE], Dart: [METHOD_RE],
};

function parseArgs(argv) {
  const opts = { target: null, out: null, open: true, exclude: [], docs: false, source: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-o' || a === '--out') opts.out = argv[++i];
    else if (a === '-x' || a === '--exclude') opts.exclude.push(argv[++i]);
    else if (a === '--no-open') opts.open = false;
    else if (a === '--docs') opts.docs = true;
    else if (a === '--no-source') opts.source = false;
    else if (a === '-h' || a === '--help') { console.log(HELP); process.exit(0); }
    else if (!opts.target) opts.target = a;
    else { console.error(`알 수 없는 인자: ${a}`); process.exit(1); }
  }
  opts.target = path.resolve(opts.target || '.');
  return opts;
}

// "zz_*", "*.md" 같은 간단한 글롭 → 경로 조각 하나라도 맞으면 제외
function globToRegex(glob) {
  const body = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]');
  return glob.includes('/') ? new RegExp(`^${body}(/|$)`) : new RegExp(`(^|/)${body}(/|$)`);
}

function isSkipped(rel, excludes, docs) {
  const parts = rel.split('/');
  if (parts.slice(0, -1).some((p) => SKIP_DIRS.has(p))) return true;
  const name = parts[parts.length - 1];
  if (SKIP_NAMES.has(name) || /\.min\.\w+$/.test(name)) return true;
  const ext = path.extname(name).toLowerCase();
  if (SKIP_EXT.has(ext) || (!docs && DOC_EXT.has(ext))) return true;
  return excludes.some((re) => re.test(rel));
}

function git(args, cwd) {
  return execFileSync('git', ['-c', 'core.quotepath=off', ...args], {
    cwd, encoding: 'utf8', maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'ignore'],
  });
}

function isGitRepo(dir) {
  try { return git(['rev-parse', '--is-inside-work-tree'], dir).trim() === 'true'; } catch { return false; }
}

function listFiles(root, useGit) {
  if (useGit) {
    // 추적 중인 파일 + 아직 커밋 안 한 새 파일 (.gitignore는 존중)
    return git(['ls-files', '-z', '--cached', '--others', '--exclude-standard'], root)
      .split('\0').filter(Boolean);
  }
  const out = [];
  (function walk(dir, rel) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name), r); }
      else if (e.isFile()) out.push(r);
    }
  })(root, '');
  return out;
}

function analyzeFile(abs, rel) {
  let stat;
  try { stat = fs.statSync(abs); } catch { return null; }
  if (!stat.isFile() || stat.size > MAX_BYTES) return null;
  const buf = fs.readFileSync(abs);
  if (buf.subarray(0, 8000).includes(0)) return null; // 바이너리
  const text = buf.toString('utf8');
  let lines = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lines++;
  if (text.length && text[text.length - 1] !== '\n') lines++;
  if (!lines) return null;
  const lang = LANGS[path.extname(rel).toLowerCase()] || 'Other';
  let fn = 0;
  for (const re of FN_PATTERNS[lang] || []) fn += (text.match(re) || []).length;
  return { p: rel, l: lines, fn, b: stat.size, lang, _text: text, _imp: readImports(text, lang) };
}

// import 문 → 나중에 프로젝트 안 파일로 연결 ("연결된 건물")
const JS_IMPORT = /(?:^|[^\w$.])(?:import|export)\s+(?:[^'";]*?\sfrom\s+)?['"]([^'"\n]+)['"]|(?:^|[^\w$.])(?:require|import)\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g;
const PY_FROM = /^[ \t]*from[ \t]+([.\w]+)[ \t]+import[ \t]+(\([^)]*\)|[^\n#]+)/gm;
const PY_IMPORT = /^[ \t]*import[ \t]+([\w.]+(?:[ \t]*,[ \t]*[\w.]+)*)/gm;
function readImports(text, lang) {
  const out = [];
  if (['TypeScript', 'JavaScript', 'Vue', 'Svelte'].includes(lang)) {
    for (const m of text.matchAll(JS_IMPORT)) out.push({ k: 'js', s: m[1] || m[2] });
  } else if (lang === 'Python') {
    for (const m of text.matchAll(PY_FROM)) {
      const names = m[2].replace(/[()\n]/g, ' ').split(',').map((n) => n.trim().split(/\s+/)[0]).filter((n) => /^\w+$/.test(n));
      out.push({ k: 'py', m: m[1], n: names });
    }
    for (const m of text.matchAll(PY_IMPORT)) for (const mod of m[1].split(',')) out.push({ k: 'py', m: mod.trim(), n: [] });
  }
  return out;
}

function resolveDeps(files) {
  const byPath = new Map(files.map((f, i) => [f.p, i]));
  const bySuffix = new Map();
  files.forEach((f, i) => {
    const parts = f.p.split('/');
    for (let k = 0; k < parts.length; k++) {
      const suf = parts.slice(k).join('/');
      if (!bySuffix.has(suf)) bySuffix.set(suf, []);
      bySuffix.get(suf).push(i);
    }
  });
  const top = (p) => p.split('/')[0];
  const JS_EXT = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte', '/index.ts', '/index.tsx', '/index.js', '/index.jsx'];
  const tryJs = (base) => {
    for (const e of JS_EXT) { const i = byPath.get(base + e); if (i !== undefined) return i; }
    return -1;
  };
  files.forEach((f, fi) => {
    const deps = new Set();
    const dir = path.posix.dirname(f.p) === '.' ? '' : path.posix.dirname(f.p);
    for (const im of f._imp) {
      let i = -1;
      if (im.k === 'js') {
        if (im.s.startsWith('.')) i = tryJs(path.posix.normalize(path.posix.join(dir, im.s)));
        else if (/^[@~]\//.test(im.s)) { // @/ 별칭은 보통 가장 가까운 src/
          const m = f.p.match(/^(.*?\bsrc\/)/);
          i = tryJs(path.posix.normalize((m ? m[1] : `${top(f.p)}/src/`) + im.s.slice(2)));
        }
      } else {
        let mod = im.m, base = null;
        if (mod.startsWith('.')) {
          const dots = mod.match(/^\.+/)[0].length, segs = dir ? dir.split('/') : [];
          base = segs.slice(0, Math.max(0, segs.length - (dots - 1))).join('/');
          mod = mod.slice(dots);
        }
        const modPath = mod.replace(/\./g, '/'), cands = [];
        for (const n of im.n) { const full = [modPath, n].filter(Boolean).join('/'); cands.push(`${full}.py`, `${full}/__init__.py`); }
        if (modPath) cands.push(`${modPath}.py`, `${modPath}/__init__.py`);
        for (const c of cands) {
          if (base !== null) { const j = byPath.get(base ? `${base}/${c}` : c); if (j !== undefined) { i = j; break; } }
          else {
            const hits = bySuffix.get(c);
            if (hits) { i = hits.find((h) => top(files[h].p) === top(f.p)) ?? hits[0]; break; }
          }
        }
      }
      if (i >= 0 && i !== fi) deps.add(i);
    }
    f.dep = [...deps];
  });
}

// git 기록 → 커밋 목록 + 파일별 통계 + 타임랩스용 줄 수 추정치
function readHistory(root, fileMap, now) {
  const SEP_REC = '\x1e', SEP_FIELD = '\x1f', SEP_BODY = '\x1d';
  const raw = git([
    'log', '--relative', '--no-renames', '--numstat',
    `--format=${SEP_REC}%H${SEP_FIELD}%at${SEP_FIELD}%an${SEP_FIELD}%s${SEP_FIELD}%b${SEP_BODY}`,
    '--', '.',
  ], root);

  const records = raw.split(SEP_REC).filter((r) => r.trim()).reverse(); // 오래된 순
  const authors = [];
  const authorIdx = new Map();
  const commits = [];
  const estimate = new Map(); // 경로 → 누적 줄 수 추정
  const recentCut = now - 90 * 86400;

  for (const rec of records) {
    const bodyEnd = rec.indexOf(SEP_BODY);
    const [hash, at, an, subject, body] = rec.slice(0, bodyEnd).split(SEP_FIELD);
    const changes = [];
    for (const line of rec.slice(bodyEnd + 1).split('\n')) {
      const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line.trim());
      if (m && m[1] !== '-') changes.push([m[3], +m[1], +m[2]]);
    }
    if (!changes.length) continue; // 머지 커밋 등

    if (!authorIdx.has(an)) { authorIdx.set(an, authors.length); authors.push(an); }
    const ts = +at;
    const claude = /co-authored-by:\s*claude/i.test(body || '') || /^claude\b/i.test(an);
    const ci = commits.length;
    let touched = 0;

    for (const [p, add, del] of changes) {
      const est = Math.max(0, (estimate.get(p) || 0) + add - del);
      estimate.set(p, est);
      const f = fileMap.get(p);
      if (!f) continue;
      touched++;
      f.tl.push(ci, est);
      f.ch++;
      if (ts >= recentCut) f.r90++;
      if (claude) f.cl++;
      f.ft = f.ft || ts;
      f.lt = ts;
      f._au.set(authorIdx.get(an), (f._au.get(authorIdx.get(an)) || 0) + 1);
      f.rc.unshift(ci);
      if (f.rc.length > 6) f.rc.pop();
    }
    commits.push([hash.slice(0, 7), ts, authorIdx.get(an), subject, claude ? 1 : 0, touched, changes.length]);
  }
  return { commits, authors };
}

function openFile(file) {
  const cmd = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  spawn(cmd, [file], { detached: true, stdio: 'ignore' }).unref();
}

// 커밋 안 된 수정/새 파일 → 도시에서 "공사 중"
function readWip(root) {
  const wip = new Set();
  for (const line of git(['status', '--porcelain', '-z', '--untracked-files=all', '--', '.'], root).split('\0')) {
    if (line.length > 3 && !line.startsWith('D') && line[1] !== 'D') wip.add(line.slice(3));
  }
  // status는 저장소 루트 기준 경로를 주므로 하위 폴더를 스캔할 땐 접두사를 뗀다
  const prefix = git(['rev-parse', '--show-prefix'], root).trim();
  return new Set([...wip].map((p) => (prefix && p.startsWith(prefix) ? p.slice(prefix.length) : p)));
}

function buildData(target, { exclude = [], docs = false, source = false, log = () => {} } = {}) {
  target = path.resolve(target);
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) throw new Error(`폴더를 찾을 수 없어요: ${target}`);
  const name = path.basename(target);
  const excludes = exclude.map(globToRegex);
  const useGit = isGitRepo(target);
  const now = Math.floor(Date.now() / 1000);

  log(`🏙️  ${name} 스캔 중...${useGit ? '' : ' (git 저장소가 아니라 기록 없이 진행)'}`);
  const files = [];
  for (const rel of listFiles(target, useGit)) {
    if (isSkipped(rel, excludes, docs)) continue;
    const f = analyzeFile(path.join(target, rel), rel);
    if (f) files.push(Object.assign(f, { ch: 0, r90: 0, cl: 0, ft: 0, lt: 0, rc: [], tl: [], _au: new Map() }));
  }
  if (!files.length) throw new Error('그릴 파일이 없어요.');

  let history = { commits: [], authors: [] };
  if (useGit) {
    log('📜 git 기록 읽는 중...');
    history = readHistory(target, new Map(files.map((f) => [f.p, f])), now);
    const wip = readWip(target);
    for (const f of files) if (wip.has(f.p)) f.wip = 1;
  }
  resolveDeps(files);
  const src = source ? files.map((f) => f._text) : undefined;
  for (const f of files) {
    f.au = [...f._au].sort((a, b) => b[1] - a[1]).slice(0, 3);
    delete f._au; delete f._text; delete f._imp;
  }
  return { name, root: target, generatedAt: now, git: useGit, files, commits: history.commits, authors: history.authors, src };
}

// assets: 앱은 라이브러리를 로컬에서 읽도록 CDN 주소를 바꿔 넣는다 (HTML 한 장으로 쓸 땐 CDN 그대로)
const CDN = { three: 'https://cdn.jsdelivr.net/npm/three@0.160.0/', hljs: 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/' };
function renderHtml(data, { assets } = {}) {
  let template = fs.readFileSync(path.join(__dirname, 'viewer.html'), 'utf8');
  for (const k of Object.keys(CDN)) if (assets?.[k]) template = template.split(CDN[k]).join(assets[k]);
  return template
    .replace(/__CITY_TITLE__/g, () => data.name.replace(/[<&]/g, ''))
    .replace('"__CITY_DATA__"', () => JSON.stringify(data).replace(/</g, '\\u003c')); // 코드 원문 속 </script>가 페이지를 끊지 않게
}

function summary(data) {
  const lines = data.files.reduce((s, f) => s + f.l, 0);
  const wip = data.files.filter((f) => f.wip).length;
  return `건물 ${data.files.length.toLocaleString()}채 · ${lines.toLocaleString()}줄 · 커밋 ${data.commits.length.toLocaleString()}개${wip ? ` · 공사 중 ${wip}곳` : ''}`;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  let data;
  try {
    data = buildData(opts.target, { exclude: opts.exclude, docs: opts.docs, source: opts.source, log: console.log });
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  const out = path.resolve(opts.out || path.join(__dirname, 'output', `${data.name.replace(/[^\w.-]+/g, '_')}.html`));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, renderHtml(data));
  console.log(`✅ ${summary(data)}`);
  console.log(`   → ${out}`);
  if (opts.open) openFile(out);
}

module.exports = { buildData, renderHtml, summary };
if (require.main === module) main();
