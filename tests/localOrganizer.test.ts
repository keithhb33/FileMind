import { describe, expect, it } from "vitest";
import type { AiOrganizationPlan, DirectorySnapshot } from "../src/shared/types";
import { finalizeOrganizationPlan } from "../src/main/localOrganizer";

describe("finalizeOrganizationPlan", () => {
  it("repairs same-path and outside-root AI moves into safe local destinations", () => {
    const plan = finalizeOrganizationPlan(makeSnapshot(), {
      summary: "Organize downloads",
      rationale: "Group related files.",
      confidence: 0.7,
      proposedTree: [],
      operations: [
        {
          sourcePath: "/Users/me/Downloads/report.pdf",
          destinationPath: "/Users/me/Downloads/report.pdf",
          reason: "No-op from model.",
          riskLevel: "low"
        },
        {
          sourcePath: "/tmp/outside/photo.png",
          destinationPath: "/tmp/outside/Images/photo.png",
          reason: "Outside-root destination from model.",
          riskLevel: "low"
        }
      ]
    });

    expect(plan.operations).toHaveLength(2);
    expect(plan.operations[0].destinationPath).toBe("/Users/me/Downloads/Work/Projects/report.pdf");
    expect(plan.operations[1].sourcePath).toBe("/Users/me/Downloads/photo.png");
    expect(plan.operations[1].destinationPath).toBe("/Users/me/Downloads/Media/Images/photo.png");
  });

  it("creates a deterministic local organization plan when the AI returns no usable moves", () => {
    const plan = finalizeOrganizationPlan(makeSnapshot(), emptyAiPlan());

    expect(plan.operations.map((operation) => operation.destinationPath)).toEqual([
      "/Users/me/Downloads/Work/Projects/report.pdf",
      "/Users/me/Downloads/Media/Images/photo.png"
    ]);
  });

  it("rewrites legacy FileMind Organized destinations into direct source folders", () => {
    const plan = finalizeOrganizationPlan(makeSnapshot(), {
      summary: "Organize downloads",
      rationale: "Group related files.",
      confidence: 0.7,
      proposedTree: [],
      operations: [
        {
          sourcePath: "/Users/me/Downloads/photo.png",
          destinationPath: "/Users/me/Downloads/FileMind Organized/Images/photo.png",
          reason: "Legacy destination.",
          riskLevel: "low"
        }
      ]
    });

    expect(plan.operations[0].destinationPath).toBe("/Users/me/Downloads/Media/Images/photo.png");
  });

  it("expands sparse AI category moves to similar unplanned files", () => {
    const plan = finalizeOrganizationPlan(makeImageSnapshot(), {
      summary: "Make an Images folder",
      rationale: "A few images belong together.",
      confidence: 0.82,
      proposedTree: [],
      operations: [
        {
          sourcePath: "/Users/me/Downloads/photo-1.jpg",
          destinationPath: "/Users/me/Downloads/Media/Images/photo-1.jpg",
          reason: "Group image files.",
          riskLevel: "low"
        }
      ]
    });

    expect(plan.operations.map((operation) => operation.destinationPath)).toEqual([
      "/Users/me/Downloads/Media/Images/photo-1.jpg",
      "/Users/me/Downloads/Media/Images/photo-2.jpeg",
      "/Users/me/Downloads/Media/Images/photo-3.png"
    ]);
  });

  it("keeps AI folder consolidation moves instead of converting them into file-only moves", () => {
    const plan = finalizeOrganizationPlan(makeFolderSnapshot(), {
      summary: "Group old project folders",
      rationale: "The requested folders belong inside one larger archive folder.",
      confidence: 0.86,
      proposedTree: [],
      operations: [
        {
          sourcePath: "/Users/me/Downloads/Project Alpha",
          destinationPath: "/Users/me/Downloads/Archived Projects",
          reason: "Requested folder consolidation.",
          riskLevel: "low"
        }
      ]
    });

    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0].sourcePath).toBe("/Users/me/Downloads/Project Alpha");
    expect(plan.operations[0].destinationPath).toBe("/Users/me/Downloads/Archived Projects/Project Alpha");
  });

  it("translates requested folder grouping when the AI returns no usable operations", () => {
    const plan = finalizeOrganizationPlan(
      makeFolderSnapshot(),
      emptyAiPlan(),
      "User request: Put Project Alpha and Project Beta into a folder named Client Archive."
    );

    expect(plan.operations.map((operation) => operation.destinationPath)).toEqual([
      "/Users/me/Downloads/Client Archive/Project Alpha",
      "/Users/me/Downloads/Client Archive/Project Beta"
    ]);
  });

  it("does not replace an unparseable revision request with unrelated local organization moves", () => {
    const plan = finalizeOrganizationPlan(makeSnapshot(), emptyAiPlan(), "User request: Make this closer to what I said earlier.");

    expect(plan.operations).toHaveLength(0);
    expect(plan.summary).toBe("Scanned 2 files across 1 folder. No safe moves matched the requested changes.");
  });

  it("preserves previous generated moves when a revision only returns one extra change", () => {
    const previousPlan = makePreviousPlan([
      { sourcePath: "/Users/me/Downloads/report.pdf", destinationPath: "/Users/me/Downloads/Work/Projects/report.pdf" }
    ]);
    const plan = finalizeOrganizationPlan(
      makeSnapshot(),
      {
        summary: "Add an image folder.",
        rationale: "The user asked for one additional change.",
        confidence: 0.8,
        proposedTree: [],
        operations: [
          {
            sourcePath: "/Users/me/Downloads/photo.png",
            destinationPath: "/Users/me/Downloads/Media/Images/photo.png",
            reason: "Requested image grouping.",
            riskLevel: "low"
          }
        ]
      },
      "User request: Also put the photo in Images.",
      previousPlan
    );

    expect(plan.operations.map((operation) => operation.destinationPath)).toEqual([
      "/Users/me/Downloads/Media/Images/photo.png",
      "/Users/me/Downloads/Work/Projects/report.pdf"
    ]);
  });

  it("lets revised moves override previous moves for the same source", () => {
    const previousPlan = makePreviousPlan([
      { sourcePath: "/Users/me/Downloads/report.pdf", destinationPath: "/Users/me/Downloads/Work/Projects/report.pdf" },
      { sourcePath: "/Users/me/Downloads/photo.png", destinationPath: "/Users/me/Downloads/Media/Images/photo.png" }
    ]);
    const plan = finalizeOrganizationPlan(
      makeSnapshot(),
      {
        summary: "Move the report somewhere different.",
        rationale: "The user changed the destination for the report.",
        confidence: 0.8,
        proposedTree: [],
        operations: [
          {
            sourcePath: "/Users/me/Downloads/report.pdf",
            destinationPath: "/Users/me/Downloads/Documents/PDFs/report.pdf",
            reason: "Requested report regrouping.",
            riskLevel: "low"
          }
        ]
      },
      "User request: Put report.pdf in PDFs instead.",
      previousPlan
    );

    expect(plan.operations.map((operation) => operation.destinationPath)).toEqual([
      "/Users/me/Downloads/Documents/PDFs/report.pdf",
      "/Users/me/Downloads/Media/Images/photo.png"
    ]);
  });

  it("uses authoritative scan counts instead of misleading model totals", () => {
    const snapshot = {
      ...makeSnapshot(),
      counts: { files: 9684, folders: 80, bytes: 1_200_000_000, errors: 0 }
    };
    const plan = finalizeOrganizationPlan(snapshot, {
      summary: "Found 10 files/folders in Downloads.",
      rationale: "Detected 10 files and folders from the provided inventory. Grouping by project type.",
      confidence: 0.7,
      proposedTree: [],
      operations: [
        {
          sourcePath: "/Users/me/Downloads/photo.png",
          destinationPath: "/Users/me/Downloads/Media/Images/photo.png",
          reason: "Group image files.",
          riskLevel: "low"
        }
      ]
    });

    expect(plan.summary).toBe("Scanned 9,684 files across 80 folders. Proposed 2 safe moves based on the full scan.");
    expect(plan.rationale).not.toContain("Detected 10");
    expect(plan.rationale).toContain("Grouping by project type.");
  });

  it("prioritizes project grouping over extension folders in local fallback", () => {
    const plan = finalizeOrganizationPlan(makeProjectFilesSnapshot(), emptyAiPlan());

    expect(plan.operations.map((operation) => operation.destinationPath)).toEqual([
      "/Users/me/Downloads/School/Homework/HW6/HW6_index.html",
      "/Users/me/Downloads/School/Homework/HW6/HW6_styles.css",
      "/Users/me/Downloads/School/Homework/HW6/HW6_script.js"
    ]);
  });

  it("backfills sparse weak-model plans with project-aware local organization", () => {
    const plan = finalizeOrganizationPlan(makeClutterSnapshot(), {
      summary: "Create generic folders.",
      rationale: "The model grouped a few files but missed most of the clutter.",
      confidence: 0.62,
      proposedTree: [],
      operations: [
        {
          sourcePath: "/Users/me/Desktop/FileMind-Test-Clutter/Screenshot 2026-04-26 at 8.12.44 PM.png",
          destinationPath: "/Users/me/Desktop/FileMind-Test-Clutter/Media/Images/Screenshot 2026-04-26 at 8.12.44 PM.png",
          reason: "Group images.",
          riskLevel: "low"
        }
      ]
    });

    expect(plan.operations.map((operation) => operation.destinationPath)).toEqual(
      expect.arrayContaining([
        "/Users/me/Desktop/FileMind-Test-Clutter/Media/Images/Screenshot 2026-04-26 at 8.12.44 PM.png",
        "/Users/me/Desktop/FileMind-Test-Clutter/Finance/Receipts and Invoices/invoice_Jan_2026.txt",
        "/Users/me/Desktop/FileMind-Test-Clutter/Projects/Hybrid Apex/package-hybrid-apex.json",
        "/Users/me/Desktop/FileMind-Test-Clutter/Projects/Hybrid Apex/README_HybridApex.md",
        "/Users/me/Desktop/FileMind-Test-Clutter/Projects/Hybrid Apex/apex_match_export.csv",
        "/Users/me/Desktop/FileMind-Test-Clutter/School/Homework/HW6/HW6_demo.html",
        "/Users/me/Desktop/FileMind-Test-Clutter/School/Homework/HW6/hw6_solution.py",
        "/Users/me/Desktop/FileMind-Test-Clutter/Travel/Denver Trip/denver_trip_1.jpg",
        "/Users/me/Desktop/FileMind-Test-Clutter/Personal/Recipes/chili_recipe.txt"
      ])
    );
    expect(plan.operations.length).toBeGreaterThan(8);
  });
});

