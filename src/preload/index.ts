import { contextBridge, ipcRenderer } from "electron";
import type { DirectorySnapshot, FileMindApi, OrganizationPlan, PlanOptions, ScanOptions } from "../shared/types";

const api: FileMindApi = {
  selectDirectories: () => invoke("filemind:select-directories"),
  scanDirectories: (paths: string[], options: ScanOptions) => invoke("filemind:scan-directories", paths, options),
  listOllamaModels: () => invoke("filemind:list-ollama-models"),
  ensureLocalModels: () => invoke("filemind:ensure-local-models"),
  openInFileManager: (filePath: string) => invoke("filemind:open-in-file-manager", filePath),
  previewFile: (filePath: string) => invoke("filemind:preview-file", filePath),
  generatePlan: (snapshot: DirectorySnapshot, options: PlanOptions) => invoke("filemind:generate-plan", snapshot, options),
  validatePlan: (plan: OrganizationPlan) => invoke("filemind:validate-plan", plan),
  applyPlan: (plan: OrganizationPlan) => invoke("filemind:apply-plan", plan),
  undoApply: (manifestId: string) => invoke("filemind:undo-apply", manifestId)
};

contextBridge.exposeInMainWorld("fileMind", api);

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result = (await ipcRenderer.invoke(channel, ...args)) as { ok: true; data: T } | { ok: false; error: string };
  if (!result.ok) throw new Error(result.error);
  return result.data;
}
