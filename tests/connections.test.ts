import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
  ProfileStore,
  profileSchema,
  type StoredProfile,
} from "../electron/profiles";
import { discover, search, queryArguments, resultRows } from "../electron/mcp";
const profile: StoredProfile = {
  id: "jira",
  transport: "stdio",
  command: process.execPath,
  args: [resolve("tests/fixtures/mcp-server.mjs")],
  endpoint: "",
  tool: "jira_search",
  arguments: { jql: "{{query}}" },
  resultPath: "issues",
  baseUrl: "https://jira.company.test",
  secrets: { TOKEN: "local-test-secret" },
};
const key = randomBytes(32);
const cipher = {
  isEncryptionAvailable: () => true,
  encryptString(s: string) {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([c.update(s), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), encrypted]);
  },
  decryptString(b: Buffer) {
    const d = createDecipheriv("aes-256-gcm", key, b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString();
  },
};
test("settings survive reload, hide secrets, preserve/clear values, and delete independently", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pino-store-"));
  try {
    const path = join(dir, "connections.enc"),
      store = new ProfileStore(path, cipher);
    await store.load();
    await store.save({ profile, secrets: profile.secrets });
    assert.ok(!(await readFile(path)).includes("local-test-secret"));
    assert.ok(!JSON.stringify(store.public()).includes("local-test-secret"));
    const next = new ProfileStore(path, cipher);
    await next.load();
    assert.equal(next.get("jira").secrets.TOKEN, "local-test-secret");
    await next.save({ profile: { ...profile, tool: "renamed" } });
    assert.equal(next.get("jira").secrets.TOKEN, "local-test-secret");
    await assert.rejects(
      next.save({ profile: { ...profile, command: "other" } }),
      /인증 값을 다시/,
    );
    await next.save({ profile, secrets: {} });
    assert.deepEqual(next.get("jira").secrets, {});
    await next.save({ profile: { ...profile, id: "confluence" } });
    await next.delete("jira");
    assert.equal(next.public().length, 1);
    await writeFile(path, "corrupt");
    await assert.rejects(new ProfileStore(path, cipher).load(), /복호화/);
    assert.equal(await readFile(path, "utf8"), "corrupt");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("rejects unsafe remote transports and unsupported AI/service transport combinations", () => {
  for (const endpoint of [
    "http://company.test/mcp",
    "file:///tmp/server",
    "https://user:password@company.test/mcp",
  ])
    assert.equal(
      profileSchema.safeParse({ ...profile, transport: "http", endpoint })
        .success,
      false,
    );
  for (const endpoint of [
    "https://company.test/mcp",
    "http://127.0.0.1:3000/mcp",
  ])
    assert.equal(
      profileSchema.safeParse({ ...profile, transport: "http", endpoint })
        .success,
      true,
    );
  assert.equal(
    profileSchema.safeParse({ ...profile, id: "codex" }).success,
    false,
  );
});
test("query interpolation preserves JSON types and rejects unstructured results", () => {
  assert.deepEqual(queryArguments({ jql: "{{query}}", limit: 10 }, 'a"b'), {
    jql: 'a"b',
    limit: 10,
  });
  assert.deepEqual(
    resultRows({ structuredContent: { data: { issues: [1] } } }, "data.issues"),
    [1],
  );
  assert.throws(
    () => resultRows({ content: [{ type: "text", text: "not-json" }] }, ""),
    /JSON/,
  );
  assert.throws(() => resultRows({ isError: true }, ""), /오류/);
});
test("real stdio MCP discovery and Jira/Confluence search", async () => {
  const tools = await discover(profile);
  assert.ok(tools.some((t) => t.name === "jira_search"));
  const issues = await search(profile, "assignee = currentUser()");
  assert.equal((issues[0] as any).key, "TEST-1");
  assert.equal(issues[0].title, "assignee = currentUser()");
  assert.equal(issues[0].url, "https://jira.company.test/browse/TEST-1");
  const pages = await search(
    {
      ...profile,
      id: "confluence",
      tool: "confluence_search",
      arguments: { query: "{{query}}" },
      resultPath: "results",
    },
    "Design",
  );
  assert.equal((pages[0] as any).text, "Fixture document");
});

test("Streamable HTTP discovery sends user auth to the configured server", async () => {
  const { createServer } = await import("node:http");
  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  const { StreamableHTTPServerTransport } =
    await import("@modelcontextprotocol/sdk/server/streamableHttp.js");
  const { z } = await import("zod");
  const mcp = new McpServer({ name: "http-fixture", version: "1.0.0" });
  mcp.registerTool(
    "jira_search",
    { inputSchema: { jql: z.string() } },
    async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            issues: [
              {
                key: "HTTP-1",
                title: "HTTP result",
                url: "https://jira.test/browse/HTTP-1",
              },
            ],
          }),
        },
      ],
    }),
  );
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => "fixture-session",
    enableJsonResponse: true,
  });
  await mcp.connect(transport);
  const auth: string[] = [];
  const server = createServer(async (req, res) => {
    auth.push(req.headers.authorization || "");
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length
        ? JSON.parse(Buffer.concat(chunks).toString())
        : undefined;
      await transport.handleRequest(req, res, body);
    } catch {
      res.writeHead(500).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = (server.address() as { port: number }).port;
    const httpProfile: StoredProfile = {
      ...profile,
      transport: "http",
      endpoint: `http://127.0.0.1:${port}/mcp`,
      secrets: { Authorization: "Bearer fixture-token" },
    };
    const tools = await discover(httpProfile);
    assert.equal(tools[0].name, "jira_search");
    // A fresh stateless server transport is required for a new MCP client session.
    assert.ok(auth.length > 0);
    assert.ok(auth.every((value) => value === "Bearer fixture-token"));
  } finally {
    await mcp.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
