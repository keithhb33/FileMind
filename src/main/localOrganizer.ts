import path from "node:path";
import {
  OrganizationPlanSchema,
  type AiOrganizationPlan,
  type DirectorySnapshot,
  type FileNode,
  type MoveOperation,
  type OrganizationPlan
} from "../shared/types";
import { classifyFileForOrganization } from "./directoryIndex";

type ScannedFile = {
  node: FileNode;
  rootPath: string;
};

type ScannedNode = {
  node: FileNode;
  rootPath: string;
};

const maxReasonLength = 160;
const legacyOrganizedFolderName = "FileMind Organized";
const defaultRevisionFolderName = "Grouped Folders";

const categoryMatchers: Array<{
  folder: string;
  extensions: string[];
  nameHints?: RegExp;
  sampleHints?: RegExp;
}> = [
  {
    folder: "Documents/PDFs",
    extensions: [".pdf"],
    nameHints: /\b(invoice|receipt|statement|tax|resume|cv|contract|report|manual|paper|form)\b/i
  },
  {
    folder: "Documents/Notes",
    extensions: [".txt", ".md", ".rtf"],
    sampleHints: /\b(meeting|notes?|todo|summary|draft|outline)\b/i
  },
  {
    folder: "Documents/Office",
    extensions: [".doc", ".docx", ".odt", ".pages"]
  },
  {
    folder: "Documents/Spreadsheets",
    extensions: [".csv", ".xls", ".xlsx", ".ods", ".numbers"]
  },
  {
    folder: "Documents/Presentations",
    extensions: [".ppt", ".pptx", ".key"]
  },
  {
    folder: "Media/Screenshots",
    extensions: [".png", ".jpg", ".jpeg", ".webp", ".gif", ".heic", ".tiff"],
    nameHints: /\b(screenshot|screen shot|capture)\b/i
  },
  {
    folder: "Media/Images",
    extensions: [".png", ".jpg", ".jpeg", ".webp", ".gif", ".heic", ".tiff", ".svg", ".bmp"]
  },
  {
    folder: "Media/Videos",
    extensions: [".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v"]
  },
  {
    folder: "Media/Audio",
    extensions: [".mp3", ".wav", ".flac", ".m4a", ".aac", ".ogg"]
  },
  {
    folder: "Archives",
    extensions: [".zip", ".rar", ".7z", ".tar", ".gz", ".bz2", ".xz"]
  },
  {
    folder: "Software/Installers",
    extensions: [".dmg", ".pkg", ".exe", ".msi", ".deb", ".rpm", ".appimage", ".iso"]
  },
  {
    folder: "Code",
    extensions: [
      ".js",
      ".jsx",
      ".ts",
      ".tsx",
      ".py",
      ".rs",
      ".go",
      ".java",
      ".c",
      ".cpp",
      ".h",
      ".hpp",
      ".css",
      ".html",
      ".json",
      ".yaml",
      ".yml",
      ".toml",
      ".sh"
    ]
  },
  {
    folder: "Books",
    extensions: [".epub", ".mobi", ".azw3"]
  }
];

