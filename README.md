<p align="center">
  <img src="build/icon.png" width="96" alt="Repopolis 아이콘">
</p>

<h1 align="center">Repopolis</h1>

<p align="center">
  프로젝트 폴더를 <b>살아 움직이는 3D 도시</b>로 보여 주는 데스크톱 앱.<br>
  파일은 건물, 폴더는 구역, 커밋은 자동차 — 커밋하면 건물이 올라갑니다.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Windows-10%20%C2%B7%2011-0078d4" alt="Windows">
  <img src="https://img.shields.io/badge/macOS-Apple%20silicon%20%C2%B7%20Intel-000000" alt="macOS">
  <img src="https://img.shields.io/badge/Electron-38-47848f" alt="Electron">
  <a href="LICENSE"><img src="https://img.shields.io/badge/%EB%9D%BC%EC%9D%B4%EC%84%A0%EC%8A%A4-MIT-16a34a" alt="MIT"></a>
</p>

<p align="center">
  <img src="assets/city.png" alt="도시 전경">
</p>

## 시작하기

1. [Releases](https://github.com/Eehnodu/repopolis/releases/latest) 에서 내 컴퓨터용 파일을 받아 실행합니다 ([설치](#설치))
2. 프로젝트 폴더를 고르거나 창에 끌어다 놓으면 도시가 지어집니다
3. 🚶 **걸어보기** 로 내려가 걷다가, 건물 앞에서 `E` 를 누르면 그 파일 안으로 들어갑니다

## 도시 읽는 법

| 도시 | 코드 |
|---|---|
| 건물 종류 · 층수 | 줄 수 — 🏠 ~80 · 🏘️ ~250 · 🏢 ~600 · 🏬 ~1200 · 🏙️ 그 이상 |
| 건물 폭 | 함수 개수 (조금) |
| 큰길 / 골목 / 블록 | 최상위 폴더 / 2단 폴더 / 더 깊은 폴더 |
| 🚗 자동차 | 커밋 수 (√커밋 × 3.4 대, 12~110 대 · 길 길이만큼까지) |
| 🚶 사람 | 파일 수 (파일 ÷ 4 명, 12~200 명) |
| 🏗️ 크레인 · 주황 땅 | 커밋 안 된 변경 (공사 중) |
| 👷 인부 | 바뀐 줄 수 (1~4명) — 3분 안에 저장했으면 망치질, 오래 두었으면 앉아서 쉬기 |

## 기능

### 보기

- **🎬 타임랩스** — 첫 커밋부터 도시가 지어지는 과정을 재생. 바뀐 건물은 노랗게 번쩍입니다
- **🎨 색칠 기준** — 도시 풍경(기본) · 수정 빈도 · 최근 수정 · 언어 · 🤖 Claude 커밋 비율 · 👤 주인 · 🐞 버그 수정
- **🔗 관계** — 건물을 고르면 **함께 바뀌는 파일**(같은 커밋에 자주 같이 들어감)과 **쓰는 곳 · 쓰이는 곳**(import)으로 아치가 뻗습니다. import 없이 함께 바뀌면 **숨은 의존**
- **👥 소유 · 버스 팩터** — 파일마다 주인 · 지분 · 손댄 사람 수 · 최근 90일 변경량, 구역마다 버스 팩터(몇 명이 빠지면 절반 넘는 파일이 주인을 잃는지)
- **🚨 재개발 후보** — 길고 자주 고친 파일(`줄 수 × log(커밋 수)`) 상위 목록
- **🌗 낮 · 밤** — 실제 시간을 따라가고(17:30~19:00 노을, 밤엔 창문 · 가로등 · 헤드라이트) `N` 으로 고정
- **🔍 찾기 · 📸 저장** — `/` 로 파일 검색, 건물 클릭 → 상세 정보 · 파일 열기, 지금 화면을 PNG 로

### 걷기 · 놀기

- **🚶 걸어보기** — 곰귀 후드를 쓴 꼬마가 되어 보도에서 출발합니다. 1인칭 · 3인칭, 건물과 부딪히고 가까운 건물에 `E` 로 들어갑니다
- **🎮 놀거리** — `Space` 점프로 벤치 · 휴지통 · 소화전 · 화분 위에 올라서기, `C` 로 가까운 벤치 · 의자 · 소파에 앉기. 달리는 차에 뛰어들면 공중제비를 돌며 날아가고, 길에 가만히 서 있으면 차가 기다려 줍니다
- **🚪 건물 안** — 층마다 걸어 다니는 사무실. 함수는 모니터 책상, 클래스는 유리 회의실, 컴포넌트는 진열장, 메서드는 노트북 원탁, 타입은 설계도 액자, 스타일은 색 견본판 — 다가가 `E` 를 누르면 옆에 그 코드가 뜹니다. 엘리베이터 · 계단 · 1층 안내 데스크
- **🚦 거리** — 신호등 · 횡단보도를 지키는 차, 보도로 다니다 초록불에 건너는 사람, 밤이 깊으면 건물로 들어가는 사람들, 새 떼와 고양이

<p align="center">
  <img src="assets/walk.png" width="49%" alt="걸어보기">
  <img src="assets/inside.png" width="49%" alt="건물 안에서 코드 보기">
</p>

### 실시간

- **🎉 준공** — 커밋하면(Claude Code 자동 커밋 포함) 1~2초 뒤 바뀐 건물이 자라고, 공사가 끝난 건물에선 인부들이 박수 치며 크레인이 접혀 내려갑니다
- **🏗️ 공사** — 파일을 저장하면 1~2초 안에 건물 크기가 바뀌고 크레인 · 인부가 섭니다 (저장된 파일 기준, 12초마다 한 번 더 확인)
- **👷 인부에게 묻기** — 걷다가 인부 옆에서 `E`(또는 건물 정보의 "바뀐 내용 보기") — 그 파일의 커밋 안 된 변경(diff)이 뜹니다. 건물 안에선 바뀐 줄이 있는 층 벽에 공사 테이프가 둘리고 엘리베이터에 🏗️ 가 붙습니다
- **⚡ 끊김 없이** — 있던 파일을 고치기만 했으면 화면을 다시 불러오지 않고 그 자리에서 바뀝니다. 새 파일 · 커밋으로 배치가 바뀔 때만 다시 짓고, 그때도 보던 화면 · 걷던 자리 · 열어 둔 코드는 그대로
- **🔔 트레이 · 알림** — 시계 옆(맥은 메뉴 막대) 아이콘을 누르면 **공사 현황 팝업**(공사 중인 파일 · 최근 준공). 창을 닫아도 트레이에서 지켜보다 "🎉 준공!" · "🏗️ 공사 시작" 알림을 띄웁니다

<p align="center">
  <img src="assets/tray.png" width="280" alt="트레이 공사 현황 팝업"><br>
  <sub>트레이 아이콘을 누르면 뜨는 공사 현황 팝업</sub>
</p>

### 설정

- 🎵 배경음악 · 🔔 효과음 · 🐦 주변 소리를 각각 켜고 끄고 음량 조절 (소리는 파일 없이 그 자리에서 만듭니다)
- 버튼 · 글자 크기 (자동이면 창 크기에 맞춰 줄어듦), 앱에서는 창 크기 · 알림 · 공사 현황 창 · 업데이트 확인

## 조작

| 어디서 | 키 · 마우스 | 하는 일 |
|---|---|---|
| 하늘 | 드래그 · 우클릭 드래그 · 휠 | 회전 · 이동 · 확대 |
| | 클릭 / 더블클릭 | 건물 정보 / 들어가기 |
| | `/` · `Space` · `N` · `L` · `Esc` | 검색 · 타임랩스 · 낮밤 · 폴더 이름표 · 선택 해제 |
| 걸을 때 | `W` `S` · `A` `D` (방향키) | 앞뒤 · 몸 돌리기 |
| | `Shift` · `Space` · `C` | 달리기 · 점프 · 앉기 |
| | 드래그 / 우클릭 드래그 | 몸 돌리기 · 시선 / 캐릭터 주위 둘러보기 |
| | 휠 · `V` | 카메라 거리 (끝까지 당기면 1인칭) · 1인칭 / 3인칭 |
| | `E` · `Esc` | 건물 들어가기 · 하늘로 |
| 건물 안 | `E` | 코드 보기 · 엘리베이터 · 계단 · 안내 데스크 · 출입문 |
| | `Esc` | 열린 패널 닫기 → 다 닫혀 있으면 밖으로 |
| 트레이 | 클릭 · 더블클릭 · 오른쪽 클릭 | 공사 현황 팝업 · 도시 창 · 메뉴(알림 · 끝내기) |

## 설치

| 컴퓨터 | 파일 |
|---|---|
| Windows (64비트) | `Repopolis-windows.exe` — 설치 없이 바로 실행 |
| Mac (Apple silicon) | `Repopolis-macos-arm64.zip` |
| Mac (Intel) | `Repopolis-macos-x64.zip` |

- **Windows** — 더블클릭. "Windows의 PC 보호" 창이 뜨면 **추가 정보 → 실행** (서명하지 않은 개인 앱이라서)
- **Mac** — zip 을 풀어 `Repopolis` 를 **응용 프로그램** 폴더로 옮기고 더블클릭. 처음 한 번 막히면 **시스템 설정 → 개인정보 보호 및 보안 → 그래도 열기**

다음부터는 마지막 프로젝트가 바로 열리고, 위쪽 `📂 프로젝트` 로 바꿉니다. 창의 ✕ 를 눌러도 트레이로 내려가 계속 지켜봅니다 — 완전히 끄려면 트레이 아이콘 오른쪽 클릭 → **끝내기**.

### 새 버전 받기

1.2.0 부터는 앱이 새 버전을 알려 줍니다. 켜고 조금 뒤와 6시간마다 GitHub 최신 Release 를 확인하고(로그인 없음), 받을지 · 다시 시작할지 한 번씩 물어본 뒤 실행 파일을 바꿔 다시 켭니다. 위쪽 ⬆️ 버튼 · 트레이 메뉴 · 설정 > 앱 > 업데이트 에서도 할 수 있습니다.

## 알아 둘 것

- 커밋 · 타임랩스 · 크레인 · 실시간 반영은 **git** 이 깔려 있고 git 저장소일 때만 나옵니다. git 저장소가 아닌 폴더도 도시는 지어집니다
- `.gitignore` 를 따르고, 커밋 안 한 새 파일도 포함합니다. 빼는 것: `node_modules` · 빌드 결과 · lock 파일 · 이미지 같은 바이너리 · 인증서 · `.env` 같은 비밀 설정(`.env.example` 은 둠) · 1MB 넘는 파일 · `.md` `.txt` 같은 문서 · 심볼릭 링크
- 편집기에만 있고 저장 안 한 내용은 반영되지 않습니다
- 남의 저장소도 안전하게: `.git/config` 에 명령을 실행하는 설정(fsmonitor · filter · textconv · include 등)이 있으면 git 기록 없이 짓고, "파일 열기"는 VS Code 로 — 없으면 실행될 수 있는 파일은 폴더에서 보여 주기만 합니다
- 타임랩스의 과거 줄 수는 `git log --numstat` 누적치로 추정합니다. 이름이 바뀐 파일은 그때 새로 생긴 것으로, 지워진 파일은 안 나옵니다
- 앱은 three.js · highlight.js 를 안에 담고 있어 인터넷 없이 돕니다 (브라우저용 HTML 은 CDN 에서 받음)

## 개발

Node.js 22 기준.

```bash
npm install     # postinstall 이 three.js · highlight.js 를 app/vendor 로 복사
npm start       # 앱 실행
```

### 브라우저용 HTML 한 장 (scan.js)

```bash
node scan.js <프로젝트 경로>                  # → output/<이름>.html 을 만들고 브라우저로 연다
node scan.js ../game -x "zz_*" -x "*.test.ts"  # 패턴 제외 (여러 번 가능)
node scan.js ../game -o city.html --no-open
node scan.js ../game --docs                    # 문서 파일도 건물로
node scan.js ../game --no-source               # 코드 원문을 넣지 않음 (건물 안 코드 보기 불가)
```

주소 뒤에 `#mode=claude&time=120&select=gamePage&sky=night` 처럼 붙이면 그 화면으로 바로 열고, `#debug` 를 붙이면 점검용 `window.__rp` 가 생깁니다.

### 점검

```bash
npx electron .claude/lab/lab.js output/game.html play out.json   # 켜지는 시간 · 동작별 멈칫 · 걷기 막힘 · 오류
npx electron .claude/lab/lab.js output/game.html feel out.json   # 걷기 · 점프 · 차에 치임을 매 프레임
npx electron .claude/lab/lab.js output/game.html shot shots/     # 낮 · 밤 · 걷기 · 건물 안 사진
```

Claude Code 에서는 `/playtest` (여러 저장소에서 재기) · `/feel` (손맛) · `/game-art` (모양) · `/game-review` (설계 검토) 가 이걸 써서 재고 보고합니다.

### 구조

```
scan.js            폴더 + git 기록 → 도시 데이터 · HTML (CLI 겸 모듈)
viewer.html        3D 도시 (three.js) — 브라우저와 앱이 같이 씀
app/main.js        Electron 앱: 프로젝트 열기 · 실시간 감시(.git/logs/HEAD · 폴더 감시 + git status · diff 줄 수, 12초마다 한 번 더)
                   · 인부에게 묻기(git diff)
                   · 고치기만 했으면 열린 화면에 새 데이터만 보내기 · 트레이 · 팝업 · 알림 · 창 크기
app/updater.js     새 버전 확인 · 받기 · 실행 파일 바꾸기
app/preload.js     화면 ↔ 앱 다리 (앱 화면에서 온 요청만 받음)
app/scan-worker.js 스캔을 별도 스레드에서 (창이 멈추지 않게)
app/start.js       npm start — 터미널이 물려준 ELECTRON_RUN_AS_NODE 를 빼고 띄움
app/launcher.html  시작 화면 (최근 프로젝트)
.claude/skills     점검 스킬 (/playtest · /feel · /game-art · /game-review)
.claude/lab/lab.js 스킬이 같이 쓰는 실험실 (화면 밖 Electron 으로 재기 · 사진)
scripts/vendor.js  라이브러리를 app/vendor 로 복사
build/icon.png     앱 아이콘 (1024px)
```

### 빌드 · 배포

설치 파일은 **GitHub Actions** 가 만듭니다 (`.github/workflows/release.yml`). `package.json` 의 version 을 올리고 태그를 올리면 Windows · macOS 가 각각 빌드해 그 태그의 Release 에 붙입니다.

```bash
git tag v1.2.4
git push origin v1.2.4
```

Actions 탭에서 손으로 돌리면 빌드 · 점검만 하고 Release 는 만들지 않습니다. 로컬에서는 `npm run dist:win` / `npm run dist:mac` (결과는 `dist/`).

## 라이선스

MIT. 앱에 담긴 three.js(MIT) · highlight.js(BSD-3-Clause)는 각자의 라이선스를 따릅니다.
