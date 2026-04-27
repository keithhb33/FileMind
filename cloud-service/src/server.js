"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const express = require("express");
const multer = require("multer");
const JSZip = require("jszip");

const app = express();
const port = Number(process.env.PORT || 3000);

const maxTotalUploadBytes = mbEnv("MAX_TOTAL_UPLOAD_MB", 75) * 1024 * 1024;
const maxFileBytes = mbEnv("MAX_FILE_MB", 20) * 1024 * 1024;
const maxFiles = intEnv("MAX_FILES", 500);
const zipTtlMs = intEnv("ZIP_TTL_MINUTES", 15) * 60 * 1000;
const ollamaHost = (process.env.OLLAMA_HOST || "http://127.0.0.1:11434").replace(/\/+$/, "");
const highEffortModel = "qwen3:14b";
const lowEffortModel = "qwen3:4b";
const defaultModel = process.env.FILEMIND_DEFAULT_MODEL || highEffortModel;
const modelChoices = [
  {
    label: "High Effort",
    model: highEffortModel,
    description: "Smarter Ollama planning when the server can comfortably run the larger model."
  },
  {
    label: "Low Effort",
    model: lowEffortModel,
    description: "Faster Ollama planning for smaller Replit machines."
  }
];

const upload = multer({
  storage: multer.memoryStorage(),
  preservePath: true,
  limits: {
    fileSize: maxFileBytes,
    files: maxFiles
  }
});

const downloads = new Map();

app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/api/limits", (_request, response) => {
  response.json({
    maxTotalUploadBytes,
    maxFileBytes,
    maxFiles,
    zipTtlMinutes: Math.round(zipTtlMs / 60000),
    ollamaHost,
    defaultModel,
    modelChoices
  });
});

app.post("/api/organize", upload.array("files", maxFiles), async (request, response, next) => {
  try {
    const uploadedFiles = request.files || [];
    if (uploadedFiles.length === 0) {
      response.status(400).json({ error: "Choose a folder or files to organize." });
      return;
    }

    const totalBytes = uploadedFiles.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > maxTotalUploadBytes) {
      response.status(413).json({
        error: `Upload is too large. Limit is ${formatBytes(maxTotalUploadBytes)}.`
      });
      return;
    }

    const files = normalizeUploadedFiles(uploadedFiles);
    if (files.length === 0) {
      response.status(400).json({ error: "No usable files were found in that upload." });
      return;
    }

    const requestedModel = String(request.body?.model || defaultModel);
    const model = modelChoices.some((choice) => choice.model === requestedModel) ? requestedModel : defaultModel;
    const aiCategories = await getOllamaCategories(files, model).catch((error) => {
      console.warn("Ollama planning unavailable, falling back to rules:", error.message);
      return null;
    });
    const plan = buildOrganizationPlan(files, aiCategories, model);
    const zipBuffer = await buildOrganizedZip(files, plan);
    const token = crypto.randomUUID();
    const downloadName = `${safeFileName(plan.replacementFolderName)}.zip`;

    downloads.set(token, {
      zipBuffer,
      downloadName,
      expiresAt: Date.now() + zipTtlMs
    });

    response.json({
      ...plan,
      downloadUrl: `/api/download/${token}`,
      expiresInMinutes: Math.round(zipTtlMs / 60000)
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/download/:token", (request, response) => {
  const entry = downloads.get(request.params.token);
  if (!entry || entry.expiresAt < Date.now()) {
    downloads.delete(request.params.token);
    response.status(404).send("Download expired.");
    return;
  }

  response.setHeader("Content-Type", "application/zip");
  response.setHeader("Content-Disposition", `attachment; filename="${entry.downloadName}"`);
  response.send(entry.zipBuffer);
});

app.use((error, _request, response, _next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      response.status(413).json({ error: `A file exceeded the ${formatBytes(maxFileBytes)} per-file limit.` });
      return;
    }
    if (error.code === "LIMIT_FILE_COUNT") {
      response.status(413).json({ error: `Upload includes too many files. Limit is ${maxFiles}.` });
      return;
    }
  }

  console.error(error);
  response.status(500).json({ error: "FileMind Cloud could not process that upload." });
});

setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of downloads.entries()) {
    if (entry.expiresAt < now) downloads.delete(token);
  }
}, 60 * 1000).unref();

app.listen(port, "0.0.0.0", () => {
  console.log(`FileMind Cloud Service listening on port ${port}`);
});

function normalizeUploadedFiles(uploadedFiles) {
  const usedPaths = new Set();
  const files = [];

  for (const file of uploadedFiles) {
    const relativePath = normalizeRelativePath(file.originalname || file.fieldname);
    if (!relativePath) continue;

    const uniquePath = uniqueRelativePath(relativePath, usedPaths);
    const extension = path.posix.extname(uniquePath).toLowerCase();
    const textSample = textExtensions.has(extension) ? readTextSample(file.buffer) : "";

    files.push({
      originalPath: uniquePath,
      name: path.posix.basename(uniquePath),
      parentPath: path.posix.dirname(uniquePath) === "." ? "" : path.posix.dirname(uniquePath),
      extension,
      size: file.size,
      mimeType: file.mimetype,
      buffer: file.buffer,
      textSample
    });
  }

  return files;
}

function buildOrganizationPlan(files, aiCategories, model) {
  const rootName = inferRootName(files);
  const replacementFolderName = `${rootName} - FileMind Organized`;
  const destinations = new Set();
  const plannedFiles = files.map((file) => {
    const category = categoryForFile(file, aiCategories?.get(file.originalPath));
    const destinationPath = uniqueRelativePath(path.posix.join(category.folder, file.name), destinations);
    return {
      sourcePath: file.originalPath,
      destinationPath,
      size: file.size,
      reason: category.reason,
      folder: category.folder
    };
  });

  const groups = summarizeGroups(plannedFiles);

  return {
    replacementFolderName,
    summary: `Organized ${files.length} file${files.length === 1 ? "" : "s"} into ${groups.length} folder${groups.length === 1 ? "" : "s"}.`,
    analysisMode: aiCategories ? "ollama" : "rules",
    model: aiCategories ? model : null,
    counts: {
      files: files.length,
      bytes: files.reduce((sum, file) => sum + file.size, 0),
      groups: groups.length
    },
    groups,
    files: plannedFiles
  };
}

async function buildOrganizedZip(files, plan) {
  const bySource = new Map(files.map((file) => [file.originalPath, file]));
  const zip = new JSZip();
  const root = zip.folder(plan.replacementFolderName);

  for (const plannedFile of plan.files) {
    const file = bySource.get(plannedFile.sourcePath);
    if (!file) continue;
    root.file(plannedFile.destinationPath, file.buffer, {
      date: new Date(),
      compression: "DEFLATE",
      compressionOptions: { level: 6 }
    });
  }

  root.file(
    "FileMind Plan.json",
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        summary: plan.summary,
        groups: plan.groups,
        files: plan.files
      },
      null,
      2
    )
  );

  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 }
  });
}

