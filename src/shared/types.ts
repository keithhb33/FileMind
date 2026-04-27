import { z } from "zod";

export const unlimitedScanDepth = Number.MAX_SAFE_INTEGER;

export const ScanOptionsSchema = z.object({
  maxDepth: z.number().int().min(1).default(unlimitedScanDepth),
  ignoredGlobs: z.array(z.string()).default(["node_modules/**", ".git/**", "dist/**", "build/**"]),
  includeHiddenFiles: z.boolean().default(true),
  includeTextSnippets: z.boolean().default(true),
  maxSnippetBytes: z.number().int().min(128).max(32768).default(4096)
});

export type ScanOptions = z.infer<typeof ScanOptionsSchema>;

export const FileNodeSchema: z.ZodType<FileNode> = z.lazy(() =>
  z.object({
    id: z.string(),
    name: z.string(),
    absolutePath: z.string(),
    relativePath: z.string(),
    kind: z.enum(["file", "folder"]),
    extension: z.string().optional(),
    size: z.number().nonnegative(),
    createdAt: z.string().optional(),
    modifiedAt: z.string().optional(),
    children: z.array(FileNodeSchema).optional(),
    textSample: z.string().optional(),
    scanError: z.string().optional()
  })
);

export type FileNode = {
  id: string;
  name: string;
  absolutePath: string;
  relativePath: string;
  kind: "file" | "folder";
  extension?: string;
  size: number;
  createdAt?: string;
  modifiedAt?: string;
  children?: FileNode[];
  textSample?: string;
  scanError?: string;
};

export const DirectorySnapshotSchema = z.object({
  selectedRoots: z.array(z.string()),
  scanOptions: ScanOptionsSchema,
  roots: z.array(FileNodeSchema),
  counts: z.object({
    files: z.number().int().nonnegative(),
    folders: z.number().int().nonnegative(),
    bytes: z.number().nonnegative(),
    errors: z.number().int().nonnegative()
  }),
  generatedAt: z.string()
});

export type DirectorySnapshot = z.infer<typeof DirectorySnapshotSchema>;

export const ProposedNodeSchema: z.ZodType<ProposedNode> = z.lazy(() =>
  z.object({
    name: z.string(),
    kind: z.enum(["file", "folder"]),
    children: z.array(ProposedNodeSchema).optional(),
    sourcePath: z.string().optional()
  })
);

export type ProposedNode = {
  name: string;
  kind: "file" | "folder";
  children?: ProposedNode[];
  sourcePath?: string;
};

export const MoveOperationSchema = z.object({
  id: z.string().optional(),
  sourcePath: z.string(),
  destinationPath: z.string(),
  reason: z.string(),
  riskLevel: z.enum(["low", "medium", "high"]).default("low")
});

export type MoveOperation = z.infer<typeof MoveOperationSchema>;

export const OrganizationPlanSchema = z.object({
  id: z.string(),
  rootPaths: z.array(z.string()),
  summary: z.string(),
  rationale: z.string(),
  confidence: z.number().min(0).max(1),
  proposedTree: z.array(ProposedNodeSchema),
  operations: z.array(MoveOperationSchema),
  generatedAt: z.string()
});

export type OrganizationPlan = z.infer<typeof OrganizationPlanSchema>;

export const AiOrganizationPlanSchema = OrganizationPlanSchema.omit({
  id: true,
  rootPaths: true,
  generatedAt: true
});

export type AiOrganizationPlan = z.infer<typeof AiOrganizationPlanSchema>;

export const BlockedOperationSchema = z.object({
  operation: MoveOperationSchema,
  reason: z.string()
});

export const PlanValidationResultSchema = z.object({
  validOperations: z.array(MoveOperationSchema),
  blockedOperations: z.array(BlockedOperationSchema),
  warnings: z.array(z.string())
});

export type PlanValidationResult = z.infer<typeof PlanValidationResultSchema>;

export const ApplyResultSchema = z.object({
  ok: z.boolean(),
  manifestId: z.string().optional(),
  movedOperations: z.array(MoveOperationSchema),
  failedOperations: z.array(BlockedOperationSchema),
  message: z.string()
});

export type ApplyResult = z.infer<typeof ApplyResultSchema>;

export const PlanOptionsSchema = z.object({
  model: z.string(),
  temperature: z.number().min(0).max(1).default(0.1),
  revisionRequest: z.string().max(16000).optional(),
  previousPlan: OrganizationPlanSchema.optional()
});

export type PlanOptions = z.infer<typeof PlanOptionsSchema>;

export const OllamaModelSchema = z.object({
  name: z.string(),
  size: z.number().optional(),
  modifiedAt: z.string().optional()
});

export type OllamaModel = z.infer<typeof OllamaModelSchema>;

export const LocalModelInstallResultSchema = z.object({
  installed: z.array(z.string()),
  pulled: z.array(z.string()),
  missing: z.array(z.string())
});

export type LocalModelInstallResult = z.infer<typeof LocalModelInstallResultSchema>;

export type FilePreview = {
  kind: "image";
  path: string;
  name: string;
  size: number;
  dataUrl: string;
};

export type FileMindApi = {
  selectDirectories: () => Promise<string[]>;
  scanDirectories: (paths: string[], options: ScanOptions) => Promise<DirectorySnapshot>;
  listOllamaModels: () => Promise<OllamaModel[]>;
  ensureLocalModels: () => Promise<LocalModelInstallResult>;
  openInFileManager: (filePath: string) => Promise<void>;
  previewFile: (filePath: string) => Promise<FilePreview>;
  generatePlan: (snapshot: DirectorySnapshot, options: PlanOptions) => Promise<OrganizationPlan>;
  validatePlan: (plan: OrganizationPlan) => Promise<PlanValidationResult>;
  applyPlan: (plan: OrganizationPlan) => Promise<ApplyResult>;
  undoApply: (manifestId: string) => Promise<ApplyResult>;
};
