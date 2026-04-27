import { describe, expect, it } from "vitest";
import type { OrganizationPlan } from "../src/shared/types";
import { applyManualPlanMove, executableTargetForProjectedPath } from "../src/renderer/src/manualPlanEdits";

describe("manual plan edits", () => {
  it("maps projected target folders back to executable source paths", () => {
    const plan = makePlan([
      ["/root/A", "/root/Organized/A"]
    ]);

    expect(executableTargetForProjectedPath("/root/Organized/A/C", plan)).toBe("/root/A/C");
  });

  it("moves a projected child folder into another projected folder without using future paths as sources", () => {
    const plan = makePlan([
      ["/root/A", "/root/Organized/A"]
    ]);

    const nextPlan = applyManualPlanMove(
      plan,
      [{ sourcePath: "/root/A/B", projectedPath: "/root/Organized/A/B" }],
      "/root/Organized/A/C"
    );

    expect(nextPlan?.operations.map((operation) => [operation.sourcePath, operation.destinationPath])).toEqual([
      ["/root/A/B", "/root/A/C/B"],
      ["/root/A", "/root/Organized/A"]
    ]);
  });

  it("lets a manual move override an existing operation for the same source", () => {
    const plan = makePlan([
      ["/root/A/B", "/root/Projects/B"],
      ["/root/A", "/root/Organized/A"]
    ]);

    const nextPlan = applyManualPlanMove(
      plan,
      [{ sourcePath: "/root/A/B", projectedPath: "/root/Projects/B" }],
      "/root/Organized/A/C"
    );

    expect(nextPlan?.operations.map((operation) => [operation.sourcePath, operation.destinationPath])).toEqual([
      ["/root/A/B", "/root/A/C/B"],
      ["/root/A", "/root/Organized/A"]
    ]);
  });

  it("ignores selected children when their selected parent is already being moved", () => {
    const plan = makePlan([]);

    const nextPlan = applyManualPlanMove(
      plan,
      [
        { sourcePath: "/root/A", projectedPath: "/root/A" },
        { sourcePath: "/root/A/B", projectedPath: "/root/A/B" }
      ],
      "/root/C"
    );

    expect(nextPlan?.operations.map((operation) => [operation.sourcePath, operation.destinationPath])).toEqual([
      ["/root/A", "/root/C/A"]
    ]);
  });

  it("expands a virtual projected folder into real file moves", () => {
    const plan = makePlan([
      ["/root/random.js", "/root/Code/random.js"],
      ["/root/index.html", "/root/Code/index.html"],
      ["/root/report.pdf", "/root/Documents/report.pdf"]
    ]);

    const nextPlan = applyManualPlanMove(
      plan,
      [{ projectedPath: "/root/Code" }],
      "/root/Archives"
    );

    expect(nextPlan?.operations.map((operation) => [operation.sourcePath, operation.destinationPath])).toEqual([
      ["/root/random.js", "/root/Archives/Code/random.js"],
      ["/root/index.html", "/root/Archives/Code/index.html"],
      ["/root/report.pdf", "/root/Documents/report.pdf"]
    ]);
  });

  it("does not create fake source moves when a virtual folder was reported as its own source", () => {
    const plan = makePlan([
      ["/root/random.js", "/root/Code/random.js"]
    ]);

    const nextPlan = applyManualPlanMove(
      plan,
      [{ sourcePath: "/root/Code", projectedPath: "/root/Code" }],
      "/root/Archives"
    );

    expect(nextPlan?.operations.map((operation) => [operation.sourcePath, operation.destinationPath])).toEqual([
      ["/root/random.js", "/root/Archives/Code/random.js"]
    ]);
  });
});

function makePlan(operations: Array<[string, string]>): OrganizationPlan {
  return {
    id: "plan",
    rootPaths: ["/root"],
    summary: "Plan",
    rationale: "Plan rationale.",
    confidence: 0.8,
    proposedTree: [],
    generatedAt: new Date().toISOString(),
    operations: operations.map(([sourcePath, destinationPath], index) => ({
      id: `op-${index}`,
      sourcePath,
      destinationPath,
      reason: "Generated move.",
      riskLevel: "low" as const
    }))
  };
}
