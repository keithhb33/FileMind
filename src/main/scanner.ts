import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { Minimatch } from "minimatch";
import { defaultScanOptions } from "../shared/defaults";
import { DirectorySnapshotSchema, ScanOptionsSchema, type DirectorySnapshot, type FileNode, type ScanOptions } from "../shared/types";

const textExtensions = new Set([
  ".txt",
  ".md",
  ".csv",
  ".json",
  ".yaml",
  ".yml",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".css",
  ".html",
  ".xml",
  ".log",
  ".py",
  ".rs",
  ".go",
  ".java",
  ".c",
  ".cpp",
  ".h",
  ".hpp"
]);

type MutableCounts = DirectorySnapshot["counts"];

export async function scanDirectories(rawPaths: string[], rawOptions: Partial<ScanOptions>): Promise<DirectorySnapshot> {
  const scanOptions = ScanOptionsSchema.parse({ ...defaultScanOptions, ...rawOptions });
  const selectedRoots = rawPaths.map((root) => path.resolve(root));
  const ignoreMatchers = scanOptions.ignoredGlobs.map((glob) => new Minimatch(glob, { dot: true, nocase: true }));
  const counts: MutableCounts = { files: 0, folders: 0, bytes: 0, errors: 0 };

  const roots = await Promise.all(
    selectedRoots.map((rootPath) => scanNode(rootPath, rootPath, 0, scanOptions, ignoreMatchers, counts))
  );

  return DirectorySnapshotSchema.parse({
    selectedRoots,
    scanOptions,
    roots,
    counts,
    generatedAt: new Date().toISOString()
  });
}

async function scanNode(
  absolutePath: string,
  rootPath: string,
  depth: number,
  options: ScanOptions,
  ignoreMatchers: Minimatch[],
  counts: MutableCounts
): Promise<FileNode> {
  const relativePath = path.relative(rootPath, absolutePath) || path.basename(rootPath);
  const name = path.basename(absolutePath);
  const id = nodeId(rootPath, absolutePath);

  if (!options.includeHiddenFiles && isHidden(relativePath)) {
    return folderErrorNode(id, name, absolutePath, relativePath, "Hidden item skipped");
  }

  if (isIgnored(relativePath, ignoreMatchers)) {
    return folderErrorNode(id, name, absolutePath, relativePath, "Ignored by scan settings");
  }

  try {
    const stat = await fs.lstat(absolutePath);

    if (stat.isSymbolicLink()) {
      counts.errors += 1;
      return {
        id,
        name,
        absolutePath,
        relativePath,
        kind: "file",
        extension: path.extname(name).toLowerCase(),
        size: 0,
        modifiedAt: stat.mtime.toISOString(),
        createdAt: stat.birthtime.toISOString(),
        scanError: "Symbolic link skipped"
      };
    }

    if (stat.isDirectory()) {
      counts.folders += 1;
      const children: FileNode[] = [];

      if (depth < options.maxDepth) {
        try {
          const entries = await fs.readdir(absolutePath);
          const sorted = entries.sort((a, b) => a.localeCompare(b));
          for (const entry of sorted) {
            const entryPath = path.join(absolutePath, entry);
            const entryRelativePath = path.relative(rootPath, entryPath);
            if (!options.includeHiddenFiles && isHidden(entryRelativePath)) continue;
            if (isIgnored(entryRelativePath, ignoreMatchers)) continue;
            children.push(await scanNode(entryPath, rootPath, depth + 1, options, ignoreMatchers, counts));
          }
        } catch (error) {
          counts.errors += 1;
          return {
            id,
            name,
            absolutePath,
            relativePath,
            kind: "folder",
            size: 0,
            modifiedAt: stat.mtime.toISOString(),
            createdAt: stat.birthtime.toISOString(),
            children,
            scanError: errorMessage(error)
          };
        }
      }

      return {
        id,
        name,
        absolutePath,
        relativePath,
        kind: "folder",
        size: 0,
        modifiedAt: stat.mtime.toISOString(),
        createdAt: stat.birthtime.toISOString(),
        children
      };
    }

    counts.files += 1;
    counts.bytes += stat.size;
    const extension = path.extname(name).toLowerCase();
    const textSample =
      options.includeTextSnippets && textExtensions.has(extension)
        ? await readTextSample(absolutePath, options.maxSnippetBytes)
        : undefined;

    return {
      id,
      name,
      absolutePath,
      relativePath,
      kind: "file",
      extension,
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      createdAt: stat.birthtime.toISOString(),
      textSample
    };
  } catch (error) {
    counts.errors += 1;
    return folderErrorNode(id, name, absolutePath, relativePath, errorMessage(error));
  }
}

function isIgnored(relativePath: string, matchers: Minimatch[]): boolean {
  const normalized = relativePath.split(path.sep).join("/");
  return matchers.some((matcher) => matcher.match(normalized));
}

function isHidden(relativePath: string): boolean {
  return relativePath
    .split(path.sep)
    .filter(Boolean)
    .some((part) => part.startsWith("."));
}

async function readTextSample(filePath: string, maxBytes: number): Promise<string | undefined> {
  try {
    const handle = await fs.open(filePath, "r");
    try {
      const buffer = Buffer.alloc(maxBytes);
      const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
      if (buffer.subarray(0, bytesRead).includes(0)) return undefined;
      return buffer.subarray(0, bytesRead).toString("utf8").replace(/\s+/g, " ").trim();
    } finally {
      await handle.close();
    }
  } catch {
    return undefined;
  }
}

function folderErrorNode(id: string, name: string, absolutePath: string, relativePath: string, scanError: string): FileNode {
  return {
    id,
    name,
    absolutePath,
    relativePath,
    kind: "folder",
    size: 0,
    children: [],
    scanError
  };
}

function nodeId(rootPath: string, absolutePath: string): string {
  return createHash("sha1").update(`${rootPath}:${absolutePath}`).digest("hex").slice(0, 16);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown scan error";
}
