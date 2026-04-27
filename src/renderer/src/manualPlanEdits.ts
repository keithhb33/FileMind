import type { MoveOperation, OrganizationPlan } from "../../shared/types";

export type ManualMoveItem = {
  sourcePath?: string;
  projectedPath: string;
};

export function applyManualPlanMove(plan: OrganizationPlan, items: ManualMoveItem[], targetFolderPath: string): OrganizationPlan | null {
  const selectedItems = withoutNestedSelections(items);
  const executableTargetFolderPath = executableTargetForProjectedPath(targetFolderPath, plan);
  const manualOperations = selectedItems.flatMap((item) => {
    const projectedPath = normalizePath(item.projectedPath);
    const virtualChildren = operationsInsideProjectedFolder(plan, projectedPath);
    const hasConcreteSource = Boolean(item.sourcePath && normalizePath(item.sourcePath) !== projectedPath);

    if (!hasConcreteSource && virtualChildren.length > 0) {
      return virtualChildren.flatMap((operation) => {
        const sourcePath = normalizePath(operation.sourcePath);
        const relativeDestination = relativePath(projectedPath, normalizePath(operation.destinationPath));
        const destinationProjectedPath = joinPath(joinPath(targetFolderPath, basename(projectedPath)), relativeDestination);
        const targetPath = normalizePath(executableTargetForProjectedPath(destinationProjectedPath, plan));

        if (targetPath === sourcePath || targetPath.startsWith(`${sourcePath}/`)) return [];
        return [
          {
            ...operation,
            id: manualOperationId(),
            sourcePath,
            destinationPath: targetPath,
            reason: `Manually moved ${basename(projectedPath)} into ${basename(targetFolderPath)} in the After plan.`,
            riskLevel: "low" as const
          }
        ];
      });
    }

    const sourcePath = normalizePath(item.sourcePath ?? item.projectedPath);
    const destinationProjectedPath = joinPath(targetFolderPath, basename(projectedPath));
    const destinationPath = executableTargetForProjectedPath(destinationProjectedPath, plan);
    const targetPath = normalizePath(destinationPath || joinPath(executableTargetFolderPath, basename(sourcePath)));

    if (targetPath === sourcePath || targetPath.startsWith(`${sourcePath}/`)) return [];
    return [
      {
        id: manualOperationId(),
        sourcePath,
        destinationPath: targetPath,
        reason: `Manually moved into ${basename(targetFolderPath)} in the After plan.`,
        riskLevel: "low" as const
      }
    ];
  });

  if (manualOperations.length === 0) return null;

  const movedSources = new Set(manualOperations.map((operation) => normalizePath(operation.sourcePath)));
  const nextOperations = plan.operations.filter((operation) => !movedSources.has(normalizePath(operation.sourcePath)));

  return {
    ...plan,
    summary: plan.summary.includes("Manual edits applied") ? plan.summary : `${plan.summary} Manual edits applied.`,
    rationale: plan.rationale.includes("Manual edits in the After tree")
      ? plan.rationale
      : `${plan.rationale} Manual edits in the After tree are included in apply and undo.`,
    operations: [...manualOperations, ...nextOperations],
    generatedAt: new Date().toISOString()
  };
}

export function executableTargetForProjectedPath(projectedPath: string, plan: OrganizationPlan): string {
  const target = normalizePath(projectedPath);
  const containingMove = plan.operations
    .map((operation) => ({
      source: normalizePath(operation.sourcePath),
      destination: normalizePath(operation.destinationPath)
    }))
    .filter((operation) => target === operation.destination || target.startsWith(`${operation.destination}/`))
    .sort((a, b) => b.destination.length - a.destination.length)[0];

  if (!containingMove) return projectedPath;

  const relative = target === containingMove.destination ? "" : target.slice(containingMove.destination.length + 1);
  return relative ? joinPath(containingMove.source, relative) : containingMove.source;
}

function operationsInsideProjectedFolder(plan: OrganizationPlan, projectedPath: string): MoveOperation[] {
  return plan.operations.filter((operation) => {
    const destinationPath = normalizePath(operation.destinationPath);
    return destinationPath.startsWith(`${projectedPath}/`);
  });
}

function withoutNestedSelections(items: ManualMoveItem[]): ManualMoveItem[] {
  const unique = new Map<string, ManualMoveItem>();
  for (const item of items) {
    unique.set(normalizePath(item.projectedPath), {
      sourcePath: item.sourcePath ? normalizePath(item.sourcePath) : undefined,
      projectedPath: normalizePath(item.projectedPath)
    });
  }

  return [...unique.values()]
    .sort((a, b) => a.projectedPath.length - b.projectedPath.length)
    .filter((candidate, index, all) => !all.slice(0, index).some((parent) => candidate.projectedPath.startsWith(`${parent.projectedPath}/`)));
}

function basename(filePath: string): string {
  return filePath.split(/[\\/]/).at(-1) ?? filePath;
}

function joinPath(folderPath: string, name: string): string {
  if (!name) return normalizePath(folderPath);
  const separator = folderPath.includes("\\") && !folderPath.includes("/") ? "\\" : "/";
  return `${folderPath.replace(/[\\/]+$/, "")}${separator}${name}`;
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/\/+$/, "");
}

function relativePath(parentPath: string, childPath: string): string {
  const parent = normalizePath(parentPath);
  const child = normalizePath(childPath);
  return child === parent ? "" : child.slice(parent.length + 1);
}

function manualOperationId(): string {
  return `manual-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
