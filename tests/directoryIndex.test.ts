import { describe, expect, it } from "vitest";
import type { DirectorySnapshot, FileNode } from "../src/shared/types";
import { buildRagContext, classifyFileForOrganization } from "../src/main/directoryIndex";

describe("directoryIndex", () => {
  it("builds retrieval context from file content snippets and folder profiles", () => {
    const context = buildRagContext(makeSnapshot());

    expect(context).toContain("Local retrieval index");
    expect(context).toContain("Finance/Receipts and Invoices");
    expect(context).toContain("/Users/me/Downloads/receipt.txt");
    expect(context).toContain("Cluttered folder profiles");
  });

  it("classifies files from content snippets", () => {
    const node = fileNode("receipt.txt", "Receipt total paid with card order number 123");

    expect(classifyFileForOrganization(node)).toEqual({
      folder: "Finance/Receipts and Invoices",
      reason: "Grouped by retrieved filename, folder, and content snippet signals into Finance/Receipts and Invoices."
    });
  });

  it("prioritizes project clusters over extension-only grouping", () => {
    const node = {
      ...fileNode("HW6_styles.css", "CSS for the HW6 responsive layout project"),
      extension: ".css"
    };

    expect(classifyFileForOrganization(node)).toEqual({
      folder: "School/Homework/HW6",
      reason: "Grouped by shared project signals into School/Homework/HW6 before grouping by file type."
    });
  });

  it("surfaces project clusters in the retrieval context", () => {
    const context = buildRagContext(makeProjectSnapshot());

    expect(context).toContain("Project clusters to prioritize before file-type grouping");
    expect(context).toContain("School/Homework/HW6");
    expect(context).toContain("HW6_index.html");
    expect(context).toContain("HW6_styles.css");
  });
});

function makeSnapshot(): DirectorySnapshot {
  return {
    selectedRoots: ["/Users/me/Downloads"],
    scanOptions: {
      maxDepth: 5,
      ignoredGlobs: [],
      includeHiddenFiles: false,
      includeTextSnippets: true,
      maxSnippetBytes: 4096
    },
    roots: [
      {
        id: "root",
        name: "Downloads",
        absolutePath: "/Users/me/Downloads",
        relativePath: "Downloads",
        kind: "folder",
        size: 0,
        children: [fileNode("receipt.txt", "Receipt total paid with card order number 123")]
      }
    ],
    counts: { files: 1, folders: 1, bytes: 100, errors: 0 },
    generatedAt: new Date().toISOString()
  };
}

function fileNode(name: string, textSample: string): FileNode {
  return {
    id: name,
    name,
    absolutePath: `/Users/me/Downloads/${name}`,
    relativePath: name,
    kind: "file",
    extension: ".txt",
    size: 100,
    textSample
  };
}

function makeProjectSnapshot(): DirectorySnapshot {
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
            ...fileNode("HW6_index.html", "HTML page for HW6 assignment"),
            extension: ".html"
          },
          {
            ...fileNode("HW6_styles.css", "CSS stylesheet for HW6 assignment"),
            extension: ".css"
          },
          {
            ...fileNode("HW6_script.js", "JavaScript behavior for HW6 assignment"),
            extension: ".js"
          }
        ]
      }
    ],
    counts: { files: 3, folders: 1, bytes: 300, errors: 0 }
  };
}
