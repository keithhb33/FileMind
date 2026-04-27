import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OrganizationPlan } from "../src/shared/types";
import { validatePlan } from "../src/main/planValidator";

let tempDir = "";

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "filemind-validate-"));
  await fs.writeFile(path.join(tempDir, "invoice.pdf"), "invoice");
  await fs.writeFile(path.join(tempDir, "photo.png"), "photo");
  await fs.mkdir(path.join(tempDir, "Project Alpha"));
  await fs.writeFile(path.join(tempDir, "Project Alpha", "notes.txt"), "notes");
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("validatePlan", () => {
  it("accepts safe moves inside the selected roots", async () => {
    const result = await validatePlan(makePlan([{ sourcePath: "invoice.pdf", destinationPath: "Documents/invoice.pdf" }]));

    expect(result.validOperations).toHaveLength(1);
    expect(result.blockedOperations).toHaveLength(0);
  });

  it("blocks traversal, overwrites, duplicate destinations, and missing files", async () => {
    await fs.mkdir(path.join(tempDir, "Documents"));
    await fs.writeFile(path.join(tempDir, "Documents", "invoice.pdf"), "existing");

    const result = await validatePlan(
      makePlan([
        { sourcePath: "invoice.pdf", destinationPath: "../outside.pdf" },
        { sourcePath: "invoice.pdf", destinationPath: "Documents/invoice.pdf" },
        { sourcePath: "invoice.pdf", destinationPath: "Media/shared.pdf" },
        { sourcePath: "photo.png", destinationPath: "Media/shared.pdf" },
        { sourcePath: "missing.txt", destinationPath: "Documents/missing.txt" }
      ])
    );

    expect(result.validOperations).toHaveLength(1);
    expect(result.blockedOperations.map((item) => item.reason)).toEqual([
      "Destination is outside the selected directories.",
      "Destination already exists.",
      "Another operation already targets this destination.",
      "Source does not exist or cannot be read."
    ]);
  });

  it("accepts folder moves and blocks moving roots or folders into themselves", async () => {
    const result = await validatePlan(
      makePlan([
        { sourcePath: "Project Alpha", destinationPath: "Archived Projects/Project Alpha" },
        { sourcePath: ".", destinationPath: "Everything" },
        { sourcePath: "Project Alpha", destinationPath: "Project Alpha/Nested/Project Alpha" }
      ])
    );

    expect(result.validOperations).toHaveLength(1);
    expect(result.validOperations[0].sourcePath).toBe(path.join(tempDir, "Project Alpha"));
    expect(result.blockedOperations.map((item) => item.reason)).toEqual([
      "Selected root folders cannot be moved.",
      "Destination is inside the source folder."
    ]);
  });
});

function makePlan(operations: Array<{ sourcePath: string; destinationPath: string }>): OrganizationPlan {
  return {
    id: "plan",
    rootPaths: [tempDir],
    summary: "Organize files",
    rationale: "Group by type",
    confidence: 0.8,
    proposedTree: [],
    generatedAt: new Date().toISOString(),
    operations: operations.map((operation, index) => ({
      id: `op-${index}`,
      sourcePath: path.join(tempDir, operation.sourcePath),
      destinationPath: path.join(tempDir, operation.destinationPath),
      reason: "Group related files.",
      riskLevel: "low"
    }))
  };
}
