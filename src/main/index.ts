import { app, BrowserWindow, dialog, ipcMain, Menu, shell, type IpcMainInvokeEvent } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { applyPlan, undoApply } from "./applyPlan";
import { ensureRequiredLocalModels, generateOrganizationPlan, listOllamaModels } from "./ollamaClient";
import { validatePlan } from "./planValidator";
import { scanDirectories } from "./scanner";
import { DirectorySnapshotSchema, OrganizationPlanSchema, PlanOptionsSchema, ScanOptionsSchema } from "../shared/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const previewMimeTypes = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".bmp", "image/bmp"],
  [".svg", "image/svg+xml"]
]);
const maxPreviewBytes = 25 * 1024 * 1024;

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1040,
    minHeight: 720,
    title: "FileMind",
    backgroundColor: "#f7f7f4",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.removeMenu();
  restrictProductionInspection(mainWindow);

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  app.setName("FileMind");
  Menu.setApplicationMenu(null);
  registerIpc();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

function restrictProductionInspection(mainWindow: BrowserWindow): void {
  if (!app.isPackaged) return;

  mainWindow.webContents.on("before-input-event", (event, input) => {
    const key = input.key.toLowerCase();
    if (
      key === "f12" ||
      (input.control && input.shift && key === "i") ||
      (input.meta && input.alt && key === "i")
    ) {
      event.preventDefault();
    }
  });

  mainWindow.webContents.on("devtools-opened", () => {
    mainWindow.webContents.closeDevTools();
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

function registerIpc(): void {
  safeHandle("filemind:select-directories", async () => {
    const result = await dialog.showOpenDialog({
      title: "Select directories for FileMind",
      properties: ["openDirectory", "multiSelections", "createDirectory"]
    });
    return result.canceled ? [] : result.filePaths;
  });

  safeHandle("filemind:scan-directories", async (paths: string[], options: unknown) => scanDirectories(paths, ScanOptionsSchema.parse(options)));

  safeHandle("filemind:list-ollama-models", async () => listOllamaModels());

  safeHandle("filemind:ensure-local-models", async () => ensureRequiredLocalModels());

  safeHandle("filemind:open-in-file-manager", async (filePath: string) => {
    await fs.access(filePath);
    shell.showItemInFolder(filePath);
  });

  safeHandle("filemind:preview-file", async (filePath: string) => {
    const extension = path.extname(filePath).toLowerCase();
    const mimeType = previewMimeTypes.get(extension);
    if (!mimeType) throw new Error("FileMind can preview image files only.");

    const stats = await fs.stat(filePath);
    if (!stats.isFile()) throw new Error("Only files can be previewed.");
    if (stats.size > maxPreviewBytes) throw new Error("This image is too large to preview inside FileMind.");

    const data = await fs.readFile(filePath);
    return {
      kind: "image" as const,
      path: filePath,
      name: path.basename(filePath),
      size: stats.size,
      dataUrl: `data:${mimeType};base64,${data.toString("base64")}`
    };
  });

  safeHandle("filemind:generate-plan", async (snapshot: unknown, options: unknown) =>
    generateOrganizationPlan(DirectorySnapshotSchema.parse(snapshot), PlanOptionsSchema.parse(options))
  );

  safeHandle("filemind:validate-plan", async (plan: unknown) => validatePlan(OrganizationPlanSchema.parse(plan)));

  safeHandle("filemind:apply-plan", async (plan: unknown) => applyPlan(OrganizationPlanSchema.parse(plan), app));

  safeHandle("filemind:undo-apply", async (manifestId: string) => undoApply(manifestId, app));
}

function safeHandle<TArgs extends unknown[], TResult>(
  channel: string,
  handler: (...args: TArgs) => Promise<TResult> | TResult
): void {
  ipcMain.handle(channel, async (_event: IpcMainInvokeEvent, ...args: TArgs) => {
    try {
      return { ok: true, data: await handler(...args) };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  });
}

function errorMessage(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues.map((issue) => `${issue.path.join(".") || "request"}: ${issue.message}`).join("; ");
  }
  if (error instanceof Error) return error.message;
  return "Unexpected FileMind error.";
}
