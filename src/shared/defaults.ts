import { unlimitedScanDepth, type ScanOptions } from "./types";

export const defaultScanOptions: ScanOptions = {
  maxDepth: unlimitedScanDepth,
  ignoredGlobs: ["node_modules/**", ".git/**", "dist/**", "build/**"],
  includeHiddenFiles: true,
  includeTextSnippets: true,
  maxSnippetBytes: 4096
};
