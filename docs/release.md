# 릴리스

설치 파일은 GitHub Actions 가 만듭니다 (`.github/workflows/release.yml`). `package.json` 의 version 을 올리고 `v` 로 시작하는 태그를 올리면 Windows · macOS 를 각각 빌드해 그 태그의 Release 에 붙입니다.

```bash
git tag v1.3.2
git push origin v1.3.2
```

- Actions 탭에서 손으로 돌리면(workflow_dispatch) 빌드 · 점검만 하고 Release 는 만들지 않습니다.
- 로컬에서는 `npm run dist:win` / `npm run dist:mac` (결과는 `dist/`).
- macOS 앱은 인증서 없이 애드혹 서명하고, 배포할 zip 을 풀어 서명을 다시 검사합니다.
