import { describe, expect, it, vi } from "vitest";
import type { DirectorySnapshot } from "../src/shared/types";

const chat = vi.fn();
const list = vi.fn();
const pull = vi.fn();

vi.mock("ollama", () => ({
  chat,
  list,
  pull,
  default: {
    chat,
    list,
    pull
  }
}));

describe("ollamaClient", () => {
  it("parses structured Ollama output into a FileMind plan", async () => {
    const { generateOrganizationPlan } = await import("../src/main/ollamaClient");
    chat.mockResolvedValueOnce({
      message: {
        content: JSON.stringify({
          summary: "Group the loose documents.",
          rationale: "Documents are easier to find in a Documents folder.",
          confidence: 0.86,
          proposedTree: [{ name: "Documents", kind: "folder", children: [{ name: "notes.txt", kind: "file" }] }],
          operations: [
            {
              sourcePath: "/tmp/source/notes.txt",
              destinationPath: "/tmp/source/Documents/notes.txt",
              reason: "A note belongs with documents.",
              riskLevel: "low"
            }
          ]
        })
      }
    });

    const plan = await generateOrganizationPlan(makeSnapshot(), { model: "qwen3:4b", temperature: 0.1 });

    expect(plan.id).toBeTruthy();
    expect(plan.rootPaths).toEqual(["/tmp/source"]);
    expect(plan.operations[0].id).toBe("op-1");
    expect(plan.summary).toBe("Scanned 1 file across 1 folder. Proposed 1 safe move based on the full scan.");
  });

  it("enables Ollama thinking mode for Qwen 3 models", async () => {
    const { generateOrganizationPlan } = await import("../src/main/ollamaClient");
    chat.mockResolvedValueOnce({
      message: {
        content: JSON.stringify({
          summary: "Group the loose documents.",
          rationale: "Documents are easier to find in a Documents folder.",
          confidence: 0.86,
          proposedTree: [],
          operations: []
        })
      }
    });

    await generateOrganizationPlan(makeSnapshot(), { model: "qwen3:4b", temperature: 0.1 });

    expect(chat).toHaveBeenLastCalledWith(expect.objectContaining({
      model: "qwen3:4b",
      think: "medium",
      options: expect.objectContaining({ num_gpu: 999 })
    }));
  });

  it("lists local Ollama models", async () => {
    const { listOllamaModels } = await import("../src/main/ollamaClient");
    list.mockResolvedValueOnce({
      models: [{ name: "llama3.2:latest", size: 123, modified_at: new Date("2026-01-01T00:00:00.000Z") }]
    });

    await expect(listOllamaModels()).resolves.toEqual([
      { name: "llama3.2:latest", size: 123, modifiedAt: "2026-01-01T00:00:00.000Z" }
    ]);
  });

  it("pulls only missing required local models", async () => {
    const { ensureRequiredLocalModels } = await import("../src/main/ollamaClient");
    list
      .mockResolvedValueOnce({
        models: [{ name: "qwen3:4b", size: 123, modified_at: new Date("2026-01-01T00:00:00.000Z") }]
      })
      .mockResolvedValueOnce({
        models: [
          { name: "qwen3:14b", size: 456, modified_at: new Date("2026-01-01T00:00:00.000Z") },
          { name: "qwen3:4b", size: 123, modified_at: new Date("2026-01-01T00:00:00.000Z") }
        ]
      });
    pull.mockResolvedValueOnce({});

    await expect(ensureRequiredLocalModels()).resolves.toMatchObject({
      pulled: ["qwen3:14b"],
      missing: []
    });
    expect(pull).toHaveBeenCalledWith({ model: "qwen3:14b", stream: false });
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
          }
        ]
      }
    ],
    counts: { files: 1, folders: 1, bytes: 10, errors: 0 },
    generatedAt: new Date().toISOString()
  };
}
