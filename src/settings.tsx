import React, { useEffect, useState } from "react";
import { X, ShieldCheck, Plug, Save, Trash2 } from "lucide-react";
import type { LocalSettings, Profile, Service, ToolInfo } from "./shared";
const services: Service[] = [
  "jira",
  "confluence",
  "github",
  "notion",
  "google",
  "claude",
  "codex",
];
const names: Record<Service, string> = {
  jira: "Jira",
  confluence: "Confluence",
  github: "GitHub",
  notion: "Notion",
  google: "Google",
  claude: "Claude",
  codex: "Codex",
};
function blank(id: Service): Profile {
  return {
    id,
    transport: ["claude", "codex"].includes(id) ? "cli" : "stdio",
    endpoint: "",
    command: ["claude", "codex"].includes(id) ? id : "",
    args: [],
    tool: "",
    arguments: { [id === "jira" ? "jql" : "query"]: "{{query}}" },
    resultPath: id === "jira" ? "issues" : "results",
    baseUrl: "",
  };
}
export function ConnectionSettings({
  onClose,
  onChange,
}: {
  onClose: () => void;
  onChange: (s: LocalSettings) => void;
}) {
  const [state, setState] = useState<LocalSettings>({
      profiles: [],
      storagePath: "",
    }),
    [id, setId] = useState<Service>("jira"),
    [form, setForm] = useState<Profile>(blank("jira"));
  const [args, setArgs] = useState("[]"),
    [params, setParams] = useState("{}"),
    [secrets, setSecrets] = useState(""),
    [tools, setTools] = useState<ToolInfo[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [dirty, setDirty] = useState(false),
    [loaded, setLoaded] = useState(false);
  const saved = state.profiles.find((p) => p.id === id),
    ai = form.transport === "cli";
  function select(next: Service, data = state) {
    const p = data.profiles.find((p) => p.id === next) || blank(next);
    setId(next);
    setForm(p);
    setArgs(JSON.stringify(p.args, null, 2));
    setParams(JSON.stringify(p.arguments, null, 2));
    setSecrets("");
    setTools([]);
    setError("");
    setNotice("");
    setDirty(false);
  }
  useEffect(() => {
    window.pino
      .settings()
      .then((s) => {
        setState(s);
        select("jira", s);
        setLoaded(true);
      })
      .catch(() =>
        setError("로컬 설정을 읽지 못했습니다. 기존 설정 파일을 확인하세요."),
      );
  }, []);
  function update(p: Partial<Profile>) {
    setForm((old) => ({ ...old, ...p }));
    setDirty(true);
    setTools([]);
  }
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "요청에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    let parsedArgs, parsedParams, parsedSecrets;
    try {
      parsedArgs = JSON.parse(args);
      parsedParams = JSON.parse(params);
      parsedSecrets = secrets.trim() ? JSON.parse(secrets) : undefined;
    } catch {
      throw new Error(
        "JSON 형식을 확인하세요. 명령 인자는 배열, 도구 인자와 인증 값은 객체입니다.",
      );
    }
    const next = await window.pino.saveProfile({
      profile: { ...form, args: parsedArgs, arguments: parsedParams },
      secrets: parsedSecrets,
    });
    setState(next);
    select(id, next);
    onChange(next);
    setNotice(
      "이 컴퓨터에 암호화하여 저장했습니다. 연결 테스트는 별도로 실행하세요.",
    );
  }
  return (
    <div className="modal-backdrop">
      <section
        className="modal connections-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <button
          className="close"
          aria-label="설정 닫기"
          disabled={busy}
          onClick={onClose}
        >
          <X size={20} />
        </button>
        <div className="settings-heading">
          <ShieldCheck size={25} />
          <div>
            <h2 id="settings-title">내 컴퓨터의 연결 설정</h2>
            <p>
              각 서비스의 계정과 인증은 직접 관리합니다. Pino 서버나 계정은
              없습니다.
            </p>
          </div>
        </div>
        <div className="settings-grid">
          <nav className="service-tabs" aria-label="서비스 선택">
            {services.map((s) => (
              <button
                key={s}
                disabled={busy || !loaded || (dirty && s !== id)}
                className={s === id ? "selected" : ""}
                onClick={() => select(s)}
              >
                {names[s]}
                <small>
                  {state.profiles.some((p) => p.id === s)
                    ? "저장됨"
                    : ["claude", "codex"].includes(s)
                      ? "AI CLI"
                      : "MCP"}
                </small>
              </button>
            ))}
          </nav>
          <div className="settings-fields">
            <div className="settings-title">
              <strong>
                {names[id]} {ai ? "CLI" : "MCP"}
              </strong>
              <span>{saved ? "로컬 설정 있음" : "설정 필요"}</span>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(save);
              }}
            >
              <fieldset disabled={busy || !loaded}>
                {!ai && (
                  <label>
                    연결 방식
                    <select
                      value={form.transport}
                      onChange={(e) =>
                        update({
                          transport: e.target.value as "stdio" | "http",
                        })
                      }
                    >
                      <option value="stdio">로컬 프로세스 · stdio</option>
                      <option value="http">서버 주소 · Streamable HTTP</option>
                    </select>
                  </label>
                )}
                {form.transport === "http" ? (
                  <label>
                    MCP 서버 주소
                    <input
                      value={form.endpoint}
                      placeholder="https://mcp.company.com/mcp"
                      onChange={(e) => update({ endpoint: e.target.value })}
                    />
                  </label>
                ) : (
                  <>
                    <label>
                      실행 파일 / 명령
                      <input
                        value={form.command}
                        placeholder={ai ? id : "예: /path/to/mcp-server"}
                        onChange={(e) => update({ command: e.target.value })}
                      />
                    </label>
                    <label>
                      명령 인자 (JSON 배열)
                      <textarea
                        rows={2}
                        value={args}
                        onChange={(e) => {
                          setArgs(e.target.value);
                          setDirty(true);
                        }}
                      />
                    </label>
                  </>
                )}
                <label>
                  {form.transport === "http"
                    ? "인증 헤더 (JSON 객체)"
                    : "환경 변수 / 인증 값 (JSON 객체)"}
                  <textarea
                    className="secret-editor"
                    aria-label="인증 값"
                    autoComplete="off"
                    spellCheck={false}
                    rows={3}
                    value={secrets}
                    placeholder={
                      form.transport === "http"
                        ? '{"Authorization": "Bearer YOUR_TOKEN"}'
                        : '{"SERVICE_API_TOKEN": "YOUR_TOKEN"}'
                    }
                    onChange={(e) => {
                      setSecrets(e.target.value);
                      setDirty(true);
                    }}
                  />
                </label>
                <div className="field-help">
                  {saved?.secretKeys.length
                    ? `저장된 키: ${saved.secretKeys.join(", ")}. 값은 다시 표시하지 않습니다. `
                    : ""}
                  빈칸은 기존 값 유지, {"{}"}는 전체 삭제입니다. 비밀 값은
                  주소나 명령 인자 대신 이 필드에 입력하세요.
                </div>
                {ai ? (
                  <div className="settings-note">
                    로그인은 설치한 AI CLI에서 직접 진행하세요. CLI의 로그인
                    정보는 해당 도구가 로컬에서 관리하며 Pino가 복사하지
                    않습니다. 이 화면은 실행 경로·환경 설정을 저장합니다. AI
                    실행 연동은 아직 제공하지 않습니다.
                  </div>
                ) : (
                  <>
                    <div className="settings-note">
                      저장만으로 서버를 실행하지 않습니다. 연결 테스트를 누르면
                      입력한 명령을 실행하거나 서버에 접속합니다. HTTP는 직접
                      발급받은 토큰을 사용합니다. 브라우저 OAuth·기존 SSE 연결은
                      아직 지원하지 않습니다.
                    </div>
                    {(id === "jira" || id === "confluence") && (
                      <details open>
                        <summary>업무 화면의 검색 도구 연결</summary>
                        <label>
                          검색 도구 이름
                          <input
                            list="mcp-tools"
                            value={form.tool}
                            placeholder="연결 테스트 후 검색 도구 선택"
                            onChange={(e) => {
                              setForm((p) => ({ ...p, tool: e.target.value }));
                              setDirty(true);
                            }}
                          />
                          <datalist id="mcp-tools">
                            {tools.map((t) => (
                              <option key={t.name} value={t.name} />
                            ))}
                          </datalist>
                        </label>
                        <label>
                          도구 인자 (JSON 객체)
                          <textarea
                            rows={3}
                            value={params}
                            onChange={(e) => {
                              setParams(e.target.value);
                              setDirty(true);
                            }}
                          />
                        </label>
                        <div className="field-help">
                          {"{{query}}"}를 실제 검색어/JQL로 치환합니다. 읽기
                          전용 검색 도구를 지정하세요.
                        </div>
                        <label>
                          결과 배열 경로
                          <input
                            value={form.resultPath}
                            placeholder="예: issues / data.results / 루트 배열은 빈칸"
                            onChange={(e) =>
                              update({ resultPath: e.target.value })
                            }
                          />
                        </label>
                        <label>
                          원문 기본 주소 (결과에 URL이 없을 때)
                          <input
                            value={form.baseUrl}
                            placeholder="https://jira.company.com"
                            onChange={(e) =>
                              update({ baseUrl: e.target.value })
                            }
                          />
                        </label>
                      </details>
                    )}
                    {!["jira", "confluence"].includes(id) && (
                      <div className="field-help">
                        현재는 연결 저장과 도구 조회를 제공합니다. 이 서비스의
                        업무 화면 연동은 후속 구현입니다.
                      </div>
                    )}
                  </>
                )}
                <div className="settings-actions">
                  <button type="submit" className="primary">
                    <Save size={14} />
                    로컬에 저장
                  </button>
                  {dirty && (
                    <button type="button" onClick={() => select(id)}>
                      변경 취소
                    </button>
                  )}
                  {!ai && (
                    <button
                      type="button"
                      className="secondary"
                      disabled={!saved || dirty}
                      onClick={() =>
                        run(async () => {
                          const result = await window.pino.testProfile(id);
                          setTools(result);
                          setNotice(`MCP 연결 성공 · 도구 ${result.length}개`);
                        })
                      }
                    >
                      <Plug size={14} />
                      연결 테스트
                    </button>
                  )}
                </div>
              </fieldset>
            </form>
            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}
            {notice && (
              <div className="settings-notice" role="status">
                {notice}
              </div>
            )}
            {!!tools.length && (
              <details open className="tool-list">
                <summary>서버 도구 ({tools.length})</summary>
                {tools.map((t) => (
                  <details key={t.name}>
                    <summary>{t.name}</summary>
                    <p>{t.description}</p>
                    <pre>{JSON.stringify(t.inputSchema, null, 2)}</pre>
                  </details>
                ))}
              </details>
            )}
            {saved && (
              <button
                className="disconnect"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const next = await window.pino.deleteProfile(id);
                    setState(next);
                    select(id, next);
                    onChange(next);
                    setNotice(
                      "이 서비스의 로컬 설정과 Pino에 저장한 인증 값을 삭제했습니다.",
                    );
                  })
                }
              >
                <Trash2 size={13} />이 서비스 설정 및 인증 삭제
              </button>
            )}
          </div>
        </div>
        <div className="settings-storage">
          로컬 암호화 파일 · {state.storagePath || "불러오는 중"}
          <br />
          원격 서비스에 연결할 때만 해당 서버와 통신합니다. 다른 앱의 로그인
          정보는 가져오지 않습니다.
        </div>
      </section>
    </div>
  );
}
