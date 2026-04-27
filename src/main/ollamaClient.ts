import path from "node:path";
import * as ollamaModule from "ollama";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  AiOrganizationPlanSchema,
  type DirectorySnapshot,
  type FileNode,
  type LocalModelInstallResult,
  type OllamaModel,
  type OrganizationPlan,
  type PlanOptions
} from "../shared/types";
import { localModelChoices, supportsThinking } from "../shared/modelRecommendations";
import { buildRagContext } from "./directoryIndex";
import { finalizeOrganizationPlan } from "./localOrganizer";
import { localSystemPrompt } from "./plannerPrompt";

type OllamaApi = {
  list: () => Promise<{ models: Array<{ name: string; size?: number; modified_at?: Date | string }> }>;
  pull: (request: unknown) => Promise<unknown>;
  chat: (request: unknown) => Promise<{ message: { content: string } }>;
};

export async function listOllamaModels(): Promise<OllamaModel[]> {
  const response = await getOllama().list();
  return response.models.map((model) => ({
    name: model.name,
    size: model.size,
    modifiedAt: model.modified_at instanceof Date ? model.modified_at.toISOString() : String(model.modified_at ?? "")
  }));
}

export async function ensureRequiredLocalModels(): Promise<LocalModelInstallResult> {
  const requiredModels = localModelChoices.map((choice) => choice.model);
  const installedBefore = await listOllamaModels();
  const installedNames = new Set(installedBefore.map((model) => model.name.toLowerCase()));
  const missingBeforePull = requiredModels.filter((model) => !installedNames.has(model.toLowerCase()));
  const pulled: string[] = [];

  for (const model of missingBeforePull) {
    await getOllama().pull({ model, stream: false });
    pulled.push(model);
  }

  const installedAfter = await listOllamaModels();
  const installedAfterNames = new Set(installedAfter.map((model) => model.name.toLowerCase()));

  return {
    installed: installedAfter.map((model) => model.name),
    pulled,
    missing: requiredModels.filter((model) => !installedAfterNames.has(model.toLowerCase()))
  };
}

export async function generateOrganizationPlan(snapshot: DirectorySnapshot, options: PlanOptions): Promise<OrganizationPlan> {
  const schema = zodToJsonSchema(AiOrganizationPlanSchema, "OrganizationPlan");
  try {
    const response = await getOllama().chat({
      model: options.model,
      stream: false,
      format: schema,
      think: supportsThinking(options.model) ? "medium" : false,
      options: {
        temperature: options.temperature,
        num_ctx: 8192,
        num_gpu: 999
      },
      messages: [
        {
          role: "system",
          content: localSystemPrompt()
        },
        {
          role: "user",
          content: buildPrompt(snapshot, options.revisionRequest)
        }
      ]
    });

    const parsed = AiOrganizationPlanSchema.parse(JSON.parse(response.message.content));
    return finalizeOrganizationPlan(snapshot, parsed, options.revisionRequest, options.previousPlan);
  } catch {
    return finalizeOrganizationPlan(snapshot, {
      summary: "Organize files with FileMind's local planner.",
      rationale:
        "The local AI response could not be used safely, so FileMind generated a deterministic local plan from real scanned paths, extensions, filenames, folder names, and available text previews.",
      confidence: 0.62,
      proposedTree: [],
      operations: []
    }, options.revisionRequest, options.previousPlan);
  }
}

function getOllama(): OllamaApi {
  const maybeModule = ollamaModule as unknown as { default?: OllamaApi } & Partial<OllamaApi>;
  const candidates = [maybeModule, maybeModule.default, (maybeModule.default as { default?: OllamaApi } | undefined)?.default];
  const client = candidates.find(isOllamaApi);

  if (!client) {
    throw new Error("Ollama client is unavailable. Confirm the local Ollama package loaded correctly.");
  }

  return client;
}

function isOllamaApi(candidate: unknown): candidate is OllamaApi {
  try {
    const possibleClient = candidate as Partial<OllamaApi> | undefined;
    return Boolean(possibleClient && typeof possibleClient.list === "function" && typeof possibleClient.pull === "function" && typeof possibleClient.chat === "function");
  } catch {
    return false;
  }
}