export function finalizeOrganizationPlan(
  snapshot: DirectorySnapshot,
  aiPlan: AiOrganizationPlan,
  revisionRequest?: string,
  previousPlan?: OrganizationPlan
): OrganizationPlan {
  const files = flattenScannedFiles(snapshot);
  const nodes = flattenScannedNodes(snapshot);
  const byPath = new Map(nodes.map((node) => [normalizePath(node.node.absolutePath), node]));
  const byName = buildNameIndex(nodes);
  const reservedDestinations = new Set(nodes.map((node) => normalizePath(node.node.absolutePath)));
  const repairedOperations: MoveOperation[] = [];

  for (const operation of aiPlan.operations) {
    const repaired = repairOperation(operation, snapshot, byPath, byName, reservedDestinations);
    if (repaired) repairedOperations.push(repaired);
  }

  const plannedSources = new Set(repairedOperations.map((operation) => normalizePath(operation.sourcePath)));
  const revisionOperations = buildRevisionOperations(snapshot, revisionRequest, reservedDestinations).filter((operation) => {
    const normalizedSource = normalizePath(operation.sourcePath);
    if (plannedSources.has(normalizedSource)) return false;
    plannedSources.add(normalizedSource);
    return true;
  });
  const revisionDirectedOperations = [...repairedOperations, ...revisionOperations];
  const previousOperations = revisionRequest?.trim()
    ? buildPreservedPreviousOperations(previousPlan, snapshot, byPath, byName, reservedDestinations, plannedSources)
    : [];
  const directedOperations = [...revisionDirectedOperations, ...previousOperations];
  const supplementalOperations = buildSupplementalOperations(files, directedOperations, byPath, reservedDestinations, Boolean(revisionRequest?.trim()));
  const operations = [...directedOperations, ...supplementalOperations].map((operation, index) => ({
    ...operation,
    id: operation.id ?? `op-${index + 1}`,
    reason: operation.reason.slice(0, maxReasonLength)
  }));

  const summary = buildPlanSummary(snapshot, operations, revisionRequest);
  const rationale =
    operations.length > 0
      ? `${cleanModelText(aiPlan.rationale) || "Files are grouped by type, filename hints, folder context, and available text previews."} FileMind repaired the plan against the actual scan, honored matching requested folder moves when possible, and expanded sparse category suggestions so matching files are not left behind.`
      : revisionRequest?.trim()
        ? "The AI response did not contain usable safe moves, and FileMind could not confidently translate the requested change into real scanned paths."
        : "The current directory already appears to match FileMind's local organization rules, or every possible move would be unsafe.";

  return OrganizationPlanSchema.parse({
    id: cryptoRandomId(),
    rootPaths: snapshot.selectedRoots,
    summary,
    rationale,
    confidence: Math.max(aiPlan.confidence || 0.72, repairedOperations.length > 0 ? 0.78 : 0.68),
    proposedTree: aiPlan.proposedTree,
    operations,
    generatedAt: new Date().toISOString()
  });
}

function buildSupplementalOperations(
  files: ScannedFile[],
  directedOperations: MoveOperation[],
  byPath: Map<string, ScannedNode>,
  reservedDestinations: Set<string>,
  isRevision: boolean
): MoveOperation[] {
  if (isRevision && directedOperations.length === 0) return [];
  if (directedOperations.length === 0) return buildLocalOperations(files, reservedDestinations);

  const expansionOperations = buildExpansionOperations(files, directedOperations, reservedDestinations);
  if (isRevision) return expansionOperations;

  const plannedSources = new Set([...directedOperations, ...expansionOperations].map((operation) => normalizePath(operation.sourcePath)));
  const plannedFolderSources = new Set(
    [...directedOperations, ...expansionOperations]
      .map((operation) => normalizePath(operation.sourcePath))
      .filter((sourcePath) => byPath.get(sourcePath)?.node.kind === "folder")
  );
  const movableFiles = files.filter((file) => !plannedSources.has(normalizePath(file.node.absolutePath)) && !isInsidePlannedFolder(file.node.absolutePath, plannedFolderSources));
  const plannedFileCount = files.length - movableFiles.length;
  const coverage = files.length === 0 ? 1 : plannedFileCount / files.length;

  if (coverage >= 0.72) return expansionOperations;

  const backfillOperations = buildLocalOperations(movableFiles, reservedDestinations);
  return [
    ...expansionOperations,
    ...backfillOperations.map((operation) => ({
      ...operation,
      reason: `Backfilled because the model left this scanned file outside the proposed organization. ${operation.reason}`
    }))
  ];
}

function buildPlanSummary(snapshot: DirectorySnapshot, operations: MoveOperation[], revisionRequest: string | undefined): string {
  const scanned = `Scanned ${formatCount(snapshot.counts.files)} file${snapshot.counts.files === 1 ? "" : "s"} across ${formatCount(snapshot.counts.folders)} folder${snapshot.counts.folders === 1 ? "" : "s"}`;

  if (operations.length > 0) {
    return `${scanned}. Proposed ${formatCount(operations.length)} safe move${operations.length === 1 ? "" : "s"} based on the full scan.`;
  }

  return revisionRequest?.trim()
    ? `${scanned}. No safe moves matched the requested changes.`
    : `${scanned}. No safe file moves were found.`;
}

function cleanModelText(value: string | undefined): string {
  const text = value?.trim() ?? "";
  if (!text) return "";

  return text
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !/\b(?:found|detected|saw|contains?|there (?:are|is))\b.{0,60}\b\d{1,3}\b.{0,40}\b(?:files?|folders?|directories|items?)\b/i.test(sentence))
    .join(" ")
    .trim();
}

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

