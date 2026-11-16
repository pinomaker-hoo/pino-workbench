import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowDownToLine,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronRight,
  CircleDot,
  Code2,
  FolderGit2,
  Layers3,
  Link2,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  X,
} from "lucide-react";
import type { Issue, Page } from "./shared";
import { demoIssues, demoPages } from "./demo";
import "./style.css";
import { ApiWorkspace } from "./api-workspace";
import { ConnectionSettings } from "./settings";
function App() {
  const [view, setView] = useState<"work" | "api">("work");
  const [demo, setDemo] = useState(true),
    [connected, setConnected] = useState(false),
    [settings, setSettings] = useState(false);
  const [issues, setIssues] = useState<Issue[]>(demoIssues),
    [selected, setSelected] = useState("PINO-24"),
    [pages, setPages] = useState<Page[]>(demoPages),
    [chosen, setChosen] = useState<string[]>(["1"]);
  const [jql, setJql] = useState(
      "assignee = currentUser() ORDER BY updated DESC",
    ),
    [pageTitle, setPageTitle] = useState(""),
    [repo, setRepo] = useState(""),
    [tab, setTab] = useState("overview"),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const issue = issues.find((i) => i.key === selected),
    refs = pages.filter((p) => chosen.includes(p.id));
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    window.pino
      ?.settings()
      .then((s) => {
        setConnected(s.profiles.some((p) => p.id === "jira" && !!p.tool));
      })
      .catch(() => setError("설정을 읽을 수 없습니다."));
  }, []);
  async function loadIssues() {
    const rows = await window.pino.issues(jql);
    setIssues(rows);
    setSelected(rows[0]?.key || "");
    setPages([]);
    setChosen([]);
    setDemo(false);
  }
  const toggle = (id: string) =>
    setChosen((old) =>
      old.includes(id) ? old.filter((x) => x !== id) : [...old, id],
    );
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-icon">
            <Layers3 size={23} />
          </span>
          pino<span className="alpha">WORKBENCH</span>
        </div>
        <div className="workspace">
          <span className="avatar">P</span>
          <div>
            Personal workspace<small>Local development</small>
          </div>
          <ChevronRight size={15} />
        </div>
        <div className="section-label">WORKSPACE</div>
        <button
          className={"nav " + (view === "work" ? "active" : "")}
          onClick={() => {
            setView("work");
            setTab("overview");
            setSettings(false);
          }}
        >
          <Layers3 size={17} />
          업무 공간<span className="count">{issues.length}</span>
        </button>
        <button
          className={"nav " + (view === "api" ? "active" : "")}
          onClick={() => setView("api")}
        >
          <Code2 size={17} />
          API 시나리오
        </button>
        <button
          className="nav"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const path = await window.pino.repository();
              if (path) setRepo(path);
            })
          }
        >
          <FolderGit2 size={17} />
          저장소 연결
          <Plus size={15} />
        </button>
        <div className="section-label integrations-label">
          CONNECTIONS{" "}
          <button aria-label="연결 설정" onClick={() => setSettings(true)}>
            <Plus size={14} />
          </button>
        </div>
        <button className="connection" onClick={() => setSettings(true)}>
          <span className="service jira">J</span>Jira
          <small>설정</small>
        </button>
        <button className="connection" onClick={() => setSettings(true)}>
          <span className="service confluence">C</span>Confluence
          <small>설정</small>
        </button>
        {["GitHub", "Notion", "Google"].map((s, i) => (
          <button
            className="connection"
            key={s}
            onClick={() => setSettings(true)}
          >
            <span className="service">{["⌘", "N", "G"][i]}</span>
            {s}
            <small>MCP</small>
          </button>
        ))}
        <div className="sidebar-bottom">
          <div className="local">
            <span className="dot live" />
            로컬 워크스페이스<small>v0.1.0</small>
          </div>
          <button className="nav" onClick={() => setSettings(true)}>
            <Settings size={17} />
            설정 및 연결
          </button>
        </div>
      </aside>
      <div className="api-view" hidden={view !== "api"}>
        <ApiWorkspace issueKey={issue?.key || ""} />
      </div>
      <main hidden={view !== "work"}>
        <header>
          <div>
            Workspace <ChevronRight size={13} />
            <strong>업무 공간</strong>
          </div>
          <span className="private">
            <span className="dot live" />
            {demo ? "데모 데이터" : "MCP"}
          </span>
        </header>
        <div className="page-heading">
          <div className="eyebrow">YOUR WORK, IN CONTEXT</div>
          <div className="heading-row">
            <div>
              <h1>업무에서 코드까지.</h1>
              <p>필요한 맥락을 모으고, 다음 작업을 시작하세요.</p>
            </div>
            <button className="primary" onClick={() => setSettings(true)}>
              <Link2 size={16} />
              {connected ? "연결 관리" : "서비스 연결"}
            </button>
          </div>
        </div>
        {(error || message) && (
          <div className={error ? "notice error" : "notice"} role="status">
            {error || message}
            <button
              aria-label="알림 닫기"
              onClick={() => {
                setError("");
                setMessage("");
              }}
            >
              <X size={14} />
            </button>
          </div>
        )}
        {demo && (
          <div className="demo-banner">
            <Sparkles size={16} />
            <span>
              데모 워크스페이스{" "}
              <em>예시 이슈와 문서로 작업 흐름을 둘러보세요.</em>
            </span>
            {connected ? (
              <button disabled={busy} onClick={() => run(loadIssues)}>
                내 이슈 가져오기 <ArrowUpRight size={14} />
              </button>
            ) : (
              <button onClick={() => setSettings(true)}>
                연결 설정 <ArrowUpRight size={14} />
              </button>
            )}
          </div>
        )}
        <div className="workbench">
          <section className="issue-panel">
            <div className="panel-heading">
              <span>
                내 업무 <b>{issues.length}</b>
              </span>
              <button
                title="이슈 새로고침"
                aria-label="이슈 새로고침"
                disabled={busy}
                onClick={() =>
                  demo
                    ? setMessage(
                        "데모 데이터입니다. MCP를 설정하면 실제 이슈를 가져옵니다.",
                      )
                    : run(loadIssues)
                }
              >
                <RefreshCw size={15} className={busy ? "spin" : ""} />
              </button>
            </div>
            <form
              className="search"
              onSubmit={(e) => {
                e.preventDefault();
                if (connected) void run(loadIssues);
                else setSettings(true);
              }}
            >
              <Search size={15} />
              <input
                aria-label="JQL 검색"
                value={jql}
                onChange={(e) => setJql(e.target.value)}
                placeholder="JQL로 이슈 검색"
              />
              <button disabled={busy} aria-label="검색 실행">
                <ChevronRight size={15} />
              </button>
            </form>
            <div className="list-note">최근 업데이트 · 최대 50개</div>
            <div className="issue-list">
              {issues.map((i) => (
                <button
                  key={i.key}
                  className={
                    "issue-card " + (selected === i.key ? "selected" : "")
                  }
                  onClick={() => {
                    setSelected(i.key);
                    setChosen([]);
                  }}
                >
                  <div className="issue-meta">
                    <span>{i.key}</span>
                    <span
                      className={
                        "status-icon " + (i.status === "Done" ? "done" : "")
                      }
                    >
                      {i.status === "Done" ? (
                        <Check size={14} />
                      ) : (
                        <CircleDot size={14} />
                      )}
                    </span>
                  </div>
                  <h3>{i.title}</h3>
                  <div className="issue-footer">
                    <span>{i.status}</span>
                    <span className="priority">{i.priority}</span>
                  </div>
                </button>
              ))}
              {!issues.length && (
                <div className="empty">
                  검색 결과가 없습니다.
                  <br />
                  JQL 조건을 변경해 보세요.
                </div>
              )}
            </div>
            <div className="list-bottom">
              <span className="service jira">J</span>
              {demo ? "샘플 Jira 프로젝트" : "Jira MCP"}
              <span>읽기 전용</span>
            </div>
          </section>
          <section className="detail-panel">
            {issue ? (
              <>
                <div className="detail-top">
                  <span className="issue-key">
                    <CircleDot size={15} />
                    {issue.key}
                  </span>
                  <span className="badge">{issue.status}</span>
                </div>
                <h2>{issue.title}</h2>
                <div className="detail-meta">
                  <span>
                    담당자 <b>{issue.assignee}</b>
                  </span>
                  <span>
                    우선순위 <b>{issue.priority}</b>
                  </span>
                </div>
                <div className="tabs">
                  <button
                    className={tab === "overview" ? "current" : ""}
                    onClick={() => setTab("overview")}
                  >
                    개요
                  </button>
                  <button
                    className={tab === "context" ? "current" : ""}
                    onClick={() => setTab("context")}
                  >
                    작업 맥락 <span>{refs.length}</span>
                  </button>
                </div>
                <div className="detail-content">
                  {tab === "overview" ? (
                    <>
                      <div className="content-label">
                        <BookOpen size={16} />
                        요구사항
                      </div>
                      <p className="description">
                        {issue.description || "설명이 없는 이슈입니다."}
                      </p>
                      <div className="source-link">
                        원문 <span>{issue.url}</span>
                      </div>
                      <div className="next-step">
                        <Code2 size={21} />
                        <div>
                          <strong>맥락을 준비하면, 개발이 쉬워집니다.</strong>
                          <p>
                            오른쪽에서 참고 문서를 선택하고 작업 맥락을
                            저장하세요.
                          </p>
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="content-label">
                        <Layers3 size={16} />
                        선택한 참고 문서
                      </div>
                      {refs.length ? (
                        refs.map((p) => (
                          <article className="reference" key={p.id}>
                            <h3>{p.title}</h3>
                            <p>{p.text || "본문이 없습니다."}</p>
                            <small>{p.url}</small>
                          </article>
                        ))
                      ) : (
                        <div className="empty">
                          오른쪽에서 Confluence 문서를 선택하세요.
                        </div>
                      )}
                      <p className="muted">
                        이슈 설명과 선택한 문서를 원문 링크·내보낸 시각과 함께
                        저장합니다.
                      </p>
                    </>
                  )}
                </div>
                <div className="action-bar">
                  <div>
                    <FolderGit2 size={16} />
                    <span title={repo}>
                      {repo ? repo.split(/[\\/]/).pop() : "저장소 미연결"}
                    </span>
                  </div>
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        const path = await window.pino.exportContext({
                          issue,
                          pages: refs,
                        });
                        if (path)
                          setMessage(`작업 맥락을 저장했습니다: ${path}`);
                      })
                    }
                  >
                    <ArrowDownToLine size={16} />
                    맥락 저장
                  </button>
                </div>
              </>
            ) : (
              <div className="empty">
                이슈를 선택하면 요구사항이 표시됩니다.
              </div>
            )}
          </section>
          <aside className="context-panel">
            <div className="panel-heading">
              <span>
                <BookOpen size={16} />
                참고 자료
              </span>
              <span className="subtle">{chosen.length} 선택</span>
            </div>
            <p className="context-intro">
              작업에 필요한 문서를 직접 선택하세요.
            </p>
            <form
              className="search"
              onSubmit={(e) => {
                e.preventDefault();
                if (demo) {
                  setMessage(
                    "데모 문서입니다. MCP 설정 후 문서를 검색할 수 있습니다.",
                  );
                  return;
                }
                void run(async () => {
                  setPages(await window.pino.pages(pageTitle));
                  setChosen([]);
                });
              }}
            >
              <Search size={14} />
              <input
                aria-label="Confluence 문서 제목"
                placeholder="문서 검색어"
                value={pageTitle}
                onChange={(e) => setPageTitle(e.target.value)}
              />
              <button aria-label="문서 검색" disabled={busy}>
                <ChevronRight size={14} />
              </button>
            </form>
            <div className="list-note">설정한 MCP 도구로 검색 · 최대 50개</div>
            <div className="docs">
              {pages.map((p) => (
                <button
                  className={
                    "doc-card " + (chosen.includes(p.id) ? "checked" : "")
                  }
                  key={p.id}
                  onClick={() => toggle(p.id)}
                >
                  <div>
                    <span className="service confluence">C</span>
                    <span className="checkbox">
                      {chosen.includes(p.id) && <Check size={12} />}
                    </span>
                  </div>
                  <strong>{p.title}</strong>
                  <p>{p.text.slice(0, 75) || "본문 없음"}</p>
                  <small>Confluence · {demo ? "예시" : "원문 수집"}</small>
                </button>
              ))}
              {!pages.length && (
                <div className="empty">
                  문서를 검색해
                  <br />
                  참고 자료를 추가하세요.
                </div>
              )}
            </div>
            <div className="context-tip">
              <Sparkles size={16} />
              <p>
                좋은 맥락이 좋은 결과를 만듭니다.
                <br />
                <span>저장한 Markdown을 Claude나 Codex에서 참조하세요.</span>
              </p>
            </div>
          </aside>
        </div>
        <footer>
          <span>Built for focus. Connected to your work.</span>
          <span>PINO / OPEN SOURCE</span>
        </footer>
      </main>
      {settings && (
        <ConnectionSettings
          onClose={() => setSettings(false)}
          onChange={(s) => {
            setConnected(s.profiles.some((p) => p.id === "jira" && !!p.tool));
            setDemo(true);
            setIssues(demoIssues);
            setSelected(demoIssues[0].key);
            setPages(demoPages);
            setChosen([]);
          }}
        />
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