export function buildPrompt(snapshot: DirectorySnapshot, revisionRequest?: string): string {
  const folderSummaries = snapshot.roots.flatMap((root) => summarizeFolders(root)).slice(0, 260);
  const inventory = snapshot.roots.map((root) => serializeNode(root, 0)).join("\n");
  const ragContext = buildRagContext(snapshot);
  const trimmedRevisionRequest = revisionRequest?.trim();
  return [
    "Analyze this directory inventory and suggest a clearer organization.",
    "Highest priority: group files by the project, assignment, client, or app they belong to when filenames, parent folders, or text previews show a shared purpose. Prefer a project folder containing mixed file types over separate extension-only folders.",
    "Use file-type folders only when no meaningful project relationship is visible. Preserve file names unless a move requires a folder path, and keep every destination inside the selected roots.",
    "The app will project unchanged files locally, so proposedTree does not need to enumerate every scanned file. Focus operations on meaningful moves and folder consolidation.",
    "Use the local retrieval index first. It contains text previews and high-signal files selected from the scan.",
    "Use absolute paths exactly as provided for sourcePath and destinationPath.",
    "For folder consolidation requests, return operations for folders too: sourcePath is the existing folder path, destinationPath is the intended new folder path inside the selected root.",
    "Important: Counts below are the authoritative full scan totals. Folder summaries, retrieved files, and inventory are sampled/truncated context. Never say the directory only contains the sampled examples.",
    trimmedRevisionRequest
      ? `User-requested revision: ${trimmedRevisionRequest}\nRevise the organization plan to honor this request while keeping all moves safe and in-root.`
      : "",
    `Selected roots: ${snapshot.selectedRoots.join(", ")}`,
    `Authoritative full scan counts: ${snapshot.counts.files} files, ${snapshot.counts.folders} folders, ${snapshot.counts.bytes} bytes, ${snapshot.counts.errors} skipped/error items.`,
    ragContext,
    "Sampled folder summaries:",
    folderSummaries.join("\n"),
    "Sampled/truncated inventory:",
    inventory
  ].join("\n\n");
}

function serializeNode(node: FileNode, depth: number): string {
  if (depth > 4) return "";
  const indent = "  ".repeat(depth);
  const meta =
    node.kind === "file"
      ? ` (${node.extension || "no extension"}, ${node.size} bytes${node.textSample ? `, sample: ${node.textSample.slice(0, 180)}` : ""})`
      : "";
  const current = `${indent}- ${node.kind}: ${node.name}${meta}\n${indent}  path: ${node.absolutePath}`;
  const children = node.children?.slice(0, 80).map((child) => serializeNode(child, depth + 1)).filter(Boolean) ?? [];

  if (children.length === 0 && node.kind === "folder") {
    const fileCount = countFiles(node);
    return `${current}\n${indent}  folder: ${path.basename(node.absolutePath)}${fileCount > 0 ? `, ${fileCount} files below` : ""}`;
  }

  return [current, ...children].join("\n");
}

function summarizeFolders(node: FileNode): string[] {
  if (node.kind !== "folder") return [];

  const files = flattenFiles(node);
  const extensionCounts = new Map<string, number>();
  for (const file of files) {
    const extension = file.extension || "no extension";
    extensionCounts.set(extension, (extensionCounts.get(extension) ?? 0) + 1);
  }

  const topExtensions = [...extensionCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([extension, count]) => `${extension}:${count}`)
    .join(", ");
  const sampleFiles = files
    .slice(0, 12)
    .map((file) => path.basename(file.absolutePath))
    .join(", ");
  const children = node.children?.flatMap((child) => summarizeFolders(child)) ?? [];

  return [
    `- ${node.absolutePath} | files:${files.length} | types:${topExtensions || "none"} | samples:${sampleFiles || "none"}`,
    ...children
  ];
}

function flattenFiles(node: FileNode): FileNode[] {
  if (node.kind === "file") return [node];
  return node.children?.flatMap((child) => flattenFiles(child)) ?? [];
}

function countFiles(node: FileNode): number {
  return flattenFiles(node).length;
}
