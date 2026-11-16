import React, { useEffect, useState } from "react";
import {
  Play,
  Square,
  Plus,
  Save,
  Download,
  Upload,
  Trash2,
  ArrowUp,
  ArrowDown,
  Link2,
  FlaskConical,
} from "lucide-react";
import type { ApiSaved, ApiScenario, ApiStep, ApiRunResult } from "./api-types";
function newStep(): ApiStep {
  return {
    id: crypto.randomUUID(),
    name: "새 요청",
    method: "GET",
    url: "{{baseUrl}}/health",
    headers: {},
    body: "",
    expectedStatus: 200,
    captures: {},
    checks: [],
  };
}
function newScenario(issueKey = ""): ApiScenario {
  return {
    id: crypto.randomUUID(),
    name: "새 API 시나리오",
    issueKey,
    steps: [newStep()],
  };
}
export function ApiWorkspace({ issueKey }: { issueKey: string }) {
  const [saved, setSaved] = useState<ApiSaved[]>([]),
    [draft, setDraft] = useState<ApiScenario>(() => newScenario()),
    [index, setIndex] = useState(0),
    [dirty, setDirty] = useState(false);
  const [headers, setHeaders] = useState("{}"),
    [captures, setCaptures] = useState("{}"),
    [checks, setChecks] = useState("[]"),
    [variables, setVariables] = useState(""),
    [busy, setBusy] = useState(false),
    [running, setRunning] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [results, setResults] = useState<ApiRunResult | null>(null),
    [loaded, setLoaded] = useState(false);
  const step = draft.steps[index];
  const existing = saved.find((s) => s.scenario.id === draft.id);
  useEffect(() => {
    window.pino.api
      .list()
      .then((rows) => {
        setSaved(rows);
        if (rows.length) select(rows[0].scenario);
        setLoaded(true);
      })
      .catch(() => setError("API 시나리오 설정을 읽지 못했습니다."));
  }, []);
  function select(s: ApiScenario) {
    setDraft(s);
    setIndex(0);
    setHeaders(JSON.stringify(s.steps[0].headers, null, 2));
    setCaptures(JSON.stringify(s.steps[0].captures, null, 2));
    setChecks(JSON.stringify(s.steps[0].checks, null, 2));
    setVariables("");
    setDirty(false);
    setResults(null);
    setError("");
    setNotice("");
  }
  function updateStep(p: Partial<ApiStep>) {
    setDraft((d) => ({
      ...d,
      steps: d.steps.map((s, i) => (i === index ? { ...s, ...p } : s)),
    }));
    setDirty(true);
    setResults(null);
  }
  function materialize() {
    try {
      return {
        ...draft,
        steps: draft.steps.map((s, i) =>
          i === index
            ? {
                ...s,
                headers: JSON.parse(headers),
                captures: JSON.parse(captures),
                checks: JSON.parse(checks),
              }
            : s,
        ),
      };
    } catch {
      throw new Error("헤더·추출 변수·응답 검증의 JSON 형식을 확인하세요.");
    }
  }
  function switchStep(next: number) {
    try {
      const d = materialize();
      setDraft(d);
      setIndex(next);
      setHeaders(JSON.stringify(d.steps[next].headers, null, 2));
      setCaptures(JSON.stringify(d.steps[next].captures, null, 2));
      setChecks(JSON.stringify(d.steps[next].checks, null, 2));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function task(action: () => Promise<void>) {
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
  async function persist() {
    const s = materialize();
    let values;
    try {
      values = variables.trim() ? JSON.parse(variables) : undefined;
    } catch {
      throw new Error("로컬 변수는 JSON 객체로 입력하세요.");
    }
    const rows = await window.pino.api.save({ scenario: s, variables: values });
    setSaved(rows);
    setDraft(s);
    setDirty(false);
    setVariables("");
    return s;
  }
  function editJson(setter: (v: string) => void, value: string) {
    setter(value);
    setDirty(true);
    setResults(null);
  }
  function moveStep(delta: number) {
    try {
      const d = materialize();
      const next = index + delta;
      [d.steps[index], d.steps[next]] = [d.steps[next], d.steps[index]];
      setDraft(d);
      setIndex(next);
      setDirty(true);
      setResults(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <main className="api-main">
      <header>
        <div>
          Workspace <span>/</span>
          <strong>API 시나리오</strong>
        </div>
        <span className="private">LOCAL FIRST</span>
      </header>
      <div className="page-heading">
        <div className="eyebrow">BUILD · VERIFY · SHARE</div>
        <div className="heading-row">
          <div>
            <h1>요청을 연결하고, 흐름을 검증하세요.</h1>
            <p>업무별 API 시나리오를 로컬에서 실행하고 파일로 공유합니다.</p>
          </div>
          <button
            className="secondary"
            disabled={busy || running || dirty || !loaded}
            onClick={() =>
              task(async () => {
                const imported = await window.pino.api.import();
                if (imported) {
                  setSaved(await window.pino.api.list());
                  select(imported.scenario);
                  setNotice(
                    "새 시나리오로 가져왔습니다. 로컬 변수를 설정하고 요청을 확인한 뒤 실행하세요.",
                  );
                }
              })
            }
          >
            <Upload size={14} />
            가져오기
          </button>
        </div>
      </div>
      <div className="api-layout">
        <aside className="scenario-list">
          <div className="panel-heading">
            <span>
              시나리오 <b>{saved.length}</b>
            </span>
            <button
              aria-label="새 시나리오"
              disabled={busy || running || dirty || !loaded}
              onClick={() => {
                select(newScenario());
                setDirty(true);
              }}
            >
              <Plus size={16} />
            </button>
          </div>
          {saved.map((row) => (
            <button
              disabled={busy || running || dirty}
              key={row.scenario.id}
              className={
                "scenario-item " +
                (draft.id === row.scenario.id ? "selected" : "")
              }
              onClick={() => select(row.scenario)}
            >
              <strong>{row.scenario.name}</strong>
              <small>
                {row.scenario.steps.length} requests{" "}
                {row.scenario.issueKey && `· ${row.scenario.issueKey}`}
              </small>
            </button>
          ))}
          {!saved.length && (
            <p className="empty">
              첫 시나리오를 저장하세요.
              <br />
              실행 전에는 요청하지 않습니다.
            </p>
          )}
          <div className="api-local-note">
            변수와 시나리오는 PC에 암호화 저장됩니다. 공유 파일에는 로컬 변수
            값과 실행 결과가 포함되지 않습니다.
          </div>
        </aside>
        <section className="scenario-editor">
          <fieldset disabled={busy || running || !loaded}>
            <div className="scenario-title">
              <label>
                시나리오 이름
                <input
                  aria-label="시나리오 이름"
                  value={draft.name}
                  onChange={(e) => {
                    setDraft({ ...draft, name: e.target.value });
                    setDirty(true);
                  }}
                />
              </label>
              <label>
                연결 이슈
                <input
                  aria-label="연결 이슈"
                  placeholder="PROJ-123"
                  value={draft.issueKey}
                  onChange={(e) => {
                    setDraft({ ...draft, issueKey: e.target.value });
                    setDirty(true);
                  }}
                />
              </label>
              <button
                className="secondary"
                disabled={!issueKey}
                onClick={() => {
                  setDraft({ ...draft, issueKey });
                  setDirty(true);
                }}
              >
                <Link2 size={14} />
                현재 이슈
              </button>
            </div>
            <div className="request-tabs">
              {draft.steps.map((s, i) => (
                <button
                  key={s.id}
                  className={i === index ? "selected" : ""}
                  onClick={() => switchStep(i)}
                >
                  <span>{i + 1}</span>
                  {s.name}
                </button>
              ))}
              <button
                aria-label="요청 추가"
                disabled={draft.steps.length >= 30}
                onClick={() => {
                  try {
                    const d = materialize();
                    const s = newStep();
                    setDraft({ ...d, steps: [...d.steps, s] });
                    setIndex(d.steps.length);
                    setHeaders("{}");
                    setCaptures("{}");
                    setChecks("[]");
                    setDirty(true);
                    setResults(null);
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                <Plus size={15} />
              </button>
            </div>
            <div className="request-title">
              <label>
                요청 이름
                <input
                  aria-label="요청 이름"
                  value={step.name}
                  onChange={(e) => updateStep({ name: e.target.value })}
                />
              </label>
              <button
                aria-label="요청 위로"
                disabled={index === 0}
                onClick={() => moveStep(-1)}
              >
                <ArrowUp size={15} />
              </button>
              <button
                aria-label="요청 아래로"
                disabled={index === draft.steps.length - 1}
                onClick={() => moveStep(1)}
              >
                <ArrowDown size={15} />
              </button>
              <button
                aria-label="요청 삭제"
                disabled={draft.steps.length === 1}
                onClick={() => {
                  const d = {
                    ...draft,
                    steps: draft.steps.filter((_, i) => i !== index),
                  };
                  setDraft(d);
                  setIndex(0);
                  setHeaders(JSON.stringify(d.steps[0].headers, null, 2));
                  setCaptures(JSON.stringify(d.steps[0].captures, null, 2));
                  setChecks(JSON.stringify(d.steps[0].checks, null, 2));
                  setResults(null);
                  setDirty(true);
                }}
              >
                <Trash2 size={15} />
              </button>
            </div>
            <div className="request-url">
              <select
                aria-label="HTTP 메서드"
                value={step.method}
                onChange={(e) =>
                  updateStep({ method: e.target.value as ApiStep["method"] })
                }
              >
                {["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
              <input
                aria-label="요청 URL"
                value={step.url}
                onChange={(e) => updateStep({ url: e.target.value })}
              />
            </div>
            <div className="request-grid">
              <label>
                헤더 (JSON)
                <textarea
                  aria-label="요청 헤더"
                  value={headers}
                  onChange={(e) => editJson(setHeaders, e.target.value)}
                  rows={4}
                />
              </label>
              <label>
                요청 본문
                <textarea
                  aria-label="요청 본문"
                  value={step.body}
                  onChange={(e) => updateStep({ body: e.target.value })}
                  rows={4}
                  placeholder="POST/PUT/PATCH/DELETE 본문"
                />
              </label>
            </div>
            <div className="request-grid three">
              <label>
                예상 상태 코드
                <input
                  type="number"
                  aria-label="예상 상태 코드"
                  min="100"
                  max="599"
                  value={step.expectedStatus}
                  onChange={(e) =>
                    updateStep({ expectedStatus: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                응답 → 변수 (JSON)
                <textarea
                  aria-label="응답 변수 추출"
                  rows={3}
                  value={captures}
                  onChange={(e) => editJson(setCaptures, e.target.value)}
                  placeholder={'{"userId":"data.id"}'}
                />
              </label>
              <label>
                JSON 값 검증
                <textarea
                  aria-label="응답 값 검증"
                  rows={3}
                  value={checks}
                  onChange={(e) => editJson(setChecks, e.target.value)}
                  placeholder={'[{"path":"ok","equals":true}]'}
                />
              </label>
            </div>
            <p className="field-help">
              {"{{baseUrl}}"}, {"{{token}}"} 등으로 변수를 참조합니다. 응답
              경로는 data.id, users.0.id 형식입니다. 요청은 위에서 아래 순서로
              실행되며 첫 실패에서 중단합니다.
            </p>
            <details className="api-variables">
              <summary>
                이 컴퓨터의 변수 · {existing?.variableNames.length || 0}개
                저장됨
              </summary>
              <p>
                인증 값은 여기에 입력하세요. 빈칸은 기존 값 유지, {"{}"}는 전체
                삭제입니다. 요청에 직접 입력한 URL·헤더·본문 값은 공유 파일에
                포함됩니다.
              </p>
              <textarea
                aria-label="로컬 API 변수"
                className="secret-editor"
                rows={3}
                value={variables}
                placeholder={
                  '{"baseUrl":"http://localhost:3000","token":"..."}'
                }
                onChange={(e) => editJson(setVariables, e.target.value)}
              />
              {existing && (
                <small>
                  저장된 키: {existing.variableNames.join(", ") || "없음"}
                </small>
              )}
            </details>
            <div className="api-actions">
              <button
                className="secondary"
                onClick={() =>
                  task(async () => {
                    await persist();
                    setNotice("로컬에 저장했습니다.");
                  })
                }
              >
                <Save size={14} />
                시나리오 저장
              </button>
              {dirty && (
                <button
                  onClick={() => select(existing?.scenario ?? newScenario())}
                >
                  변경 취소
                </button>
              )}
              <button
                className="secondary"
                disabled={!existing || dirty}
                onClick={() =>
                  task(async () => {
                    const path = await window.pino.api.export(draft.id);
                    if (path) setNotice(`공유 파일 저장: ${path}`);
                  })
                }
              >
                <Download size={14} />
                공유 파일
              </button>
              <button
                className="primary"
                onClick={() =>
                  task(async () => {
                    const s = await persist();
                    setRunning(true);
                    setResults(null);
                    try {
                      setResults(await window.pino.api.run(s.id));
                    } finally {
                      setRunning(false);
                    }
                  })
                }
              >
                <Play size={14} />
                전체 실행
              </button>
            </div>
            <p className="field-help">
              실행하면 입력한 서버에 실제 요청을 보냅니다. 리디렉션은 따라가지
              않으며 요청당 제한은 15초·응답 1MB입니다.
            </p>
          </fieldset>
          {running && (
            <button
              className="secondary"
              onClick={() =>
                window.pino.api
                  .cancel()
                  .catch(() => setError("중단 요청에 실패했습니다."))
              }
            >
              <Square size={14} />
              실행 중단
            </button>
          )}
          {error && (
            <div className="notice error" role="alert">
              {error}
            </div>
          )}
          {notice && (
            <div className="settings-notice" role="status">
              {notice}
            </div>
          )}
          {results && (
            <section className="api-results">
              <h3>
                <FlaskConical size={17} />
                {results.cancelled
                  ? "중단됨"
                  : results.passed
                    ? "시나리오 통과"
                    : "시나리오 실패"}{" "}
                <span>
                  {results.steps.length}/{draft.steps.length} 실행
                </span>
              </h3>
              {results.steps.map((r) => (
                <details open={!r.passed} key={r.id}>
                  <summary>
                    <span className={r.passed ? "result-pass" : "result-fail"}>
                      {r.passed ? "PASS" : "FAIL"}
                    </span>
                    {r.name}
                    <small>
                      {r.status ?? "—"} · {r.durationMs} ms
                    </small>
                  </summary>
                  {r.error && <p className="form-error">{r.error}</p>}
                  <pre>{r.body || "(본문 없음)"}</pre>
                </details>
              ))}
              <p className="field-help">
                결과는 이 화면에서만 유지됩니다. 로컬/추출 변수 값은 가리지만
                응답의 다른 데이터는 표시됩니다.
              </p>
            </section>
          )}
          {existing && (
            <button
              className="disconnect"
              disabled={busy || running || dirty}
              onClick={() =>
                task(async () => {
                  const rows = await window.pino.api.remove(draft.id);
                  setSaved(rows);
                  select(rows[0]?.scenario ?? newScenario());
                  setNotice("시나리오와 해당 로컬 변수를 삭제했습니다.");
                })
              }
            >
              <Trash2 size={13} />
              시나리오 및 변수 삭제
            </button>
          )}
        </section>
      </div>
    </main>
  );
}