async function getOllamaCategories(files, model) {
  const inventory = files.slice(0, maxFiles).map((file) => ({
    sourcePath: file.originalPath,
    parentPath: file.parentPath,
    extension: file.extension || "none",
    size: file.size,
    textSample: file.textSample.slice(0, 600)
  }));

  const response = await fetch(`${ollamaHost}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      format: "json",
      think: model.toLowerCase().startsWith("qwen3") ? "medium" : false,
      options: {
        temperature: 0.1,
        num_ctx: 8192,
        num_gpu: 999
      },
      messages: [
        {
          role: "system",
          content:
            "You are FileMind Cloud's Ollama planning engine. Assign every uploaded sourcePath to a practical destination folder inside a replacement folder. Prefer grouping by real-world purpose, project, class, client, trip, or app when path names or text samples show a relationship. Use type folders only when purpose is unclear. Preserve filenames. Never invent source paths. Return only JSON shaped as {\"files\":[{\"sourcePath\":\"...\",\"folder\":\"...\",\"reason\":\"...\"}]}."
        },
        {
          role: "user",
          content: JSON.stringify({
            uploadedFileCount: files.length,
            files: inventory
          })
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`Ollama request failed with ${response.status}`);
  }

  const data = await response.json();
  const text = extractOllamaText(data);
  const parsed = JSON.parse(text);
  const allowedSources = new Set(files.map((file) => file.originalPath));
  const categories = new Map();

  for (const item of parsed.files || []) {
    if (!allowedSources.has(item.sourcePath)) continue;
    const folder = normalizeCategoryFolder(item.folder);
    if (!folder) continue;
    categories.set(item.sourcePath, {
      folder,
      reason: String(item.reason || "Grouped by Ollama analysis.").slice(0, 180)
    });
  }

  return categories.size > 0 ? categories : null;
}

function extractOllamaText(data) {
  const text = String(data?.message?.content || data?.response || "").trim();
  if (!text) throw new Error("Ollama response did not include planner output");
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

function categoryForFile(file, aiCategory) {
  if (aiCategory) return aiCategory;

  const haystack = `${file.originalPath}\n${file.name}\n${file.textSample}`.toLowerCase();

  if (/\b(homework|assignment|course|class|lecture|syllabus|school|university|college)\b/.test(haystack)) {
    return { folder: "School", reason: "Grouped by school or coursework context." };
  }
  if (/\b(invoice|receipt|statement|tax|paystub|bank|budget|expense)\b/.test(haystack)) {
    return { folder: "Finance", reason: "Grouped by finance-related filenames or text." };
  }
  if (/\b(resume|cv|cover letter|contract|agreement|report|proposal)\b/.test(haystack)) {
    return { folder: "Documents/Important", reason: "Grouped as important documents from filename or text hints." };
  }
  if (/\b(trip|travel|vacation|flight|hotel|itinerary|austin|chicago|tokyo|paris|london)\b/.test(haystack)) {
    return { folder: "Travel", reason: "Grouped by travel-related filename or folder context." };
  }
  if (codeExtensions.has(file.extension)) {
    return { folder: "Code", reason: "Grouped by source-code or developer file type." };
  }
  if (imageExtensions.has(file.extension)) {
    const screenshot = /\b(screenshot|screen shot|capture)\b/.test(haystack);
    return {
      folder: screenshot ? "Media/Screenshots" : "Media/Images",
      reason: screenshot ? "Grouped as screenshots by filename context." : "Grouped by image file type."
    };
  }
  if (videoExtensions.has(file.extension)) {
    return { folder: "Media/Videos", reason: "Grouped by video file type." };
  }
  if (audioExtensions.has(file.extension)) {
    return { folder: "Media/Audio", reason: "Grouped by audio file type." };
  }
  if (documentExtensions.has(file.extension)) {
    return { folder: "Documents", reason: "Grouped by document file type." };
  }
  if (spreadsheetExtensions.has(file.extension)) {
    return { folder: "Documents/Spreadsheets", reason: "Grouped by spreadsheet file type." };
  }
  if (archiveExtensions.has(file.extension)) {
    return { folder: "Archives", reason: "Grouped by archive file type." };
  }
  if (installerExtensions.has(file.extension)) {
    return { folder: "Software/Installers", reason: "Grouped by installer or disk-image file type." };
  }

  return {
    folder: file.extension ? `Other/${file.extension.slice(1).toUpperCase()} Files` : "Other/No Extension",
    reason: "Grouped with less common file types for easier review."
  };
}

function summarizeGroups(plannedFiles) {
  const groups = new Map();
  for (const file of plannedFiles) {
    const group = groups.get(file.folder) || {
      folder: file.folder,
      count: 0,
      bytes: 0,
      examples: [],
      reasons: new Set()
    };

    group.count += 1;
    group.bytes += file.size;
    if (group.examples.length < 4) group.examples.push(path.posix.basename(file.destinationPath));
    group.reasons.add(file.reason);
    groups.set(file.folder, group);
  }

  return [...groups.values()]
    .sort((a, b) => b.count - a.count || a.folder.localeCompare(b.folder))
    .map((group) => ({
      folder: group.folder,
      count: group.count,
      bytes: group.bytes,
      examples: group.examples,
      reason: [...group.reasons][0]
    }));
}

function inferRootName(files) {
  const firstSegments = files
    .map((file) => file.originalPath.split("/")[0])
    .filter(Boolean);
  const first = firstSegments[0];
  if (first && firstSegments.every((segment) => segment === first) && files.some((file) => file.originalPath.includes("/"))) {
    return safeFileName(first);
  }

  return "Uploaded Folder";
}

function normalizeRelativePath(value) {
  const normalized = String(value || "")
    .replace(/\\/g, "/")
    .replace(/^[a-zA-Z]:\//, "")
    .replace(/^\/+/, "");

  const segments = normalized
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length === 0) return "";
  if (segments.some((segment) => segment === "." || segment === ".." || segment.includes("\0"))) return "";

  return segments.map(safePathSegment).filter(Boolean).join("/");
}

function normalizeCategoryFolder(value) {
  const normalized = normalizeRelativePath(value);
  if (!normalized) return "";
  return normalized
    .split("/")
    .filter((segment) => !/\.[a-z0-9]{1,8}$/i.test(segment))
    .join("/")
    .slice(0, 180);
}

function safePathSegment(segment) {
  return segment.replace(/[<>:"|?*\0]/g, "").slice(0, 120).trim();
}

function safeFileName(value) {
  return safePathSegment(value).replace(/\.+$/, "") || "FileMind Organized";
}

function uniqueRelativePath(candidate, usedPaths) {
  const parsed = path.posix.parse(candidate);
  let next = candidate;
  let counter = 2;

  while (usedPaths.has(next.toLowerCase())) {
    next = path.posix.join(parsed.dir, `${parsed.name} ${counter}${parsed.ext}`);
    counter += 1;
  }

  usedPaths.add(next.toLowerCase());
  return next;
}

function readTextSample(buffer) {
  if (!buffer || buffer.length === 0) return "";
  const slice = buffer.subarray(0, Math.min(buffer.length, 4096));
  if (slice.includes(0)) return "";
  return slice.toString("utf8").replace(/\s+/g, " ").trim().slice(0, 1000);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function mbEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function intEnv(name, fallback) {
  const value = Number.parseInt(process.env[name], 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const textExtensions = new Set([
  ".txt",
  ".md",
  ".csv",
  ".json",
  ".yaml",
  ".yml",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".css",
  ".html",
  ".xml",
  ".log",
  ".py",
  ".rs",
  ".go",
  ".java",
  ".c",
  ".cpp",
  ".h",
  ".hpp"
]);

const codeExtensions = new Set([".js", ".jsx", ".ts", ".tsx", ".py", ".rs", ".go", ".java", ".c", ".cpp", ".h", ".hpp", ".css", ".html", ".json", ".yaml", ".yml", ".toml", ".sh"]);
const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".heic", ".tiff", ".svg", ".bmp"]);
const videoExtensions = new Set([".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v"]);
const audioExtensions = new Set([".mp3", ".wav", ".flac", ".m4a", ".aac", ".ogg"]);
const documentExtensions = new Set([".pdf", ".txt", ".md", ".rtf", ".doc", ".docx", ".odt", ".pages", ".ppt", ".pptx", ".key", ".epub", ".mobi"]);
const spreadsheetExtensions = new Set([".csv", ".xls", ".xlsx", ".ods", ".numbers"]);
const archiveExtensions = new Set([".zip", ".rar", ".7z", ".tar", ".gz", ".bz2", ".xz"]);
const installerExtensions = new Set([".dmg", ".pkg", ".exe", ".msi", ".deb", ".rpm", ".appimage", ".iso"]);
