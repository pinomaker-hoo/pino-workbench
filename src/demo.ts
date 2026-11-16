import type { Issue, Page } from "./shared";
export const demoIssues: Issue[] = [
  {
    key: "PINO-24",
    title: "업무 맥락을 하나의 작업 공간으로 연결하기",
    status: "In Progress",
    priority: "High",
    assignee: "You",
    description:
      "Jira 이슈에서 개발을 시작할 때 필요한 맥락을 한곳에 모읍니다.\n\n완료 조건\n• 이슈의 설명, 상태, 담당자를 확인할 수 있다.\n• Confluence 문서를 선택해 참고 자료에 추가할 수 있다.\n• 원문 링크가 포함된 작업 맥락을 Markdown으로 저장할 수 있다.\n\n이 데이터는 화면을 둘러보기 위한 예시입니다.",
    url: "https://example.atlassian.net/browse/PINO-24",
  },
  {
    key: "PINO-23",
    title: "프로젝트별 Git 저장소 연결",
    status: "To Do",
    priority: "Medium",
    assignee: "You",
    description:
      "로컬 Git 저장소를 선택하고 프로젝트의 작업 경로를 확인합니다.",
    url: "https://example.atlassian.net/browse/PINO-23",
  },
  {
    key: "PINO-22",
    title: "Atlassian 계정 연결과 안전한 인증 정보 저장",
    status: "Done",
    priority: "High",
    assignee: "You",
    description:
      "계정 연결을 확인하고 운영체제의 암호화 기능으로 API 토큰을 저장합니다.",
    url: "https://example.atlassian.net/browse/PINO-22",
  },
];
export const demoPages: Page[] = [
  {
    id: "1",
    title: "Pino · 제품 방향과 MVP",
    text: "업무의 시작부터 코드 변경까지, 하나의 공간에서.\n\n첫 버전은 Jira와 Confluence의 맥락을 읽고 로컬 개발에 전달하는 흐름에 집중합니다. Windows와 macOS를 지원합니다.",
    url: "https://example.atlassian.net/wiki/pages/viewpage.action?pageId=1",
  },
  {
    id: "2",
    title: "개발 워크플로 가이드",
    text: "1. Jira 이슈의 요구사항을 확인합니다.\n2. 관련 문서를 선택합니다.\n3. 작업 맥락을 저장하고 AI 개발 도구에서 참조합니다.\n4. 변경사항을 검토합니다.",
    url: "https://example.atlassian.net/wiki/pages/viewpage.action?pageId=2",
  },
];