function buildRevisionOperations(
  snapshot: DirectorySnapshot,
  revisionRequest: string | undefined,
  reservedDestinations: Set<string>
): MoveOperation[] {
  const request = extractUserRequest(revisionRequest);
  if (!request || !/\b(folders?|directories|combine|group|merge|put|move)\b/i.test(request)) return [];

  const folders = flattenScannedNodes(snapshot).filter(
    (item) => item.node.kind === "folder" && !isSelectedRoot(item.node.absolutePath, snapshot.selectedRoots)
  );
  const mentionedFolders = folders
    .filter((folder) => folderIsMentioned(folder.node, request))
    .sort((a, b) => b.node.absolutePath.length - a.node.absolutePath.length);

  if (mentionedFolders.length === 0) return [];

  const targetName = extractTargetFolderName(request) ?? defaultRevisionFolderName;
  return mentionedFolders.flatMap((folder) => {
    const rootPath = folder.rootPath;
    const targetDirectory = path.join(rootPath, targetName);
    const sourcePath = normalizePath(folder.node.absolutePath);
    const normalizedTargetDirectory = normalizePath(targetDirectory);
    if (sourcePath === normalizedTargetDirectory || sourcePath.startsWith(`${normalizedTargetDirectory}/`)) return [];
    if (normalizedTargetDirectory.startsWith(`${sourcePath}/`)) return [];

    const destinationPath = uniqueDestination(path.join(targetDirectory, folder.node.name), reservedDestinations);
    if (normalizePath(destinationPath) === sourcePath) return [];

    return [
      {
        sourcePath: folder.node.absolutePath,
        destinationPath,
        reason: `Requested folder consolidation into ${targetName}.`,
        riskLevel: "low" as const
      }
    ];
  });
}

function buildPreservedPreviousOperations(
  previousPlan: OrganizationPlan | undefined,
  snapshot: DirectorySnapshot,
  byPath: Map<string, ScannedNode>,
  byName: Map<string, ScannedNode[]>,
  reservedDestinations: Set<string>,
  plannedSources: Set<string>
): MoveOperation[] {
  if (!previousPlan) return [];

  return previousPlan.operations.flatMap((operation) => {
    const normalizedSource = normalizePath(operation.sourcePath);
    if (plannedSources.has(normalizedSource)) return [];

    const repaired = repairOperation(
      {
        ...operation,
        reason: operation.reason || "Preserved from the previous generated plan."
      },
      snapshot,
      byPath,
      byName,
      reservedDestinations
    );
    if (!repaired) return [];

    plannedSources.add(normalizePath(repaired.sourcePath));
    return [
      {
        ...repaired,
        reason: repaired.reason || "Preserved from the previous generated plan."
      }
    ];
  });
}

function extractUserRequest(revisionRequest: string | undefined): string {
  const trimmed = revisionRequest?.trim() ?? "";
  if (!trimmed) return "";
  const marker = "User request:";
  const markerIndex = trimmed.lastIndexOf(marker);
  return markerIndex >= 0 ? trimmed.slice(markerIndex + marker.length).trim() : trimmed;
}

function folderIsMentioned(folder: FileNode, request: string): boolean {
  const requestText = request.toLowerCase();
  const candidates = [folder.name, folder.relativePath, path.basename(folder.absolutePath)]
    .map((value) => value.toLowerCase().trim())
    .filter((value) => value.length >= 3);
  return candidates.some((candidate) => requestText.includes(candidate));
}

function extractTargetFolderName(request: string): string | undefined {
  const patterns = [
    /\b(?:folder|directory)\s+(?:called|named)\s+["']?([^"',.\n]+)["']?/i,
    /\b(?:called|named)\s+["']?([^"',.\n]+)["']?/i,
    /\binto\s+(?:one\s+)?(?:giant|big|large|single)?\s*(?:folder|directory)?\s+["']?([^"',.\n]+)["']?/i
  ];

  for (const pattern of patterns) {
    const match = request.match(pattern);
    const name = sanitizeFolderName(match?.[1] ?? "");
    if (name) return name;
  }

  return undefined;
}

