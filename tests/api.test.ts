import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  randomUUID,
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ScenarioStore,
  runScenario,
  shareScenario,
  parseShared,
  jsonPath,
} from "../electron/api-scenarios";
import type { ApiStep, ApiScenario } from "../src/api-types";
function step(p: Partial<ApiStep> = {}): ApiStep {
  return {
    id: randomUUID(),
    name: "Request",
    method: "GET",
    url: "{{baseUrl}}/health",
    headers: {},
    body: "",
    expectedStatus: 200,
    captures: {},
    checks: [],
    ...p,
  };
}
function scenario(steps: ApiStep[]): ApiScenario {
  return { id: randomUUID(), name: "API flow", issueKey: "TEST-1", steps };
}
async function fixture(
  action: (
    url: string,
    seen: { url: string; authorization?: string; body: string }[],
  ) => Promise<void>,
) {
  const seen: { url: string; authorization?: string; body: string }[] = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    seen.push({
      url: req.url!,
      authorization: req.headers.authorization,
      body: Buffer.concat(chunks).toString(),
    });
    if (req.url === "/redirect") {
      res.writeHead(302, { location: "/should-not-run" }).end();
      return;
    }
    if (req.url === "/slow") {
      return;
    }
    if (req.url === "/big") {
      res.end("x".repeat(1024 * 1024 + 1));
      return;
    }
    if (req.url === "/fail") {
      res.writeHead(500).end("{}");
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify(
        req.url === "/login"
          ? { token: "runtime-secret", data: { id: 42 } }
          : { ok: true, id: 42, authorization: req.headers.authorization },
      ),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await action(
      `http://127.0.0.1:${(server.address() as { port: number }).port}`,
      seen,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
test("sequential real HTTP requests capture values, interpolate auth, assert JSON, and mask results", async () =>
  fixture(async (baseUrl, seen) => {
    const s = scenario([
      step({
        name: "Login",
        method: "POST",
        url: "{{baseUrl}}/login",
        headers: { "Content-Type": "application/json" },
        body: '{"password":"{{password}}"}',
        captures: { token: "token", userId: "data.id" },
      }),
      step({
        name: "User",
        url: "{{baseUrl}}/users/{{userId}}",
        headers: { Authorization: "Bearer {{token}}" },
        checks: [{ path: "ok", equals: true }],
      }),
    ]);
    const result = await runScenario(
      s,
      { baseUrl, password: "local-password" },
      new AbortController().signal,
    );
    assert.equal(result.passed, true);
    assert.equal(seen[1].url, "/users/42");
    assert.equal(seen[1].authorization, "Bearer runtime-secret");
    assert.ok(seen[0].body.includes("local-password"));
    assert.ok(!JSON.stringify(result).includes("runtime-secret"));
    assert.ok(!JSON.stringify(result).includes("local-password"));
  }));
test("stops after assertion failure and never follows redirects", async () =>
  fixture(async (baseUrl, seen) => {
    const result = await runScenario(
      scenario([step({ url: "{{baseUrl}}/fail" }), step()]),
      { baseUrl },
      new AbortController().signal,
    );
    assert.equal(result.passed, false);
    assert.equal(seen.length, 1);
    const redirect = await runScenario(
      scenario([step({ url: "{{baseUrl}}/redirect", expectedStatus: 302 })]),
      { baseUrl },
      new AbortController().signal,
    );
    assert.equal(redirect.passed, true);
    assert.ok(!seen.some((r) => r.url === "/should-not-run"));
  }));
test("blocks missing variables before request and bounds oversized responses", async () =>
  fixture(async (baseUrl, seen) => {
    const missing = await runScenario(
      scenario([step()]),
      {},
      new AbortController().signal,
    );
    assert.equal(seen.length, 0);
    assert.match(missing.steps[0].error!, /변수/);
    const big = await runScenario(
      scenario([step({ url: "{{baseUrl}}/big" })]),
      { baseUrl },
      new AbortController().signal,
    );
    assert.equal(big.passed, false);
    assert.match(big.steps[0].error!, /1MB/);
  }));
test("cancel aborts the active request and skips remaining requests", async () =>
  fixture(async (baseUrl, seen) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 100);
    try {
      const result = await runScenario(
        scenario([step({ url: "{{baseUrl}}/slow" }), step()]),
        { baseUrl },
        controller.signal,
      );
      assert.equal(result.cancelled, true);
      assert.equal(result.passed, false);
      assert.equal(seen.length, 1);
    } finally {
      clearTimeout(timer);
    }
  }));
test("portable scenario contains only definitions, imports as a new identity, rejects foreign formats", () => {
  const original = scenario([
    step({ headers: { Authorization: "Bearer {{token}}" } }),
  ]);
  const portable = shareScenario(original);
  assert.ok(!("variables" in portable));
  const imported = parseShared(portable);
  assert.notEqual(imported.id, original.id);
  assert.notEqual(imported.steps[0].id, original.steps[0].id);
  assert.equal(imported.steps[0].headers.Authorization, "Bearer {{token}}");
  assert.throws(() =>
    parseShared({ ...portable, variables: { token: "leak" } }),
  );
  assert.throws(() => parseShared({ ...portable, version: 2 }));
  assert.throws(() => jsonPath({}, "__proto__.x"));
});
test("encrypted scenario store restores, excludes variable values, imports separately and deletes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pino-api-"));
  const key = randomBytes(32);
  const cipher = {
    isEncryptionAvailable: () => true,
    encryptString(s: string) {
      const iv = randomBytes(12);
      const c = createCipheriv("aes-256-gcm", key, iv);
      const b = Buffer.concat([c.update(s), c.final()]);
      return Buffer.concat([iv, c.getAuthTag(), b]);
    },
    decryptString(b: Buffer) {
      const d = createDecipheriv("aes-256-gcm", key, b.subarray(0, 12));
      d.setAuthTag(b.subarray(12, 28));
      return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString();
    },
  };
  try {
    const path = join(dir, "api.enc"),
      store = new ScenarioStore(path, cipher);
    await store.load();
    const s = scenario([step()]);
    await store.save({ scenario: s, variables: { token: "keep-local" } });
    assert.ok(!(await readFile(path)).includes("keep-local"));
    assert.ok(!JSON.stringify(store.list()).includes("keep-local"));
    const restored = new ScenarioStore(path, cipher);
    await restored.load();
    assert.equal(restored.get(s.id).variables.token, "keep-local");
    const imported = parseShared(shareScenario(s));
    await restored.save({ scenario: imported, variables: {} });
    assert.deepEqual(restored.get(imported.id).variables, {});
    await restored.remove(s.id);
    assert.equal(restored.list().length, 1);
    await writeFile(path, "corrupt");
    await assert.rejects(new ScenarioStore(path, cipher).load());
    assert.equal(await readFile(path, "utf8"), "corrupt");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
