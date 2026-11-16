import { _electron as electron } from "@playwright/test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir = await mkdtemp(join(tmpdir(), "pino-api-ui-"));
const seen = [];
const server = createServer((req, res) => {
  seen.push({ url: req.url, auth: req.headers.authorization });
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify(
      req.url === "/login"
        ? { token: "captured-ui-token", user: { id: 17 } }
        : { ok: true },
    ),
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let app;
try {
  app = await electron.launch({
    args: [".", `--user-data-dir=${dir}`],
    env: { ...process.env, ELECTRON_RENDERER_URL: "" },
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByRole("button", { name: "API 시나리오", exact: true }).click();
  await page.getByLabel("시나리오 이름").fill("로그인 → 사용자 조회");
  await page.getByRole("button", { name: "현재 이슈", exact: true }).click();
  await page.getByLabel("요청 이름").fill("로그인");
  await page.getByLabel("HTTP 메서드").selectOption("POST");
  await page.getByLabel("요청 URL").fill("{{baseUrl}}/login");
  await page
    .getByLabel("요청 헤더")
    .fill('{"Content-Type":"application/json"}');
  await page.getByLabel("요청 본문").fill('{"password":"{{password}}"}');
  await page
    .getByLabel("응답 변수 추출")
    .fill('{"token":"token","userId":"user.id"}');
  await page.locator(".api-variables > summary").click();
  await page.getByLabel("로컬 API 변수").fill(
    JSON.stringify({
      baseUrl: `http://127.0.0.1:${server.address().port}`,
      password: "local-ui-password",
    }),
  );
  await page.getByRole("button", { name: "요청 추가", exact: true }).click();
  await page.getByLabel("요청 이름").fill("사용자 조회");
  await page.getByLabel("요청 URL").fill("{{baseUrl}}/users/{{userId}}");
  await page
    .getByLabel("요청 헤더")
    .fill('{"Authorization":"Bearer {{token}}"}');
  await page.getByLabel("응답 값 검증").fill('[{"path":"ok","equals":true}]');
  assert.equal(seen.length, 0);
  await page.getByRole("button", { name: "전체 실행", exact: true }).click();
  await page.getByRole("heading", { name: /시나리오 통과/ }).waitFor();
  assert.equal(seen.length, 2);
  assert.equal(seen[1].url, "/users/17");
  assert.equal(seen[1].auth, "Bearer captured-ui-token");
  assert.ok(
    !(await page.locator(".api-results").textContent()).includes(
      "captured-ui-token",
    ),
  );
  const localFile = join(
    await app.evaluate(({ app }) => app.getPath("userData")),
    "api-scenarios.enc",
  );
  assert.ok(!(await readFile(localFile)).includes("local-ui-password"));
  const output = join(dir, "shared.json");
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
  }, output);
  await page.getByRole("button", { name: "공유 파일", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "공유 파일 저장" })
    .waitFor();
  const exported = await readFile(output, "utf8");
  assert.ok(!exported.includes("local-ui-password"));
  assert.ok(!exported.includes("captured-ui-token"));
  assert.ok(exported.includes("PINO-24"));
  await mkdir("tmp", { recursive: true });
  await page.screenshot({ path: "tmp/pino-api.png", fullPage: true });
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [path],
    });
  }, output);
  await page.getByRole("button", { name: "가져오기", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "새 시나리오로 가져왔습니다" })
    .waitFor();
  assert.equal(seen.length, 2);
  const rows = await page.evaluate(() => window.pino.api.list());
  assert.equal(rows.length, 2);
  assert.equal(rows[1].variableNames.length, 0);
  await page.getByRole("button", { name: "전체 실행", exact: true }).click();
  await page.getByRole("heading", { name: /시나리오 실패/ }).waitFor();
  assert.equal(seen.length, 2);
  await app.close();
  app = undefined;
  app = await electron.launch({
    args: [".", `--user-data-dir=${dir}`],
    env: { ...process.env, ELECTRON_RENDERER_URL: "" },
  });
  const restored = await app.firstWindow();
  await restored
    .getByRole("button", { name: "API 시나리오", exact: true })
    .click();
  const saved = await restored.evaluate(() => window.pino.api.list());
  assert.equal(saved.length, 2);
  assert.deepEqual(saved[0].variableNames.sort(), ["baseUrl", "password"]);
  await restored
    .getByRole("button", { name: "전체 실행", exact: true })
    .click();
  await restored.getByRole("heading", { name: /시나리오 통과/ }).waitFor();
  assert.equal(seen.length, 4);
  assert.deepEqual(errors, []);
  console.log(
    "API desktop passed: authoring, real sequential requests, local encryption, sharing, safe import, restart.",
  );
} finally {
  if (app) await app.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
}
