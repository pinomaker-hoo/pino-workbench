import { app, dialog, safeStorage, BrowserWindow } from "electron";
import { join } from "node:path";
import { readFile, writeFile, stat } from "node:fs/promises";
import {
  ScenarioStore,
  parseShared,
  shareScenario,
  runScenario,
} from "./api-scenarios";
export async function registerApi(
  win: BrowserWindow,
  handle: (name: string, action: (input: any) => unknown) => void,
) {
  const store = new ScenarioStore(
    join(app.getPath("userData"), "api-scenarios.enc"),
    safeStorage,
  );
  let loadError: unknown;
  try {
    await store.load();
  } catch (e) {
    loadError = e;
  }
  function ready() {
    if (loadError) throw loadError;
  }
  let controller: AbortController | undefined;
  handle("api:list", () => {
    ready();
    return store.list();
  });
  handle("api:save", (input) => {
    ready();
    return store.save(input);
  });
  handle("api:remove", (id) => {
    ready();
    return store.remove(id);
  });
  handle("api:run", async (id) => {
    ready();
    if (controller) throw new Error("이미 실행 중인 시나리오가 있습니다.");
    const row = store.get(id);
    controller = new AbortController();
    try {
      return await runScenario(row.scenario, row.variables, controller.signal);
    } finally {
      controller = undefined;
    }
  });
  handle("api:cancel", () => {
    controller?.abort();
  });
  handle("api:export", async (id) => {
    ready();
    const row = store.get(id);
    const output = await dialog.showSaveDialog(win, {
      title: "API 시나리오 공유 파일 저장",
      defaultPath: join(app.getPath("documents"), "scenario.pino-api.json"),
      filters: [{ name: "Pino API scenario", extensions: ["json"] }],
    });
    if (output.canceled || !output.filePath) return "";
    await writeFile(
      output.filePath,
      JSON.stringify(shareScenario(row.scenario), null, 2) + "\n",
    );
    return output.filePath;
  });
  handle("api:import", async () => {
    ready();
    const input = await dialog.showOpenDialog(win, {
      title: "API 시나리오 가져오기",
      properties: ["openFile"],
      filters: [{ name: "Pino API scenario", extensions: ["json"] }],
    });
    if (input.canceled) return null;
    const path = input.filePaths[0];
    if ((await stat(path)).size > 2 * 1024 * 1024)
      throw new Error("시나리오 파일은 2MB 이하여야 합니다.");
    let scenario;
    try {
      scenario = parseShared(JSON.parse(await readFile(path, "utf8")));
    } catch {
      throw new Error("지원하는 Pino API 시나리오 v1 파일이 아닙니다.");
    }
    await store.save({ scenario, variables: {} });
    return { scenario, variableNames: [] };
  });
  app.on("before-quit", () => controller?.abort());
}