function emptyAiPlan(): AiOrganizationPlan {
  return {
    summary: "No changes",
    rationale: "No changes suggested.",
    confidence: 0.5,
    proposedTree: [],
    operations: []
  };
}

function makePreviousPlan(operations: Array<{ sourcePath: string; destinationPath: string }>) {
  return {
    id: "previous-plan",
    rootPaths: ["/Users/me/Downloads"],
    summary: "Previous generated plan.",
    rationale: "Existing generated organization.",
    confidence: 0.82,
    proposedTree: [],
    generatedAt: new Date().toISOString(),
    operations: operations.map((operation, index) => ({
      id: `previous-op-${index}`,
      sourcePath: operation.sourcePath,
      destinationPath: operation.destinationPath,
      reason: "Previous generated move.",
      riskLevel: "low" as const
    }))
  };
}

function makeSnapshot(): DirectorySnapshot {
  return {
    selectedRoots: ["/Users/me/Downloads"],
    scanOptions: {
      maxDepth: 5,
      ignoredGlobs: [],
      includeHiddenFiles: false,
      includeTextSnippets: true,
      maxSnippetBytes: 1200
    },
    roots: [
      {
        id: "root",
        name: "Downloads",
        absolutePath: "/Users/me/Downloads",
        relativePath: "Downloads",
        kind: "folder",
        size: 0,
        children: [
          {
            id: "report",
            name: "report.pdf",
            absolutePath: "/Users/me/Downloads/report.pdf",
            relativePath: "report.pdf",
            kind: "file",
            extension: ".pdf",
            size: 100,
            textSample: "Quarterly report for client project milestones"
          },
          {
            id: "photo",
            name: "photo.png",
            absolutePath: "/Users/me/Downloads/photo.png",
            relativePath: "photo.png",
            kind: "file",
            extension: ".png",
            size: 100
          }
        ]
      }
    ],
    counts: { files: 2, folders: 1, bytes: 200, errors: 0 },
    generatedAt: new Date().toISOString()
  };
}

