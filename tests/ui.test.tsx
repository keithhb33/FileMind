import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../src/renderer/src/App";
import { DirectoryVisualization } from "../src/renderer/src/components/DirectoryVisualization";
import type { DirectorySnapshot, OrganizationPlan } from "../src/shared/types";

describe("renderer", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows the V2 source step without crashing when local AI is offline", async () => {
    Object.defineProperty(window, "fileMind", {
      configurable: true,
      value: {
        listOllamaModels: vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:11434")),
        selectDirectories: vi.fn(),
        scanDirectories: vi.fn(),
        generatePlan: vi.fn(),
        validatePlan: vi.fn(),
        applyPlan: vi.fn(),
        undoApply: vi.fn()
      }
    });

    render(<App />);

    await waitFor(() => expect(screen.getByText("Choose your source.")).toBeInTheDocument());
    expect(screen.getByText(/Organize your computer files with the help of AI/i)).toBeInTheDocument();
  });

  it("shows local effort labels only", async () => {
    Object.defineProperty(window, "fileMind", {
      configurable: true,
      value: {
        listOllamaModels: vi.fn().mockResolvedValue([
          { name: "qwen3:14b" },
          { name: "qwen3:4b" }
        ]),
        selectDirectories: vi.fn().mockResolvedValue(["/tmp/source"]),
        scanDirectories: vi.fn().mockResolvedValue(makeSnapshot()),
        generatePlan: vi.fn(),
        validatePlan: vi.fn(),
        applyPlan: vi.fn(),
        undoApply: vi.fn()
      }
    });

    render(<App />);
    fireEvent.click(await screen.findByText("Choose source"));
    await screen.findByText("/tmp/source");
    fireEvent.click(screen.getByText("Scan"));
    await screen.findByLabelText("Local effort");

    expect(screen.getByText("High Effort")).toBeInTheDocument();
    expect(screen.getByText("Low Effort")).toBeInTheDocument();
    expect(screen.queryByText(/Cloud/i)).not.toBeInTheDocument();
  });

  it("renders before and after visualization labels and file items", () => {
    render(<DirectoryVisualization snapshot={makeSnapshot()} plan={makePlan()} />);

    expect(screen.getByText("Before")).toBeInTheDocument();
    expect(screen.getByText("After")).toBeInTheDocument();
    expect(screen.getAllByText("notes.txt").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Documents")).toBeInTheDocument();
    expect(screen.getByLabelText("Map zoom")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Tree view"));
    fireEvent.click(screen.getByLabelText("Expand Documents"));
    expect(screen.getAllByText("archive.zip").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("notes.txt").length).toBeGreaterThanOrEqual(2);
  });
});

function makeSnapshot(): DirectorySnapshot {
  return {
    selectedRoots: ["/tmp/source"],
    scanOptions: {
      maxDepth: 5,
      ignoredGlobs: [],
      includeHiddenFiles: false,
      includeTextSnippets: false,
      maxSnippetBytes: 4096
    },
    roots: [
      {
        id: "root",
        name: "source",
        absolutePath: "/tmp/source",
        relativePath: "source",
        kind: "folder",
        size: 0,
        children: [
          {
            id: "notes",
            name: "notes.txt",
            absolutePath: "/tmp/source/notes.txt",
            relativePath: "notes.txt",
            kind: "file",
            extension: ".txt",
            size: 10
          },
          {
            id: "archive",
            name: "archive.zip",
            absolutePath: "/tmp/source/archive.zip",
            relativePath: "archive.zip",
            kind: "file",
            extension: ".zip",
            size: 20
          }
        ]
      }
    ],
    counts: { files: 2, folders: 1, bytes: 30, errors: 0 },
    generatedAt: new Date().toISOString()
  };
}

function makePlan(): OrganizationPlan {
  return {
    id: "plan",
    rootPaths: ["/tmp/source"],
    summary: "Organize notes",
    rationale: "Keep notes in documents.",
    confidence: 0.8,
    proposedTree: [{ name: "Documents", kind: "folder", children: [{ name: "notes.txt", kind: "file" }] }],
    operations: [
      {
        id: "op-1",
        sourcePath: "/tmp/source/archive.zip",
        destinationPath: "/tmp/source/Documents/archive.zip",
        reason: "Keep archive with documents.",
        riskLevel: "low"
      }
    ],
    generatedAt: new Date().toISOString()
  };
}
