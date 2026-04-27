import { promises as fs } from "node:fs";
import path from "node:path";
import type { MoveOperation, OrganizationPlan, PlanValidationResult } from "../shared/types";

export async function validatePlan(plan: OrganizationPlan): Promise<PlanValidationResult> {
  const warnings: string[] = [];
  const validOperations: MoveOperation[] = [];
  const blockedOperations: PlanValidationResult["blockedOperations"] = [];
  const seenDestinations = new Set<string>();
  const roots = plan.rootPaths.map((root) => path.resolve(root));

  for (const operation of plan.operations) {
    const normalizedOperation = {
      ...operation,
      id: operation.id ?? operationId(operation),
      sourcePath: path.resolve(operation.sourcePath),
      destinationPath: path.resolve(operation.destinationPath)
    };
    const blockReason = await getBlockReason(normalizedOperation, roots, seenDestinations);

    if (blockReason) {
      blockedOperations.push({ operation: normalizedOperation, reason: blockReason });
      continue;
    }

    seenDestinations.add(normalizedOperation.destinationPath);
    validOperations.push(normalizedOperation);

    if (normalizedOperation.riskLevel !== "low") {
      warnings.push(`${path.basename(normalizedOperation.sourcePath)} is marked ${normalizedOperation.riskLevel} risk.`);
    }
  }

  return { validOperations, blockedOperations, warnings };
}

async function getBlockReason(operation: MoveOperation, roots: string[], seenDestinations: Set<string>): Promise<string | undefined> {
  if (!isInsideAnyRoot(operation.sourcePath, roots)) return "Source is outside the selected directories.";
  if (!isInsideAnyRoot(operation.destinationPath, roots)) return "Destination is outside the selected directories.";
  if (roots.some((root) => path.resolve(root) === path.resolve(operation.sourcePath))) return "Selected root folders cannot be moved.";
  if (operation.sourcePath === operation.destinationPath) return "Source and destination are the same path.";
  if (seenDestinations.has(operation.destinationPath)) return "Another operation already targets this destination.";
  if (!hasValidRelativeSegments(operation.destinationPath, roots)) return "Destination contains an invalid path segment.";

  try {
    const sourceStat = await fs.lstat(operation.sourcePath);
    if (!sourceStat.isFile() && !sourceStat.isDirectory()) return "Only regular files and folders can be moved.";
    if (sourceStat.isDirectory() && isInsideDirectory(operation.destinationPath, operation.sourcePath)) {
      return "Destination is inside the source folder.";
    }
  } catch {
    return "Source does not exist or cannot be read.";
  }

  try {
    await fs.lstat(operation.destinationPath);
    return "Destination already exists.";
  } catch (error) {
    if (isNotFound(error)) return undefined;
    return "Destination cannot be checked.";
  }
}

function isInsideDirectory(candidatePath: string, directoryPath: string): boolean {
  const relative = path.relative(path.resolve(directoryPath), path.resolve(candidatePath));
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export function isInsideAnyRoot(candidate: string, roots: string[]): boolean {
  const resolvedCandidate = path.resolve(candidate);
  return roots.some((root) => {
    const resolvedRoot = path.resolve(root);
    const relative = path.relative(resolvedRoot, resolvedCandidate);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  });
}

function hasValidRelativeSegments(destinationPath: string, roots: string[]): boolean {
  const containingRoot = roots.find((root) => isInsideAnyRoot(destinationPath, [root]));
  if (!containingRoot) return false;

  const relative = path.relative(containingRoot, destinationPath);
  const segments = relative.split(path.sep).filter(Boolean);
  return segments.every((segment) => {
    if (segment === "." || segment === "..") return false;
    if (segment.includes("\0")) return false;
    return !/[<>:"|?*]/.test(segment);
  });
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function operationId(operation: MoveOperation): string {
  return Buffer.from(`${operation.sourcePath}->${operation.destinationPath}`).toString("base64url").slice(0, 18);
}