function makeImageSnapshot(): DirectorySnapshot {
  return {
    ...makeSnapshot(),
    roots: [
      {
        id: "root",
        name: "Downloads",
        absolutePath: "/Users/me/Downloads",
        relativePath: "Downloads",
        kind: "folder",
        size: 0,
        children: [
          {
            id: "photo-1",
            name: "photo-1.jpg",
            absolutePath: "/Users/me/Downloads/photo-1.jpg",
            relativePath: "photo-1.jpg",
            kind: "file",
            extension: ".jpg",
            size: 100
          },
          {
            id: "photo-2",
            name: "photo-2.jpeg",
            absolutePath: "/Users/me/Downloads/photo-2.jpeg",
            relativePath: "photo-2.jpeg",
            kind: "file",
            extension: ".jpeg",
            size: 100
          },
          {
            id: "photo-3",
            name: "photo-3.png",
            absolutePath: "/Users/me/Downloads/photo-3.png",
            relativePath: "photo-3.png",
            kind: "file",
            extension: ".png",
            size: 100
          },
          {
            id: "notes",
            name: "notes.txt",
            absolutePath: "/Users/me/Downloads/notes.txt",
            relativePath: "notes.txt",
            kind: "file",
            extension: ".txt",
            size: 100
          }
        ]
      }
    ],
    counts: { files: 4, folders: 1, bytes: 400, errors: 0 }
  };
}

