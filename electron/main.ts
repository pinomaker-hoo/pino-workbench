import { registerApi } from "./api-ipc";
import { app, BrowserWindow, ipcMain, dialog, safeStorage } from "electron";
import { join } from "node:path";
import { writeFile, unlink } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { contextMarkdown, exportSchema } from "./core";
import { ProfileStore, serviceSchema } from "./profiles";
import { discover, search } from "./mcp";
let win: BrowserWindow;
let store: ProfileStore;
let storageError: Error | null = null;
let repository: string | null = null;
const exec = promisify(execFile);
function handle(name: string, action: (input: any) => unknown) {
  ipcMain.handle(name, (event, input) => {
    if (
      event.sender !== win.webContents ||
      event.senderFrame !== win.webContents.mainFrame
    )
      throw new Error("Untrusted sender");
    return action(input);
  });
}
app.whenReady().then(async () => {
  store = new ProfileStore(
    join(app.getPath("userData"), "connections.enc"),
    safeStorage,
  );
  try {
    await store.load();
  } catch (error) {
    storageError = error as Error;
  }
  const settings = () => {
    if (storageError) throw storageError;
    return { profiles: store.public(), storagePath: store.path };
  };
  win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: "#101214",
    title: "Pino Workbench",
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  handle("settings", settings);
  handle("profile:save", async (input) => {
    if (storageError) throw storageError;
    await store.save(input);
    await unlink(join(app.getPath("userData"), "atlassian.enc")).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT")
          throw new Error(
            "새 설정은 저장했지만 이전 인증 파일을 삭제하지 못했습니다.",
          );
      },
    );
    return settings();
  });
  handle("profile:delete", async (id) => {
    if (storageError) throw storageError;
    await store.delete(serviceSchema.parse(id));
    return settings();
  });
  handle("profile:test", async (id) => {
    if (storageError) throw storageError;
    return discover(store.get(serviceSchema.parse(id)));
  });
  handle("issues", async (input) => {
    if (storageError) throw storageError;
    return search(store.get("jira"), z.string().min(1).max(4000).parse(input));
  });
  handle("pages", async (input) => {
    if (storageError) throw storageError;
    return search(store.get("confluence"), z.string().max(4000).parse(input));
  });
  handle("repository", async () => {
    const result = await dialog.showOpenDialog(win, {
      properties: ["openDirectory"],
      title: "Git 저장소 선택",
    });
    if (result.canceled) return null;
    const selected = result.filePaths[0];
    try {
      const { stdout } = await exec("git", [
        "-C",
        selected,
        "rev-parse",
        "--show-toplevel",
      ]);
      repository = stdout.trim();
      return repository;
    } catch {
      throw new Error("Git 저장소를 선택하세요. Git 설치도 확인해 주세요.");
    }
  });
  handle("export", async (input) => {
    const data = exportSchema.parse(input);
    const result = await dialog.showSaveDialog(win, {
      title: "작업 맥락 저장",
      defaultPath: join(
        repository || app.getPath("documents"),
        `${data.issue.key}-context.md`,
      ),
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (result.canceled || !result.filePath) return "";
    await writeFile(result.filePath, contextMarkdown(data), "utf8");
    return result.filePath;
  });
  await registerApi(win, handle);
  if (process.env.ELECTRON_RENDERER_URL)
    await win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else await win.loadFile(join(__dirname, "../dist/index.html"));
  app.on("activate", () => {
    win.show();
  });
  win.on("close", (event) => {
    if (process.platform === "darwin" && !(app as any).isQuitting) {
      event.preventDefault();
      win.hide();
    }
  });
});
app.on("before-quit", () => {
  (app as any).isQuitting = true;
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
