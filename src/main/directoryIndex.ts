import path from "node:path";
import type { DirectorySnapshot, FileNode } from "../shared/types";

type IndexedFile = {
  path: string;
  name: string;
  folder: string;
  extension: string;
  size: number;
  textSample?: string;
  tokens: string[];
  category: string;
  score: number;
};

type CategoryProfile = {
  name: string;
  count: number;
  bytes: number;
  examples: IndexedFile[];
  topTerms: string[];
  folders: string[];
};

type ProjectProfile = {
  name: string;
  folder: string;
  count: number;
  examples: IndexedFile[];
  extensions: string[];
  terms: string[];
};

const stopWords = new Set([
  "about",
  "after",
  "again",
  "also",
  "and",
  "are",
  "because",
  "been",
  "before",
  "between",
  "from",
  "have",
  "into",
  "more",
  "that",
  "the",
  "their",
  "there",
  "this",
  "with",
  "your"
]);

const projectStopWords = new Set([
  ...stopWords,
  "copy",
  "draft",
  "final",
  "file",
  "image",
  "notes",
  "report",
  "screenshot",
  "updated",
  "version"
]);

const semanticCategories: Array<{ name: string; extensions?: string[]; pattern: RegExp }> = [
  { name: "Finance/Receipts and Invoices", pattern: /\b(invoice|receipt|statement|bank|card|payment|paid|order|purchase|tax|w2|1099)\b/i },
  { name: "Career/Resumes and Jobs", pattern: /\b(resume|curriculum|cover letter|portfolio|interview|offer|job|career)\b/i },
  { name: "School/Coursework", pattern: /\b(syllabus|assignment|homework|lecture|paper|research|citation|thesis|course|class)\b/i },
  { name: "Work/Projects", pattern: /\b(project|client|proposal|brief|meeting|roadmap|sprint|spec|requirements)\b/i },
  { name: "Personal/Recipes", pattern: /\b(recipe|ingredients|grocery|groceries|meal|cook|prep steps?)\b/i },
  { name: "Travel", pattern: /\b(trip|travel|itinerary|flight|hotel|rental car|restaurant)\b/i },
  { name: "Personal Records", pattern: /\b(passport|license|medical|insurance|lease|birth|certificate|legal|warranty)\b/i },
  { name: "Media/Screenshots", extensions: [".png", ".jpg", ".jpeg", ".webp"], pattern: /\b(screenshot|screen shot|capture)\b/i },
  { name: "Code", extensions: [".ts", ".tsx", ".js", ".jsx", ".py", ".rs", ".go", ".java", ".json", ".yaml", ".yml"], pattern: /\b(function|class|import|export|const|schema|component|async|return)\b/i }
];

export function buildRagContext(snapshot: DirectorySnapshot): string {
  const files = flattenFiles(snapshot.roots).map(indexFile);
  const projectProfiles = buildProjectProfiles(files).slice(0, 60);
  const profiles = buildCategoryProfiles(files);
  const highSignalFiles = files
    .filter((file) => file.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 220);
  const clutteredFolders = buildFolderProfiles(files).slice(0, 140);

  return [
    "Local retrieval index:",
    `Indexed files: ${files.length}. Text samples available: ${files.filter((file) => file.textSample).length}.`,
    "Project clusters to prioritize before file-type grouping:",
    projectProfiles
      .map(
        (profile) =>
          `- ${profile.name} | files:${profile.count} | suggested folder:${profile.folder} | types:${profile.extensions.join(", ")} | terms:${profile.terms.join(", ")} | examples:${profile.examples.map((file) => file.path).join(" ; ")}`
      )
      .join("\n"),
    "Category clusters:",
    profiles
      .map(
        (profile) =>
          `- ${profile.name} | files:${profile.count} | size:${profile.bytes} bytes | folders:${profile.folders.join(", ") || "n/a"} | terms:${profile.topTerms.join(", ") || "n/a"} | examples:${profile.examples.map((file) => file.path).join(" ; ")}`
      )
      .join("\n"),
    "High-signal retrieved files:",
    highSignalFiles
      .map(
        (file) =>
          `- ${file.path} | category:${file.category} | ext:${file.extension || "none"} | terms:${file.tokens.slice(0, 12).join(", ")}${file.textSample ? ` | sample:${clip(file.textSample, 240)}` : ""}`
      )
      .join("\n"),
    "Cluttered folder profiles:",
    clutteredFolders
      .map(
        (folder) =>
          `- ${folder.folder} | files:${folder.count} | types:${folder.extensions.join(", ")} | categories:${folder.categories.join(", ")}`
      )
      .join("\n")
  ].join("\n\n");
}

