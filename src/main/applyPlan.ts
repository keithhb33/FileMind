import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { App } from "electron";
import type { ApplyResult, MoveOperation, OrganizationPlan } from "../shared/types";
import { validatePlan } from "./planValidator";

type Manifest = {
  id: string;
  createdAt: string;
  operations: MoveOperation[];
  createdDirectories: string[];
  removedSourceDirectories?: string[];
};

export async function applyPlan(plan: OrganizationPlan, app: Pick<App, "getPath">): Promise<ApplyResult> {
  const validation = await validatePlan(plan);
  if (validation.validOperations.length === 0) {
    return {
      ok: false,
      movedOperations: [],
      failedOperations: validation.blockedOperations,
      message: "No safe moves were available to apply."
    };
  }

  const manifest: Manifest = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    operations: [],
    createdDirectories: []
  };
  const createdDirectories = new Set<string>();
  const failedOperations: ApplyResult["failedOperations"] = [...validation.blockedOperations];

  for (const operation of validation.validOperations) {
    const operationCreatedDirectories = await missingDirectories(path.dirname(operation.destinationPath), plan.rootPaths);
    try {
      await fs.mkdir(path.dirname(operation.destinationPath), { recursive: true });
      await fs.rename(operation.sourcePath, operation.destinationPath);
      manifest.operations.push(operation);
      for (const directory of operationCreatedDirectories) {
        createdDirectories.add(directory);
      }
    } catch (error) {
      await removeEmptyDirectories(operationCreatedDirectories);
      failedOperations.push({ operation, reason: error instanceof Error ? error.message : "Move failed" });
      break;
    }
  }

  manifest.removedSourceDirectories = await removeEmptyDirectories(sourceDirectoriesForCleanup(manifest.operations, plan.rootPaths));
  manifest.createdDirectories = [...createdDirectories];
  const manifestId = manifest.operations.length > 0 ? await writeManifest(app, manifest) : undefined;
  return {
    ok: failedOperations.length === 0,
    manifestId,
    movedOperations: manifest.operations,
    failedOperations,
    message:
      failedOperations.length === 0
        ? `Moved ${manifest.operations.length} file${manifest.operations.length === 1 ? "" : "s"}.`
        : `Moved ${manifest.operations.length} safe file${manifest.operations.length === 1 ? "" : "s"} and skipped ${failedOperations.length} blocked or failed move${failedOperations.length === 1 ? "" : "s"}.`
  };
}

export async function undoApply(manifestId: string, app: Pick<App, "getPath">): Promise<ApplyResult> {
  const manifest = await readManifest(app, manifestId);
  const movedOperations: MoveOperation[] = [];
  const failedOperations: ApplyResult["failedOperations"] = [];

  for (const operation of [...manifest.operations].reverse()) {
    const undoOperation: MoveOperation = {
      ...operation,
      sourcePath: operation.destinationPath,
      destinationPath: operation.sourcePath,
      reason: `Undo: ${operation.reason}`
    };

    try {
      await fs.mkdir(path.dirname(undoOperation.destinationPath), { recursive: true });
      await fs.rename(undoOperation.sourcePath, undoOperation.destinationPath);
      movedOperations.push(undoOperation);
    } catch (error) {
      failedOperations.push({ operation: undoOperation, reason: error instanceof Error ? error.message : "Undo failed" });
      break;
    }
  }

  if (failedOperations.length === 0) {
    await removeEmptyDirectories(manifest.createdDirectories ?? []);
  }

  return {
    ok: failedOperations.length === 0,
    manifestId,
    movedOperations,
    failedOperations,
    message:
      failedOperations.length === 0
        ? `Restored ${movedOperations.length} file${movedOperations.length === 1 ? "" : "s"}.`
        : `Undo stopped after ${movedOperations.length} restored file${movedOperations.length === 1 ? "" : "s"}.`
  };
}

async function missingDirectories(targetDirectory: string, roots: string[]): Promise<string[]> {
  const root = roots.map(normalizePath).find((candidate) => isInside(normalizePath(targetDirectory), candidate));
  if (!root) return [];

  const missing: string[] = [];
  let current = normalizePath(targetDirectory);
  while (current !== root && current.startsWith(`${root}${path.sep}`)) {
    try {
      await fs.access(current);
    } catch {
      missing.push(current);
    }
    current = path.dirname(current);
  }

  return missing.reverse();
}

async function removeEmptyDirectories(directories: string[]): Promise<string[]> {
  const removed: string[] = [];
  for (const directory of [...directories].sort((a, b) => b.length - a.length)) {
    try {
      await fs.rmdir(directory);
      removed.push(directory);
    } catch {
      // Keep folders that are not empty or cannot be removed.
    }
  }
  return removed;
}

function sourceDirectoriesForCleanup(operations: MoveOperation[], roots: string[]): string[] {
  const normalizedRoots = roots.map(normalizePath);
  const directories = new Set<string>();

  for (const operation of operations) {
    const sourceDirectory = path.dirname(operation.sourcePath);
    const root = normalizedRoots.find((candidate) => isInside(normalizePath(sourceDirectory), candidate));
    if (!root) continue;

    let current = normalizePath(sourceDirectory);
    while (current !== root && current.startsWith(`${root}${path.sep}`)) {
      directories.add(current);
      current = path.dirname(current);
    }
  }

  return [...directories];
}

function isInside(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function normalizePath(filePath: string): string {
  return path.resolve(filePath);
}

async function writeManifest(app: Pick<App, "getPath">, manifest: Manifest): Promise<string> {
  const directory = manifestDirectory(app);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, `${manifest.id}.json`), JSON.stringify(manifest, null, 2));
  return manifest.id;
}

async function readManifest(app: Pick<App, "getPath">, manifestId: string): Promise<Manifest> {
  const content = await fs.readFile(path.join(manifestDirectory(app), `${manifestId}.json`), "utf8");
  return JSON.parse(content) as Manifest;
}

function manifestDirectory(app: Pick<App, "getPath">): string {
  return path.join(app.getPath("userData"), "move-manifests");
}
