// npm start — VS Code·Claude 터미널은 ELECTRON_RUN_AS_NODE=1을 물려줘서 그대로 띄우면 창이 안 뜬다
const { spawn } = require('child_process');
const path = require('path');
const electron = require('electron'); // electron 패키지는 실행 파일 경로를 돌려준다

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
spawn(electron, [path.join(__dirname, '..')], { env, stdio: 'inherit', detached: true }).unref();