export function classifyFileForOrganization(node: FileNode): { folder: string; reason: string } | undefined {
  const indexed = indexFile(node);
  const projectFolder = inferProjectFolder(indexed);
  if (projectFolder) {
    return {
      folder: projectFolder,
      reason: `Grouped by shared project signals into ${projectFolder} before grouping by file type.`
    };
  }

  const semantic = semanticCategories.find((category) => {
    if (category.extensions && !category.extensions.includes(indexed.extension)) return false;
    return category.pattern.test(`${indexed.name}\n${indexed.folder}\n${indexed.textSample ?? ""}`);
  });

  if (!semantic) return undefined;

  return {
    folder: semantic.name,
    reason: indexed.textSample
      ? `Grouped by retrieved filename, folder, and content snippet signals into ${semantic.name}.`
      : `Grouped by retrieved filename and folder signals into ${semantic.name}.`
  };
}

export function inferProjectFolderForFile(node: FileNode): string | undefined {
  return inferProjectFolder(indexFile(node));
}

function buildProjectProfiles(files: IndexedFile[]): ProjectProfile[] {
  const groups = new Map<string, IndexedFile[]>();
  for (const file of files) {
    const key = inferProjectKey(file);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), file]);
  }

  return [...groups.entries()]
    .map(([key, projectFiles]) => ({
      name: titleCaseProject(key),
      folder: projectFolderFromKey(key),
      count: projectFiles.length,
      examples: projectFiles.slice(0, 8),
      extensions: topTerms(projectFiles.map((file) => file.extension || "none"), 8),
      terms: topTerms(projectFiles.flatMap((file) => file.tokens), 8)
    }))
    .filter((profile) => profile.count >= 2 || /\b(?:hw|homework|assignment|project|client)\b/i.test(profile.name))
    .sort((a, b) => b.count - a.count)
    .slice(0, 80);
}

function buildCategoryProfiles(files: IndexedFile[]): CategoryProfile[] {
  const groups = new Map<string, IndexedFile[]>();
  for (const file of files) {
    groups.set(file.category, [...(groups.get(file.category) ?? []), file]);
  }

  return [...groups.entries()]
    .map(([name, categoryFiles]) => ({
      name,
      count: categoryFiles.length,
      bytes: categoryFiles.reduce((total, file) => total + file.size, 0),
      examples: categoryFiles.sort((a, b) => b.score - a.score).slice(0, 8),
      topTerms: topTerms(categoryFiles.flatMap((file) => file.tokens), 10),
      folders: topTerms(categoryFiles.map((file) => file.folder).filter(Boolean), 6)
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 40);
}

function buildFolderProfiles(files: IndexedFile[]): Array<{ folder: string; count: number; extensions: string[]; categories: string[] }> {
  const groups = new Map<string, IndexedFile[]>();
  for (const file of files) {
    groups.set(file.folder, [...(groups.get(file.folder) ?? []), file]);
  }

  return [...groups.entries()]
    .map(([folder, folderFiles]) => ({
      folder,
      count: folderFiles.length,
      extensions: topTerms(folderFiles.map((file) => file.extension || "none"), 8),
      categories: topTerms(folderFiles.map((file) => file.category), 8)
    }))
    .sort((a, b) => b.count - a.count);
}

function indexFile(node: FileNode): IndexedFile {
  const name = path.basename(node.absolutePath);
  const extension = (node.extension || path.extname(name)).toLowerCase();
  const folder = path.dirname(node.absolutePath);
  const text = `${name} ${node.relativePath} ${node.textSample ?? ""}`;
  const tokens = tokenize(text);
  const category = inferCategory(node, extension, text);
  const score = tokens.length + (node.textSample ? 40 : 0) + (category.startsWith("Other") ? 0 : 30);

  return {
    path: node.absolutePath,
    name,
    folder,
    extension,
    size: node.size,
    textSample: node.textSample,
    tokens,
    category,
    score
  };
}

function inferCategory(node: FileNode, extension: string, text: string): string {
  const projectFolder = inferProjectFolderFromText(path.basename(node.absolutePath), path.dirname(node.absolutePath), extension, text);
  if (projectFolder) return projectFolder;

  const semantic = classifySemantic(extension, text);
  if (semantic) return semantic;

  if ([".pdf", ".txt", ".md", ".doc", ".docx", ".rtf"].includes(extension)) return "Documents";
  if ([".csv", ".xls", ".xlsx", ".ods"].includes(extension)) return "Documents/Spreadsheets";
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".heic", ".svg"].includes(extension)) return "Media/Images";
  if ([".mp4", ".mov", ".mkv", ".avi", ".webm"].includes(extension)) return "Media/Videos";
  if ([".mp3", ".wav", ".flac", ".m4a", ".aac"].includes(extension)) return "Media/Audio";
  if ([".zip", ".rar", ".7z", ".tar", ".gz"].includes(extension)) return "Archives";
  if ([".dmg", ".pkg", ".exe", ".msi", ".deb", ".rpm", ".appimage", ".iso"].includes(extension)) return "Software/Installers";
  if (extension) return `Other/${extension.slice(1).toUpperCase()} Files`;
  return "Other/No Extension";
}

