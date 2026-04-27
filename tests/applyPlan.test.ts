import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OrganizationPlan } from "../src/shared/types";
import { applyPlan, undoApply } from "../src/main/applyPlan";

let tempDir = "";
let userDataDir = "";

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "filemind-apply-"));
  userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "filemind-user-data-"));
  await fs.writeFile(path.join(tempDir, "resume.pdf"), "resume");
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
  await fs.rm(userDataDir, { recursive: true, force: true });
});

describe("applyPlan", () => {
  it("moves files, writes a manifest, and can undo the move", async () => {
    const app = { getPath: () => userDataDir };
    const plan = makePlan();

    const applyResult = await applyPlan(plan, app);
    expect(applyResult.ok).toBe(true);
    expect(applyResult.manifestId).toBeTruthy();
    await expect(fs.access(path.join(tempDir, "Documents", "resume.pdf"))).resolves.toBeUndefined();

    const undoResult = await undoApply(applyResult.manifestId!, app);
    expect(undoResult.ok).toBe(true);
    await expect(fs.access(path.join(tempDir, "resume.pdf"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(tempDir, "Documents"))).rejects.toThrow();
  });

  it("does not apply when validation blocks an operation", async () => {
    const app = { getPath: () => userDataDir };
    const plan = makePlan("../outside.pdf");

    const result = await applyPlan(plan, app);

    expect(result.ok).toBe(false);
    expect(result.movedOperations).toHaveLength(0);
    await expect(fs.access(path.join(tempDir, "resume.pdf"))).resolves.toBeUndefined();
  });

  it("applies safe moves while reporting blocked moves as skipped", async () => {
    await fs.writeFile(path.join(tempDir, "photo.png"), "photo");
    const app = { getPath: () => userDataDir };
    const plan = makePlan("Documents/resume.pdf");
    plan.operations.push({
      id: "bad-move",
      sourcePath: path.join(tempDir, "photo.png"),
      destinationPath: path.join(tempDir, "..", "outside.png"),
      reason: "Bad destination.",
      riskLevel: "low"
    });

    const result = await applyPlan(plan, app);

    expect(result.ok).toBe(false);
    expect(result.movedOperations).toHaveLength(1);
    expect(result.failedOperations).toHaveLength(1);
    await expect(fs.access(path.join(tempDir, "Documents", "resume.pdf"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(tempDir, "photo.png"))).resolves.toBeUndefined();
  });

  it("moves folders, writes a manifest, and restores them on undo", async () => {
    await fs.mkdir(path.join(tempDir, "Project Alpha"));
    await fs.writeFile(path.join(tempDir, "Project Alpha", "notes.txt"), "notes");
    const app = { getPath: () => userDataDir };
    const plan = makePlan("Projects/Project Alpha");
    plan.operations[0].sourcePath = path.join(tempDir, "Project Alpha");

    const applyResult = await applyPlan(plan, app);
    expect(applyResult.ok).toBe(true);
    await expect(fs.access(path.join(tempDir, "Projects", "Project Alpha", "notes.txt"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(tempDir, "Project Alpha"))).rejects.toThrow();

    const undoResult = await undoApply(applyResult.manifestId!, app);
    expect(undoResult.ok).toBe(true);
    await expect(fs.access(path.join(tempDir, "Project Alpha", "notes.txt"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(tempDir, "Projects"))).rejects.toThrow();
  });

  it("removes source folders that become empty and restores them on undo", async () => {
    await fs.mkdir(path.join(tempDir, "random downloads"));
    await fs.writeFile(path.join(tempDir, "random downloads", "receipt.txt"), "receipt");
    const app = { getPath: () => userDataDir };
    const plan = makePlan("Finance/receipt.txt");
    plan.operations[0].sourcePath = path.join(tempDir, "random downloads", "receipt.txt");

    const applyResult = await applyPlan(plan, app);
    expect(applyResult.ok).toBe(true);
    await expect(fs.access(path.join(tempDir, "Finance", "receipt.txt"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(tempDir, "random downloads"))).rejects.toThrow();

    const undoResult = await undoApply(applyResult.manifestId!, app);
    expect(undoResult.ok).toBe(true);
    await expect(fs.access(path.join(tempDir, "random downloads", "receipt.txt"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(tempDir, "Finance"))).rejects.toThrow();
  });
});

function makePlan(destination = "Documents/resume.pdf"): OrganizationPlan {
  return {
    id: "plan",
    rootPaths: [tempDir],
    summary: "Organize documents",
    rationale: "Move documents into a named folder.",
    confidence: 0.9,
    proposedTree: [],
    generatedAt: new Date().toISOString(),
    operations: [
      {
        id: "move-resume",
        sourcePath: path.join(tempDir, "resume.pdf"),
        destinationPath: path.join(tempDir, destination),
        reason: "This is a document.",
        riskLevel: "low"
      }
    ]
  };
}
