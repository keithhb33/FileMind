"use strict";

const form = document.querySelector("#upload-form");
const input = document.querySelector("#folder-input");
const selectedSummary = document.querySelector("#selected-summary");
const organizeButton = document.querySelector("#organize-button");
const statusBox = document.querySelector("#status");
const limitsBox = document.querySelector("#limits");
const modelSelect = document.querySelector("#model-select");
const result = document.querySelector("#result");
const replacementName = document.querySelector("#replacement-name");
const analysisMode = document.querySelector("#analysis-mode");
const summary = document.querySelector("#summary");
const downloadLink = document.querySelector("#download-link");
const groups = document.querySelector("#groups");
const fileTable = document.querySelector("#file-table");

let limits = null;

fetch("/api/limits")
  .then((response) => response.json())
  .then((data) => {
    limits = data;
    renderModelChoices(data.modelChoices || [], data.defaultModel);
    limitsBox.textContent = `${formatBytes(data.maxTotalUploadBytes)} max upload, ${data.maxFiles} files, Ollama at ${data.ollamaHost}`;
    refreshSelection();
  })
  .catch(() => {
    limitsBox.textContent = "Limits unavailable";
  });

input.addEventListener("change", refreshSelection);

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const files = [...input.files];
  if (files.length === 0) return;

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (limits && totalBytes > limits.maxTotalUploadBytes) {
    setStatus(`That folder is ${formatBytes(totalBytes)}. The upload limit is ${formatBytes(limits.maxTotalUploadBytes)}.`, "error");
    return;
  }

  setBusy(true);
  setStatus("Uploading and organizing...");
  result.classList.add("hidden");

  const body = new FormData();
  body.append("model", modelSelect.value || limits?.defaultModel || "qwen3:14b");
  for (const file of files) {
    body.append("files", file, file.webkitRelativePath || file.name);
  }

  try {
    const response = await fetch("/api/organize", {
      method: "POST",
      body
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Upload failed.");
    renderPlan(data);
    setStatus(`Ready. Download link expires in ${data.expiresInMinutes} minutes.`, "success");
  } catch (error) {
    setStatus(error.message || "FileMind Cloud could not organize that upload.", "error");
  } finally {
    setBusy(false);
  }
});

function refreshSelection() {
  const files = [...input.files];
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);

  if (files.length === 0) {
    selectedSummary.textContent = "No files selected";
    organizeButton.disabled = true;
    return;
  }

  selectedSummary.textContent = `${files.length} file${files.length === 1 ? "" : "s"} selected, ${formatBytes(totalBytes)}`;
  organizeButton.disabled = Boolean(limits && (files.length > limits.maxFiles || totalBytes > limits.maxTotalUploadBytes));
}

function renderPlan(plan) {
  replacementName.textContent = plan.replacementFolderName;
  analysisMode.textContent =
    plan.analysisMode === "ollama" && plan.model
      ? `Analyzed with Ollama (${plan.model})`
      : "Analyzed with built-in organization rules";
  summary.textContent = plan.summary;
  downloadLink.href = plan.downloadUrl;

  groups.replaceChildren(
    ...plan.groups.map((group) => {
      const card = document.createElement("article");
      card.className = "group-card";
      card.innerHTML = `
        <div class="group-top">
          <h3></h3>
          <span></span>
        </div>
        <p></p>
        <small></small>
      `;
      card.querySelector("h3").textContent = group.folder;
      card.querySelector("span").textContent = `${group.count} file${group.count === 1 ? "" : "s"}`;
      card.querySelector("p").textContent = group.reason;
      card.querySelector("small").textContent = group.examples.join(", ");
      return card;
    })
  );

  fileTable.replaceChildren(
    ...plan.files.slice(0, 160).map((file) => {
      const row = document.createElement("tr");
      row.innerHTML = "<td></td><td></td><td></td>";
      row.children[0].textContent = file.sourcePath;
      row.children[1].textContent = file.destinationPath;
      row.children[2].textContent = file.reason;
      return row;
    })
  );

  result.classList.remove("hidden");
}

function renderModelChoices(choices, defaultModel) {
  modelSelect.replaceChildren(
    ...choices.map((choice) => {
      const option = document.createElement("option");
      option.value = choice.model;
      option.textContent = `${choice.label} (${choice.model})`;
      option.title = choice.description;
      option.selected = choice.model === defaultModel;
      return option;
    })
  );
}

function setBusy(isBusy) {
  organizeButton.disabled = isBusy || input.files.length === 0;
  organizeButton.textContent = isBusy ? "Working..." : "Organize";
}

function setStatus(message, kind = "") {
  statusBox.textContent = message;
  statusBox.className = `status ${kind}`.trim();
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
