import { _electron as electron } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const directory = await mkdtemp(join(tmpdir(), "pino-test-"));
let desktop;
try {
  desktop = await electron.launch({
    args: [".", `--user-data-dir=${directory}`],
    env: { ...process.env, ELECTRON_RENDERER_URL: "" },
  });
  const page = await desktop.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("heading", { name: "업무에서 코드까지." }).waitFor();
  assert.equal(await page.evaluate(() => typeof window.require), "undefined");
  assert.equal(
    await page.evaluate(() => typeof window.pino.exportContext),
    "function",
  );
  await page.getByRole("button", { name: "작업 맥락 1" }).click();
  await page
    .locator(".reference")
    .getByRole("heading", { name: "Pino · 제품 방향과 MVP" })
    .waitFor();
  const output = join(directory, "context.md");
  await desktop.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
  }, output);
  await page.getByRole("button", { name: "맥락 저장", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "작업 맥락을 저장했습니다" })
    .waitFor();
  const content = await readFile(output, "utf8");
  assert.ok(content.includes("PINO-24"));
  assert.ok(content.includes("pageId=1"));
  assert.ok(!content.includes("pageId=2"));
  await page.getByRole("button", { name: "서비스 연결", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page.getByLabel("실행 파일 / 명령").fill(process.execPath);
  await page
    .getByLabel("명령 인자 (JSON 배열)")
    .fill(JSON.stringify([resolve("tests/fixtures/mcp-server.mjs")]));
  await page
    .getByLabel("인증 값", { exact: true })
    .fill(JSON.stringify({ TOKEN: "desktop-test-secret" }));
  await page.getByLabel("검색 도구 이름").fill("jira_search");
  await page
    .getByLabel("원문 기본 주소 (결과에 URL이 없을 때)")
    .fill("https://jira.company.test");
  await page.getByRole("button", { name: "로컬에 저장", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "암호화하여 저장" })
    .waitFor();
  const state = await page.evaluate(() => window.pino.settings());
  assert.ok(!JSON.stringify(state).includes("desktop-test-secret"));
  assert.ok(
    !(await readFile(state.storagePath)).includes("desktop-test-secret"),
  );
  await page.getByRole("button", { name: "연결 테스트", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "MCP 연결 성공" }).waitFor();
  await mkdir("tmp", { recursive: true });
  await page.locator(".settings-fields").evaluate((el) => (el.scrollTop = 0));
  await page.screenshot({ path: "tmp/pino-connections.png", fullPage: true });
  await page.getByRole("button", { name: "설정 닫기" }).click();
  await page.getByRole("button", { name: "내 이슈 가져오기" }).click();
  await page
    .getByRole("heading", {
      name: "assignee = currentUser() ORDER BY updated DESC",
      exact: true,
    })
    .last()
    .waitFor();
  await page.screenshot({ path: "tmp/pino-desktop.png", fullPage: true });
  await desktop.close();
  desktop = undefined;
  desktop = await electron.launch({
    args: [".", `--user-data-dir=${directory}`],
    env: { ...process.env, ELECTRON_RENDERER_URL: "" },
  });
  const reopened = await desktop.firstWindow();
  await reopened.getByRole("heading", { name: "업무에서 코드까지." }).waitFor();
  const restored = await reopened.evaluate(() => window.pino.settings());
  assert.equal(restored.profiles[0].id, "jira");
  assert.deepEqual(restored.profiles[0].secretKeys, ["TOKEN"]);
  await reopened.evaluate(() => window.pino.deleteProfile("jira"));
  assert.equal(
    (await reopened.evaluate(() => window.pino.settings())).profiles.length,
    0,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Desktop smoke passed: sandbox, export, encrypted profile storage, MCP discovery/search, restart persistence, deletion.",
  );
} finally {
  if (desktop) await desktop.close();
  await rm(directory, { recursive: true, force: true });
}