function sanitizeFolderName(name: string): string {
  return name
    .replace(/\b(?:with|and|that|which|where|then|please|for|to|in|inside|under|folder|directory)\b.*$/i, "")
    .split(/[\\/]/)
    .map((segment) => segment.trim().replace(/[<>:"|?*\0]/g, ""))
    .filter(Boolean)
    .join(path.sep)
    .slice(0, 120);
}

function repairOperation(
  operation: MoveOperation,
  snapshot: DirectorySnapshot,
  byPath: Map<string, ScannedNode>,
  byName: Map<string, ScannedNode[]>,
  reservedDestinations: Set<string>
): MoveOperation | undefined {
  const source = findSourceNode(operation.sourcePath, byPath, byName);
  if (!source) return undefined;
  if (source.node.kind === "folder" && isSelectedRoot(source.node.absolutePath, snapshot.selectedRoots)) return undefined;

  const destination = chooseDestination(source, snapshot, operation.destinationPath, reservedDestinations);
  if (!destination || normalizePath(destination) === normalizePath(source.node.absolutePath)) return undefined;

  return {
    id: operation.id,
    sourcePath: source.node.absolutePath,
    destinationPath: destination,
    reason: operation.reason || `Move into ${categoryForFile(source.node).folder}.`,
    riskLevel: operation.riskLevel ?? "low"
  };
}

function buildLocalOperations(files: ScannedFile[], reservedDestinations: Set<string>): MoveOperation[] {
  return files.flatMap((file) => {
    const category = categoryForFile(file.node);
    if (isAlreadyInCategory(file.node.absolutePath, category.folder)) return [];

    const destination = uniqueDestination(path.join(file.rootPath, category.folder, file.node.name), reservedDestinations);
    if (normalizePath(destination) === normalizePath(file.node.absolutePath)) return [];

    return [
      {
        sourcePath: file.node.absolutePath,
        destinationPath: destination,
        reason: category.reason,
        riskLevel: "low"
      }
    ];
  });
}

function buildExpansionOperations(
  files: ScannedFile[],
  repairedOperations: MoveOperation[],
  reservedDestinations: Set<string>
): MoveOperation[] {
  const filesByPath = new Map(files.map((file) => [normalizePath(file.node.absolutePath), file]));
  const plannedSources = new Set(repairedOperations.map((operation) => normalizePath(operation.sourcePath)));
  const rules = repairedOperations.flatMap((operation) => {
    const source = filesByPath.get(normalizePath(operation.sourcePath));
    if (!source) return [];
    const category = categoryForFile(source.node);
    return [
      {
        rootPath: source.rootPath,
        categoryFolder: category.folder,
        destinationDirectory: path.dirname(operation.destinationPath)
      }
    ];
  });
  const uniqueRules = new Map(rules.map((rule) => [`${normalizePath(rule.rootPath)}:${rule.categoryFolder}:${normalizePath(rule.destinationDirectory)}`, rule]));

  return files.flatMap((file) => {
    if (plannedSources.has(normalizePath(file.node.absolutePath))) return [];

    const category = categoryForFile(file.node);
    const matchingRule = [...uniqueRules.values()].find(
      (rule) => normalizePath(rule.rootPath) === normalizePath(file.rootPath) && rule.categoryFolder === category.folder
    );
    if (!matchingRule) return [];

    const sourceDirectory = normalizePath(path.dirname(file.node.absolutePath));
    const targetDirectory = normalizePath(matchingRule.destinationDirectory);
    if (sourceDirectory === targetDirectory || isAlreadyInCategory(file.node.absolutePath, category.folder)) return [];

    const destination = uniqueDestination(path.join(matchingRule.destinationDirectory, file.node.name), reservedDestinations);
    if (normalizePath(destination) === normalizePath(file.node.absolutePath)) return [];

    return [
      {
        sourcePath: file.node.absolutePath,
        destinationPath: destination,
        reason: `Included with the same ${category.folder} group suggested by the model.`,
        riskLevel: "low"
      }
    ];
  });
}

function chooseDestination(
  source: ScannedNode,
  snapshot: DirectorySnapshot,
  rawDestination: string,
  reservedDestinations: Set<string>
): string | undefined {
  const root = source.rootPath;
  const sourceName = source.node.name;
  const destination = normalizePath(rawDestination);
  const sourcePath = normalizePath(source.node.absolutePath);
  if (destination === sourcePath || destinationIncludesLegacyFolder(destination)) {
    if (source.node.kind === "folder") return uniqueDestination(path.join(root, "Grouped Folders", sourceName), reservedDestinations);
    const category = categoryForFile(source.node);
    return uniqueDestination(path.join(root, category.folder, sourceName), reservedDestinations);
  }

  const selectedRoot = snapshot.selectedRoots.find((candidate) => isInside(destination, normalizePath(candidate)));

  if (selectedRoot) {
    if (source.node.kind === "folder") {
      const destinationName = path.basename(destination);
      const candidate = destinationName.toLowerCase() === sourceName.toLowerCase() ? rawDestination : path.join(rawDestination, sourceName);
      return uniqueDestination(candidate, reservedDestinations);
    }
    const parsed = path.parse(rawDestination);
    const hasFileName = Boolean(parsed.base && parsed.ext);
    const candidate = hasFileName ? rawDestination : path.join(rawDestination, sourceName);
    return uniqueDestination(candidate, reservedDestinations);
  }

  if (source.node.kind === "folder") return uniqueDestination(path.join(root, "Grouped Folders", sourceName), reservedDestinations);

  const category = categoryForFile(source.node);
  return uniqueDestination(path.join(root, category.folder, sourceName), reservedDestinations);
}

function categoryForFile(node: FileNode): { folder: string; reason: string } {
  const indexedCategory = classifyFileForOrganization(node);
  if (indexedCategory) return indexedCategory;

  const extension = (node.extension || path.extname(node.name)).toLowerCase();
  const haystack = `${node.name}\n${node.relativePath}\n${node.textSample ?? ""}`;
  const match = categoryMatchers.find((category) => {
    if (!category.extensions.includes(extension)) return false;
    if (category.nameHints && !category.nameHints.test(haystack)) return false;
    if (category.sampleHints && !category.sampleHints.test(haystack)) return false;
    return true;
  });

  const broadMatch = match ?? categoryMatchers.find((category) => category.extensions.includes(extension));
  if (broadMatch) {
    return {
      folder: broadMatch.folder,
      reason: node.textSample
        ? `Grouped by extension, filename, and text snippet context into ${broadMatch.folder}.`
        : `Grouped by extension and filename context into ${broadMatch.folder}.`
    };
  }

  return {
    folder: extension ? `Other/${extension.slice(1).toUpperCase()} Files` : "Other/No Extension",
    reason: "Grouped with less common file types so it is easier to review manually."
  };
}

function isAlreadyInCategory(filePath: string, categoryFolder: string): boolean {
  const normalized = normalizePath(filePath).toLowerCase();
  return normalized.includes(`/${categoryFolder.toLowerCase()}/`);
}

function destinationIncludesLegacyFolder(destinationPath: string): boolean {
  return normalizePath(destinationPath).toLowerCase().includes(`/${legacyOrganizedFolderName.toLowerCase()}/`);
}

function findSourceNode(sourcePath: string, byPath: Map<string, ScannedNode>, byName: Map<string, ScannedNode[]>): ScannedNode | undefined {
  const exact = byPath.get(normalizePath(sourcePath));
  if (exact) return exact;

  const sameName = byName.get(path.basename(sourcePath).toLowerCase()) ?? [];
  return sameName.length === 1 ? sameName[0] : undefined;
}

function buildNameIndex(nodes: ScannedNode[]): Map<string, ScannedNode[]> {
  const index = new Map<string, ScannedNode[]>();
  for (const node of nodes) {
    const key = node.node.name.toLowerCase();
    index.set(key, [...(index.get(key) ?? []), node]);
  }
  return index;
}

function flattenScannedFiles(snapshot: DirectorySnapshot): ScannedFile[] {
  return snapshot.roots.flatMap((root) => {
    const rootPath = root.absolutePath;
    return flattenFiles(root).map((node) => ({ node, rootPath }));
  });
}

function flattenScannedNodes(snapshot: DirectorySnapshot): ScannedNode[] {
  return snapshot.roots.flatMap((root) => flattenNodes(root).map((node) => ({ node, rootPath: root.absolutePath })));
}

function flattenNodes(node: FileNode): FileNode[] {
  return [node, ...(node.children?.flatMap((child) => flattenNodes(child)) ?? [])];
}

function flattenFiles(node: FileNode): FileNode[] {
  if (node.kind === "file") return [node];
  return node.children?.flatMap((child) => flattenFiles(child)) ?? [];
}

function uniqueDestination(candidate: string, reservedDestinations: Set<string>): string {
  const parsed = path.parse(candidate);
  let destination = candidate;
  let counter = 2;

  while (reservedDestinations.has(normalizePath(destination))) {
    destination = path.join(parsed.dir, `${parsed.name} ${counter}${parsed.ext}`);
    counter += 1;
  }

  reservedDestinations.add(normalizePath(destination));
  return destination;
}

function isInside(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(`${root}/`);
}

function isInsidePlannedFolder(filePath: string, plannedFolderSources: Set<string>): boolean {
  const normalized = normalizePath(filePath);
  return [...plannedFolderSources].some((folderPath) => normalized.startsWith(`${folderPath}/`));
}

function isSelectedRoot(candidate: string, roots: string[]): boolean {
  const normalized = normalizePath(candidate);
  return roots.some((root) => normalizePath(root) === normalized);
}

function normalizePath(filePath: string): string {
  return path.resolve(filePath).replace(/\\/g, "/").replace(/\/+$/, "");
}

function cryptoRandomId(): string {
  return `plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
