import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultScanOptions } from "../src/shared/defaults";
import { scanDirectories } from "../src/main/scanner";
import type { FileNode } from "../src/shared/types";

let tempDir = "";

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "filemind-scan-"));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("scanDirectories", () => {
  it("scans nested folders, metadata, and optional text snippets", async () => {
    await fs.mkdir(path.join(tempDir, "loose"), { recursive: true });
    await fs.writeFile(path.join(tempDir, "loose", "notes.md"), "# Notes\nLocal project ideas");
    await fs.writeFile(path.join(tempDir, "photo.jpg"), Buffer.from([1, 2, 3]));

    const snapshot = await scanDirectories([tempDir], {
      ...defaultScanOptions,
      includeTextSnippets: true
    });

    expect(snapshot.counts.files).toBe(2);
    expect(snapshot.counts.folders).toBe(2);
    expect(snapshot.roots[0].children?.some((node) => node.name === "photo.jpg")).toBe(true);

    const notes = snapshot.roots[0].children?.find((node) => node.name === "loose")?.children?.find((node) => node.name === "notes.md");
    expect(notes?.textSample).toContain("Local project ideas");
  });

  it("scans beyond the old fixed depth limit by default", async () => {
    let current = tempDir;
    for (let index = 0; index < 15; index += 1) {
      current = path.join(current, `level-${index}`);
      await fs.mkdir(current);
    }
    await fs.writeFile(path.join(current, "deep-note.txt"), "deep file");

    const snapshot = await scanDirectories([tempDir], defaultScanOptions);

    expect(snapshot.counts.files).toBe(1);
    expect(findNode(snapshot.roots[0], "deep-note.txt")?.absolutePath).toBe(path.join(current, "deep-note.txt"));
  });

  it("can skip hidden files and ignored globs", async () => {
    await fs.mkdir(path.join(tempDir, ".git"), { recursive: true });
    await fs.writeFile(path.join(tempDir, ".secret"), "hidden");
    await fs.writeFile(path.join(tempDir, ".git", "config"), "ignored");
    await fs.writeFile(path.join(tempDir, "visible.txt"), "ok");

    const snapshot = await scanDirectories([tempDir], { ...defaultScanOptions, includeHiddenFiles: false });

    expect(snapshot.counts.files).toBe(1);
    expect(snapshot.roots[0].children?.map((node) => node.name)).toEqual(["visible.txt"]);
  });

  it("reports symbolic links without following them", async () => {
    await fs.writeFile(path.join(tempDir, "target.txt"), "target");
    await fs.symlink(path.join(tempDir, "target.txt"), path.join(tempDir, "link.txt"));

    const snapshot = await scanDirectories([tempDir], defaultScanOptions);

    expect(snapshot.counts.errors).toBe(1);
    expect(snapshot.roots[0].children?.find((node) => node.name === "link.txt")?.scanError).toBe("Symbolic link skipped");
  });
});

function findNode(node: FileNode, name: string): FileNode | undefined {
  if (node.name === name) return node;
  for (const child of node.children ?? []) {
    const match = findNode(child, name);
    if (match) return match;
  }
  return undefined;
}