function makeFolderSnapshot(): DirectorySnapshot {
  return {
    ...makeSnapshot(),
    roots: [
      {
        id: "root",
        name: "Downloads",
        absolutePath: "/Users/me/Downloads",
        relativePath: "Downloads",
        kind: "folder",
        size: 0,
        children: [
          {
            id: "project-alpha",
            name: "Project Alpha",
            absolutePath: "/Users/me/Downloads/Project Alpha",
            relativePath: "Project Alpha",
            kind: "folder",
            size: 0,
            children: [
              {
                id: "brief",
                name: "brief.pdf",
                absolutePath: "/Users/me/Downloads/Project Alpha/brief.pdf",
                relativePath: "Project Alpha/brief.pdf",
                kind: "file",
                extension: ".pdf",
                size: 100
              }
            ]
          },
          {
            id: "project-beta",
            name: "Project Beta",
            absolutePath: "/Users/me/Downloads/Project Beta",
            relativePath: "Project Beta",
            kind: "folder",
            size: 0,
            children: []
          }
        ]
      }
    ],
    counts: { files: 1, folders: 3, bytes: 100, errors: 0 }
  };
}

function makeProjectFilesSnapshot(): DirectorySnapshot {
  return {
    ...makeSnapshot(),
    roots: [
      {
        id: "root",
        name: "Downloads",
        absolutePath: "/Users/me/Downloads",
        relativePath: "Downloads",
        kind: "folder",
        size: 0,
        children: [
          {
            id: "hw6-index",
            name: "HW6_index.html",
            absolutePath: "/Users/me/Downloads/HW6_index.html",
            relativePath: "HW6_index.html",
            kind: "file",
            extension: ".html",
            size: 100,
            textSample: "HTML page for HW6 assignment"
          },
          {
            id: "hw6-css",
            name: "HW6_styles.css",
            absolutePath: "/Users/me/Downloads/HW6_styles.css",
            relativePath: "HW6_styles.css",
            kind: "file",
            extension: ".css",
            size: 100,
            textSample: "CSS stylesheet for HW6 assignment"
          },
          {
            id: "hw6-js",
            name: "HW6_script.js",
            absolutePath: "/Users/me/Downloads/HW6_script.js",
            relativePath: "HW6_script.js",
            kind: "file",
            extension: ".js",
            size: 100,
            textSample: "JavaScript behavior for HW6 assignment"
          }
        ]
      }
    ],
    counts: { files: 3, folders: 1, bytes: 300, errors: 0 }
  };
}

function makeClutterSnapshot(): DirectorySnapshot {
  const rootPath = "/Users/me/Desktop/FileMind-Test-Clutter";
  const file = (name: string, extension: string, textSample = "") => ({
    id: name,
    name,
    absolutePath: `${rootPath}/${name}`,
    relativePath: name,
    kind: "file" as const,
    extension,
    size: 100,
    textSample
  });
  const nestedFile = (folder: string, name: string, extension: string, textSample = "") => ({
    id: `${folder}-${name}`,
    name,
    absolutePath: `${rootPath}/${folder}/${name}`,
    relativePath: `${folder}/${name}`,
    kind: "file" as const,
    extension,
    size: 100,
    textSample
  });

  return {
    ...makeSnapshot(),
    selectedRoots: [rootPath],
    roots: [
      {
        id: "root",
        name: "FileMind-Test-Clutter",
        absolutePath: rootPath,
        relativePath: "FileMind-Test-Clutter",
        kind: "folder",
        size: 0,
        children: [
          file("Screenshot 2026-04-26 at 8.12.44 PM.png", ".png"),
          file("invoice_Jan_2026.txt", ".txt", "Invoice for FileMind Consulting. Amount due and payment terms."),
          file("package-hybrid-apex.json", ".json", '{"name":"hybrid-apex","description":"HybridApex game tracker project"}'),
          file("README_HybridApex.md", ".md", "React dashboard for tracking Apex Legends match stats."),
          file("apex_match_export.csv", ".csv", "match_id,player,kills,damage"),
          file("HW6_demo.html", ".html", "Homework 6 demo page"),
          file("denver_trip_1.jpg", ".jpg"),
          file("chili_recipe.txt", ".txt", "chili recipe ingredients prep steps grocery list"),
          {
            id: "code-bits",
            name: "code bits",
            absolutePath: `${rootPath}/code bits`,
            relativePath: "code bits",
            kind: "folder",
            size: 0,
            children: [nestedFile("code bits", "hw6_solution.py", ".py", "def solve_hw6(): return 'homework 6 solution'")]
          }
        ]
      }
    ],
    counts: { files: 9, folders: 2, bytes: 900, errors: 0 }
  };
}
