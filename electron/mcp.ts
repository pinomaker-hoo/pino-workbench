import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { StoredProfile } from "./profiles";
import type { Issue, Page, ToolInfo } from "../src/shared";
import { adfText, issueSchema, pageSchema } from "./core";
export function queryArguments(input: unknown, query: string): any {
  if (typeof input === "string") return input.replaceAll("{{query}}", query);
  if (Array.isArray(input)) return input.map((v) => queryArguments(v, query));
  if (input && typeof input === "object")
    return Object.fromEntries(
      Object.entries(input).map(([k, v]) => [k, queryArguments(v, query)]),
    );
  return input;
}
export function resultRows(result: any, path: string): any[] {
  if (result.isError)
    throw new Error(
      "MCP 도구가 오류를 반환했습니다. 서버의 인증과 도구 인자를 확인하세요.",
    );
  let body = result.structuredContent;
  if (body === undefined) {
    const text = (result.content || [])
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n");
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(
        "MCP 결과가 JSON이 아닙니다. JSON 배열을 반환하는 검색 도구를 선택하세요.",
      );
    }
  }
  for (const key of path.split(".").filter(Boolean)) {
    if (["__proto__", "prototype", "constructor"].includes(key))
      throw new Error("잘못된 결과 경로입니다.");
    body = body?.[key];
  }
  if (!Array.isArray(body))
    throw new Error(
      "결과 배열 경로가 맞지 않습니다. 서버 응답에 맞게 issues, results 등의 경로를 설정하세요.",
    );
  return body.slice(0, 50);
}
function description(value: any): string {
  return typeof value === "string" ? value : adfText(value);
}
export function normalizeIssue(i: any, base: string): Issue {
  const f = i.fields || i;
  const key = i.key;
  const parsed = issueSchema.safeParse({
    key,
    title: f.summary || f.title || i.title,
    status: typeof f.status === "string" ? f.status : f.status?.name || "",
    priority:
      typeof f.priority === "string" ? f.priority : f.priority?.name || "",
    assignee:
      typeof f.assignee === "string"
        ? f.assignee
        : f.assignee?.displayName || "Unassigned",
    description: description(f.description),
    url:
      i.url ||
      (base
        ? `${base.replace(/\/$/, "")}/browse/${encodeURIComponent(key)}`
        : ""),
  });
  if (!parsed.success)
    throw new Error(
      "Jira 결과 형식을 읽을 수 없습니다. key·title/summary·url 또는 원문 기본 주소를 확인하세요.",
    );
  return parsed.data;
}
export function normalizePage(p: any, base: string): Page {
  const parsed = pageSchema.safeParse({
    id: String(p.id ?? ""),
    title: p.title,
    text: description(
      p.text ??
        p.content ??
        p.body?.atlas_doc_format ??
        p.body?.storage?.value ??
        "",
    ),
    url:
      p.url ||
      (base && p._links?.webui
        ? base.replace(/\/$/, "") + p._links.webui
        : base && p.id
          ? `${base.replace(/\/$/, "")}/wiki/pages/viewpage.action?pageId=${encodeURIComponent(p.id)}`
          : ""),
  });
  if (!parsed.success)
    throw new Error(
      "Confluence 결과 형식을 읽을 수 없습니다. id·title·text·url 또는 원문 기본 주소를 확인하세요.",
    );
  return parsed.data;
}
async function withClient<T>(
  p: StoredProfile,
  action: (client: Client) => Promise<T>,
): Promise<T> {
  if (p.transport === "cli")
    throw new Error(
      "AI 실행 연동은 아직 지원하지 않습니다. 설정은 로컬에 저장됩니다.",
    );
  const client = new Client({ name: "pino", version: "0.1.0" });
  const transport =
    p.transport === "stdio"
      ? new StdioClientTransport({
          command: p.command,
          args: p.args,
          env: p.secrets,
          stderr: "ignore",
        })
      : new StreamableHTTPClientTransport(new URL(p.endpoint), {
          requestInit: { headers: p.secrets, redirect: "error" },
        });
  try {
    await client.connect(transport, { timeout: 15000 });
    return await action(client);
  } catch (error) {
    // Server/transport errors can echo authentication headers or environment values.
    if (
      error instanceof Error &&
      /^(MCP 결과|MCP 도구|결과 배열|Jira 결과|Confluence 결과)/.test(
        error.message,
      )
    )
      throw error;
    throw new Error(
      "MCP 연결 또는 요청에 실패했습니다. 주소·명령·사용자 인증·도구 설정을 확인하세요. (15초 제한)",
    );
  } finally {
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
  }
}
export async function discover(p: StoredProfile): Promise<ToolInfo[]> {
  return withClient(p, async (c) => {
    const tools: ToolInfo[] = [];
    let cursor: string | undefined;
    let batches = 0;
    do {
      const result = await c.listTools({ cursor }, { timeout: 15000 });
      tools.push(...result.tools);
      cursor = result.nextCursor;
    } while (cursor && tools.length < 500 && ++batches < 20);
    return tools;
  });
}
export async function search(p: StoredProfile, query: string) {
  if (!p.tool) throw new Error("설정에서 검색에 사용할 MCP 도구를 선택하세요.");
  return withClient(p, async (c) => {
    const result = await c.callTool(
      { name: p.tool, arguments: queryArguments(p.arguments, query) },
      undefined,
      { timeout: 15000 },
    );
    return resultRows(result, p.resultPath).map((row) =>
      p.id === "jira"
        ? normalizeIssue(row, p.baseUrl)
        : normalizePage(row, p.baseUrl),
    );
  });
}
