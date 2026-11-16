# Pino Workbench

Windows와 macOS를 위한 로컬 개발 워크스페이스입니다. 사용자가 설정한 MCP 서버에서 Jira·Confluence 맥락을 가져와 로컬 개발에 사용할 Markdown을 만듭니다. Pino 계정이나 별도 클라우드 백엔드는 없습니다.

[GitHub](https://github.com/pinomaker-hoo/pino-workbench) · MIT License · Early prototype

## 실행

Node.js 22 이상과 Git이 필요합니다.

```sh
npm install
npm run dev
```

```sh
npm test
npm run build
npm run test:desktop
npm run package
```

`npm run package`는 현재 OS용 설치 파일을 `release/`에 생성합니다. Windows NSIS는 Windows에서, macOS DMG는 macOS에서 빌드하세요. 배포 서명·notarization·자동 업데이트는 아직 설정하지 않았습니다.

## 사용자별 연결 설정

**서비스 연결**에서 Jira, Confluence, GitHub, Notion, Google, Claude, Codex를 각각 설정합니다. 이 채팅이나 다른 앱의 인증을 공유하거나 가져오지 않습니다.

### 서비스 MCP

1. **stdio**는 로컬 실행 파일과 JSON 명령 인자 배열을 지정합니다. **Streamable HTTP**는 MCP 주소를 지정합니다. HTTPS 및 localhost HTTP를 지원합니다.
2. 인증 헤더 또는 환경 변수는 별도 JSON 입력란에 입력합니다. HTTP 예: `{"Authorization":"Bearer YOUR_TOKEN"}`. stdio는 해당 MCP 서버에서 요구하는 환경 변수 이름을 사용하세요.
3. **로컬에 저장**합니다. 저장만으로 프로세스 실행이나 네트워크 연결이 발생하지 않습니다.
4. **연결 테스트**를 누르면 설정한 프로세스를 실행하거나 서버에 접속하여 도구 목록과 입력 스키마를 조회합니다. 각 요청 후 연결/프로세스를 닫습니다.
5. Jira·Confluence는 읽기 전용 검색 도구 이름, 인자 템플릿, 응답 배열 경로를 설정합니다. 이후 업무 화면의 검색 버튼으로 호출합니다.

예를 들어 서버가 `jira_search` 도구에 `jql`을 받으며 `{"issues":[...]}`를 반환한다면:

```json
{
  "tool": "jira_search",
  "arguments": { "jql": "{{query}}" },
  "resultPath": "issues"
}
```

`{{query}}`는 UI의 검색어/JQL로 치환합니다. 서버별 이름·필수 인자·응답 형식은 다르므로 도구 목록의 스키마를 확인하세요. 배열 경로는 `data.issues`처럼 점으로 구분하며 루트 배열은 빈칸입니다. `structuredContent` 또는 JSON 텍스트 응답을 지원하고 최대 50개를 표시합니다. 임의 자연어 결과는 자동 해석하지 않습니다.

Jira는 `key`, `title` 또는 `summary`(혹은 `fields.summary`), 상태·담당자·설명 등의 일반적인 형식을 지원합니다. Confluence는 `id`, `title`, `text` 또는 `content` 등을 읽습니다. 결과의 `url`이 없으면 설정한 원문 기본 주소로 링크를 만듭니다. 검색 결과에 본문이 없으면 별도 문서 상세 조회는 아직 하지 않습니다. 문서 HTML은 실행하지 않고 텍스트로 표시합니다.

GitHub·Notion·Google은 현재 연결 저장과 MCP 도구 조회까지 제공합니다. 업무 화면의 데이터 연동은 후속 구현입니다. HTTP 브라우저 OAuth, 기존 SSE, 인증 자동 갱신은 아직 지원하지 않습니다. 직접 발급받은 헤더 토큰 또는 사용자 인증을 처리하는 로컬 MCP 서버를 사용하세요.

### AI 설정

Claude·Codex는 로컬 CLI 명령, 인자, 환경 변수를 저장합니다. 로그인은 사용자가 설치한 해당 CLI에서 직접 진행하며 자격 증명은 CLI가 로컬에서 관리합니다. Pino는 그 로그인 정보를 복사하지 않습니다. 현재는 설정 저장까지 구현되어 있고 AI 실행·내장 터미널은 아직 없습니다.

### 로컬 저장과 삭제

- 설정 전체는 Electron `app.getPath('userData')/connections.enc`에 OS `safeStorage`로 암호화하여 저장합니다. 실제 경로를 설정 화면에 표시합니다.
- 일반 설정과 비밀 값을 함께 암호화합니다. 저장된 비밀 값은 UI로 반환하지 않고 키 이름만 표시합니다.
- 인증 입력란의 빈칸은 기존 값 유지, `{}`는 전체 삭제, 새 객체는 전체 교체입니다.
- 서버 주소·실행 명령·인자를 변경하면 기존 비밀 값을 자동 전달하지 않고 재입력을 요구합니다.
- **이 서비스 설정 및 인증 삭제**는 해당 서비스의 Pino 설정과 비밀 값을 삭제합니다. 외부 서비스의 토큰 폐기나 CLI 로그아웃을 대신하지 않습니다.
- 쓰기는 순차 처리하며 임시 파일 후 교체합니다. 복호화 실패 시 기존 파일을 덮어쓰지 않습니다.
- 이전 프로토타입의 `atlassian.enc`는 새 연결 설정을 처음 저장할 때 삭제합니다. 기존 REST 인증은 더 이상 사용하지 않습니다.
- 작업 맥락은 사용자가 선택한 로컬 Markdown 파일에 저장됩니다. 이 내보낸 파일은 평문입니다.

원격 MCP/AI 서비스를 사용하면 해당 기능에 필요한 데이터는 사용자가 지정한 서비스로 전달됩니다. “로컬 앱”은 모든 외부 서비스가 오프라인으로 동작한다는 뜻은 아닙니다.

## API 시나리오 실행 및 파일 공유

왼쪽 **API 시나리오**에서 실제 HTTP 요청 흐름을 작성합니다. **현재 이슈** 버튼으로 선택한 Jira 이슈 키를 연결할 수 있습니다. 이슈 키는 공유 파일에도 포함되며 Jira 자체를 수정하지 않습니다.

1. 시나리오 이름과 요청 이름, 메서드, URL, 헤더(JSON), 본문을 입력합니다.
2. **이 컴퓨터의 변수**에 `{"baseUrl":"http://localhost:3000","password":"..."}` 같은 로컬 값을 저장합니다. `{{baseUrl}}`, `{{password}}`로 참조합니다. 빈 입력은 기존 값 유지, `{}`는 전체 삭제입니다.
3. **응답 → 변수**에 `{"token":"token","userId":"user.id"}`를 설정하면 JSON 응답에서 값을 추출해 다음 요청에서 `{{token}}`, `{{userId}}`로 사용합니다.
4. 예상 상태 코드와 선택적인 JSON 검증 `[{"path":"ok","equals":true}]`를 지정합니다. JSON 경로는 `data.id`, `users.0.id` 형식입니다.
5. **전체 실행**은 현재 편집 내용을 저장하고 실제 서버에 순서대로 요청합니다. 첫 오류/검증 실패에서 중단합니다. 실행 중단은 이미 처리된 서버 변경을 되돌리지 않습니다.
6. **공유 파일**로 Pino JSON을 저장해 동료에게 전달하거나 Git 저장소에 추가할 수 있습니다. **가져오기**는 새로운 ID와 빈 로컬 변수로 저장하며 요청을 자동 실행하지 않습니다. 동료는 자신의 환경·인증 변수를 입력한 뒤 실행합니다.

공유 파일에는 요청 정의(직접 입력한 URL·헤더·본문·예상 값 포함)와 이슈 키만 들어갑니다. 로컬 변수, 추출한 런타임 변수, 실행 결과는 제외합니다. 따라서 인증 값은 요청 정의에 직접 쓰지 않고 **로컬 변수**로 관리하세요. 공유 전에 요청 정의에 포함된 데이터도 확인해야 합니다. 실행 결과에서 알려진 로컬/추출 변수의 문자열 값은 가리지만 응답의 모든 민감한 데이터를 자동 판별하는 기능은 아닙니다.

시나리오와 로컬 변수는 `userData/api-scenarios.enc`에 OS 암호화로 저장합니다. 실행 결과는 화면에서만 유지합니다. HTTP/HTTPS, GET/POST/PUT/PATCH/DELETE/HEAD를 지원하고 요청당 15초·응답 1MB·시나리오당 30개 요청으로 제한합니다. 리디렉션은 자동으로 따라가지 않습니다. 저장과 가져오기는 네트워크 요청을 하지 않습니다.

현재 공유는 **Pino JSON 파일 방식**입니다. Postman Collection 가져오기/내보내기, 환경별 프로필, 스크립트, multipart 파일 업로드, 쿠키 세션, 클라이언트 인증서, 팀 실시간 동기화는 지원하지 않습니다. CI 자동 실행용 CLI 및 실행 결과 공유도 후속 범위입니다.

## 기술 구조

Electron + React + TypeScript + Vite, 공식 MCP TypeScript SDK, Zod, electron-builder를 사용합니다.

- `electron/profiles.ts`: 검증·암호화 설정 저장소
- `electron/mcp.ts`: MCP 연결·도구 발견·검색·응답 변환
- `electron/api-scenarios.ts`: API 시나리오 암호화 저장·순차 실행·검증·공유 형식
- `electron/api-ipc.ts`: 파일 가져오기/내보내기와 실행 IPC
- `src/api-workspace.tsx`: API 시나리오 편집·실행 결과 UI
- `electron/main.ts`: 데스크톱과 제한된 IPC, Git 저장소 선택, 맥락 내보내기
- `src/settings.tsx`: 서비스별 로컬 설정
- `src/main.tsx`: 이슈·문서·작업 맥락 화면

렌더러는 sandbox/context isolation을 사용하며 Node.js에 접근하지 않습니다. MCP 명령은 사용자가 지정하고 연결 테스트 또는 검색 시 실행합니다. 오류에 인증 값이 노출되지 않도록 MCP 서버/프로세스 원문 오류를 UI로 전달하지 않습니다.

## 검증 및 남은 범위

타입 검사·프로덕션 빌드, 테스트 14개(저장·복원·비밀 값 비노출·삭제, 실제 stdio MCP 검색, localhost HTTP 인증 전달 등), macOS Electron UI 스모크 테스트(암호화 저장·MCP 검색·재시작 복원·삭제)를 통과했습니다. API 데스크톱 테스트에서도 시나리오 작성·실제 순차 요청·암호화 저장·공유 파일·가져오기·재시작 복원을 확인했습니다. 실제 회사 MCP 서버 및 Windows 실행은 별도 검증이 필요합니다. Windows/macOS CI가 포함되어 있습니다.

AI 실행·worktree·내장 터미널·GitHub PR 생성·프로젝트 영속화·OAuth는 후속 범위입니다. 현재 프로젝트/문서 선택은 실행 중에만 유지됩니다. 배포 의존성 electron-builder 계열에는 minimatch 관련 중간 심각도 경고 6개가 남아 있습니다.

[MCP 공식 클라이언트 문서](https://ts.sdk.modelcontextprotocol.io/client) · [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)

## License

MIT. 각 연결 서비스와 AI 도구의 계정 및 이용 조건은 별도로 적용됩니다.
