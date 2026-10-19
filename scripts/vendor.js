// 앱에 넣을 라이브러리를 app/vendor로 복사한다 — 배포판은 인터넷 없이도 돌아야 하므로 (npm install 때 자동 실행)
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'app', 'vendor');
const copy = (from, to) => {
  const src = path.join(root, 'node_modules', from);
  if (!fs.existsSync(src)) { console.warn(`vendor: ${from} 없음 — npm install을 먼저 하세요`); return; }
  fs.cpSync(src, path.join(out, to), { recursive: true });
};

fs.rmSync(out, { recursive: true, force: true });
copy('three/build/three.module.js', 'three/build/three.module.js');
for (const dir of ['controls', 'postprocessing', 'shaders']) copy(`three/examples/jsm/${dir}`, `three/examples/jsm/${dir}`);
copy('three/LICENSE', 'three/LICENSE');
copy('@highlightjs/cdn-assets/highlight.min.js', 'hljs/highlight.min.js');
copy('@highlightjs/cdn-assets/styles/github-dark.min.css', 'hljs/styles/github-dark.min.css');
copy('@highlightjs/cdn-assets/LICENSE', 'hljs/LICENSE');
console.log('vendor: app/vendor 준비 완료');