function inferProjectFolder(file: IndexedFile): string | undefined {
  const key = inferProjectKey(file);
  return key ? projectFolderFromKey(key) : undefined;
}

function inferProjectKey(file: IndexedFile): string | undefined {
  return inferProjectKeyFromText(file.name, file.folder, file.extension, `${file.name} ${file.folder} ${file.textSample ?? ""}`);
}

function inferProjectFolderFromText(name: string, folder: string, extension: string, text: string): string | undefined {
  const key = inferProjectKeyFromText(name, folder, extension, text);
  return key ? projectFolderFromKey(key) : undefined;
}

function inferProjectKeyFromText(name: string, folder: string, extension: string, text: string): string | undefined {
  const haystack = `${name} ${folder} ${text}`.toLowerCase();
  const pathHaystack = `${name} ${folder}`.toLowerCase();
  const compactHaystack = haystack.replace(/[^a-z0-9]+/g, "");
  if (compactHaystack.includes("hybridapex")) return "hybrid apex";
  if (/\bapex[\s_-]*(?:match(?:[\s_-]*export)?|dashboard|tracker|stats?|export)(?:[\s_-]|\b)/i.test(haystack)) return "hybrid apex";

  const tripMatch = haystack.match(/\b([a-z][a-z]+)[\s_-]+trip(?:[\s_-]|\b)/i);
  if (tripMatch && !projectStopWords.has(tripMatch[1])) return `${tripMatch[1]} trip`;

  const directPatterns: Array<{ pattern: RegExp; source: string }> = [
    { pattern: /\b(?:hw|homework)[\s_-]*(\d{1,3}[a-z]?)\b/i, source: haystack },
    { pattern: /\bassignment[\s_-]*(\d{1,3}[a-z]?)\b/i, source: haystack },
    { pattern: /\b(hybrid)[\s_-]*(apex)\b/i, source: haystack },
    { pattern: /\b(?:project|proj)[\s_-]*([a-z0-9][a-z0-9_-]{1,30})\b/i, source: pathHaystack },
    { pattern: /\b(client)[\s_-]*([a-z0-9][a-z0-9_-]{1,30})\b/i, source: pathHaystack }
  ];

  for (const { pattern, source } of directPatterns) {
    const match = source.match(pattern);
    if (!match) continue;
    if (match[1]?.toLowerCase() === "hybrid" && match[2]?.toLowerCase() === "apex") return "hybrid apex";
    if (match[2]) return `${match[1]} ${match[2]}`;
    return pattern.source.includes("homework") || pattern.source.includes("hw") ? `homework ${match[1]}` : `${match[0]}`;
  }

  const stem = path.basename(name, extension).toLowerCase();
  const tokens = stem
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !projectStopWords.has(token));
  const meaningful =
    tokens.find((token) => /[a-z]/.test(token) && /[0-9]/.test(token)) ??
    tokens.find((token) => /\b(apex|portfolio|dashboard|client)\b/i.test(token)) ??
    tokens.find((token) => token.length >= 5 && !["package", "readme"].includes(token));
  return meaningful && /\b(project|app|site|hw|assignment|client|apex|portfolio)\b/i.test(haystack) ? meaningful : undefined;
}

function projectFolderFromKey(key: string): string {
  const homework = key.match(/^homework\s+(.+)$/i);
  if (homework) return `School/Homework/HW${homework[1].toUpperCase()}`;

  const trip = key.match(/^(.+)\s+trip$/i);
  if (trip) return `Travel/${titleCaseProject(trip[1])} Trip`;

  return `Projects/${titleCaseProject(key)}`;
}

function titleCaseProject(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b(hw)\b/i, "Homework")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function classifySemantic(extension: string, text: string): string | undefined {
  const semantic = semanticCategories.find((category) => {
    if (category.extensions && !category.extensions.includes(extension)) return false;
    return category.pattern.test(text);
  });
  return semantic?.name;
}

function flattenFiles(nodes: FileNode[]): FileNode[] {
  return nodes.flatMap((node) => (node.kind === "file" ? [node] : flattenFiles(node.children ?? [])));
}

function tokenize(text: string): string[] {
  const counts = new Map<string, number>();
  for (const token of text.toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g) ?? []) {
    if (stopWords.has(token)) continue;
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 24)
    .map(([token]) => token);
}

function topTerms(terms: string[], limit: number): string[] {
  const counts = new Map<string, number>();
  for (const term of terms) {
    if (!term) continue;
    counts.set(term, (counts.get(term) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([term]) => term);
}

function clip(value: string, length: number): string {
  return value.length > length ? `${value.slice(0, length)}...` : value;
}
