import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useDragControls } from "framer-motion";
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  BrainCircuit,
  CheckCircle2,
  ChevronRight,
  FolderOpen,
  Loader2,
  MessageSquare,
  Play,
  RotateCcw,
  ScanLine,
  Settings2,
  Sparkles,
  X
} from "lucide-react";
import { DirectoryVisualization, type FileActionPoint } from "./components/DirectoryVisualization";
import { Modal } from "./components/Modal";
import { Pill } from "./components/Pill";
import { applyManualPlanMove, type ManualMoveItem } from "./manualPlanEdits";
import { defaultScanOptions } from "../../shared/defaults";
import { availableLocalModelChoices, choosePreferredModel, localModelChoices, recommendedModel } from "../../shared/modelRecommendations";
import type {
  ApplyResult,
  DirectorySnapshot,
  FilePreview,
  OllamaModel,
  OrganizationPlan,
  PlanValidationResult,
  ScanOptions
} from "../../shared/types";

type BusyState = "idle" | "models" | "installing" | "selecting" | "scanning" | "planning" | "applying" | "undoing";
type WizardStep = "source" | "before" | "review" | "done";

const steps: Array<{ id: WizardStep; label: string }> = [
  { id: "source", label: "Source" },
  { id: "before", label: "Before" },
  { id: "review", label: "Review" },
  { id: "done", label: "Done" }
];
const revisionContextLimit = 12000;
const revisionUserRequestLimit = 8000;
const planningTips = [
  "Prioritizing project relationships before file extensions.",
  "Checking every proposed move against the selected source folders.",
  "Keeping unchanged files in place while projecting the new layout.",
  "Looking for assignments, apps, clients, and related mixed-file groups.",
  "Preparing a plan that can be reviewed, edited, applied, and undone."
];

function App(): JSX.Element {
  const [step, setStep] = useState<WizardStep>("source");
  const [directories, setDirectories] = useState<string[]>([]);
  const [scanOptions, setScanOptions] = useState<ScanOptions>({ ...defaultScanOptions, includeHiddenFiles: true });
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [modelError, setModelError] = useState("");
  const [snapshot, setSnapshot] = useState<DirectorySnapshot | null>(null);
  const [plan, setPlan] = useState<OrganizationPlan | null>(null);
  const [validation, setValidation] = useState<PlanValidationResult | null>(null);
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null);
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [pendingOpen, setPendingOpen] = useState<{ path: string; x: number; y: number } | null>(null);
  const [changeRequestOpen, setChangeRequestOpen] = useState(false);
  const [busy, setBusy] = useState<BusyState>("idle");
  const [error, setError] = useState("");
  const [confirmApply, setConfirmApply] = useState(false);
  const liveScanInFlight = useRef(false);
  const openLocationPopoverRef = useRef<HTMLDivElement | null>(null);

  const validOperationCount = validation?.validOperations.length ?? 0;
  const blockedOperationCount = validation?.blockedOperations.length ?? 0;
  const localModelOptions = useMemo(() => availableLocalModelChoices(models.map((model) => model.name)), [models]);
  const canGenerate = Boolean(snapshot && selectedModel && busy === "idle");
  const immersive = step === "source" || busy === "planning";
  const pageScrollLocked = step === "source" || step === "done" || busy === "planning";

  useEffect(() => {
    void refreshModels();
  }, []);

  useEffect(() => {
    document.body.classList.toggle("filemind-scroll-locked", pageScrollLocked);
    return () => document.body.classList.remove("filemind-scroll-locked");
  }, [pageScrollLocked]);

  useEffect(() => {
    if (!pendingOpen) return;

    function closeOnOutsidePointer(event: PointerEvent): void {
      const target = event.target;
      if (target instanceof Node && openLocationPopoverRef.current?.contains(target)) return;
      setPendingOpen(null);
    }

    function closeOnEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") setPendingOpen(null);
    }

    window.addEventListener("pointerdown", closeOnOutsidePointer, true);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsidePointer, true);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [pendingOpen]);

  useEffect(() => {
    if (!snapshot || directories.length === 0 || step === "source") return;

    const interval = window.setInterval(() => {
      if (busy !== "idle" || liveScanInFlight.current) return;
      liveScanInFlight.current = true;
      window.fileMind
        .scanDirectories(directories, { ...scanOptions, includeHiddenFiles: true })
        .then(async (nextSnapshot) => {
          setSnapshot(nextSnapshot);
          if (plan) setValidation(await window.fileMind.validatePlan(plan));
        })
        .catch(() => {
          // Keep the last good snapshot visible; explicit scan/generate actions will surface errors.
        })
        .finally(() => {
          liveScanInFlight.current = false;
        });
    }, 12000);

    return () => window.clearInterval(interval);
  }, [busy, directories, plan, scanOptions, snapshot, step]);

  const stats = useMemo(() => {
    if (!snapshot) return [];
    return [
      { label: "Files", value: snapshot.counts.files.toLocaleString() },
      { label: "Folders", value: snapshot.counts.folders.toLocaleString() },
      { label: "Size", value: formatBytes(snapshot.counts.bytes) },
      { label: "Skipped", value: snapshot.counts.errors.toLocaleString() }
    ];
  }, [snapshot]);

  async function refreshModels(): Promise<void> {
    setBusy("models");
    setModelError("");
    try {
      let nextModels = await window.fileMind.listOllamaModels();
      const supportedModels = availableLocalModelChoices(nextModels.map((model) => model.name));

      if (supportedModels.length < localModelChoices.length) {
        const missingLabels = localModelChoices
          .filter((choice) => !supportedModels.some((installed) => installed.label === choice.label))
          .map((choice) => choice.label)
          .join(" and ");
        setBusy("installing");
        setModelError(`Installing ${missingLabels} for local use. This can take a while on first launch.`);
        const installResult = await window.fileMind.ensureLocalModels();
        nextModels = await window.fileMind.listOllamaModels();
        if (installResult.missing.length > 0) {
          setModelError(`FileMind could not finish installing: ${installResult.missing.join(", ")}. Check Ollama and available disk space.`);
        } else {
          setModelError("");
        }
      }

      const nextSupportedModels = availableLocalModelChoices(nextModels.map((model) => model.name));
      setModels(nextModels);
      setSelectedModel((current) => nextSupportedModels.some((choice) => choice.model === current) ? current : choosePreferredModel(nextModels.map((model) => model.name)));
      if (nextModels.length === 0) setModelError("Ollama is running, but no local models were found.");
      else if (nextSupportedModels.length === 0) setModelError(`Ollama is running, but FileMind only uses High Effort or Low Effort local models now. Run "ollama pull ${recommendedModel}" or "ollama pull qwen3:4b".`);
    } catch {
      setModelError(`Ollama is not reachable at http://localhost:11434. Install or start Ollama; FileMind will install High Effort and Low Effort automatically after Ollama is running.`);
    } finally {
      setBusy("idle");
    }
  }

  async function refreshSelectedDirectories(): Promise<void> {
    setBusy("selecting");
    setError("");
    try {
      const paths = await window.fileMind.selectDirectories();
      if (paths.length > 0) {
        setDirectories(paths);
        setSnapshot(null);
        setPlan(null);
        setValidation(null);
        setApplyResult(null);
        setStep("source");
      }
    } catch (caught) {
      setError(readError(caught, "Directory selection failed."));
    } finally {
      setBusy("idle");
    }
  }

  async function scan(): Promise<void> {
    if (directories.length === 0) return;
    setPendingOpen(null);
    setBusy("scanning");
    setError("");
    setPlan(null);
    setValidation(null);
    setApplyResult(null);
    const enforcedOptions = { ...scanOptions, includeHiddenFiles: true };
    setScanOptions(enforcedOptions);
    try {
      const nextSnapshot = await window.fileMind.scanDirectories(directories, enforcedOptions);
      setSnapshot(nextSnapshot);
      setStep("before");
    } catch (caught) {
      setError(readError(caught, "Scan failed."));
    } finally {
      setBusy("idle");
    }
  }

  async function generatePlan(revisionRequest = ""): Promise<void> {
    if (!snapshot || !selectedModel) return;
    setPendingOpen(null);
    const revisionContext = revisionRequest.trim() ? buildRevisionContext(revisionRequest, plan) : undefined;
    setBusy("planning");
    setError("");
    setApplyResult(null);
    try {
      const nextPlan = await window.fileMind.generatePlan(snapshot, {
        model: selectedModel,
        temperature: 0.1,
        revisionRequest: revisionContext,
        previousPlan: revisionRequest.trim() && plan ? plan : undefined
      });
      const nextValidation = await window.fileMind.validatePlan(nextPlan);
      setPlan(nextPlan);
      setValidation(nextValidation);
      setStep("review");
    } catch (caught) {
      setError(readError(caught, "FileMind could not generate a plan."));
    } finally {
      setBusy("idle");
    }
  }

  async function regenerateWithChanges(request: string): Promise<void> {
    if (!request.trim()) return;
    setPendingOpen(null);
    setChangeRequestOpen(false);
    await generatePlan(request);
  }

  async function manuallyMoveInPlan(items: ManualMoveItem[], targetFolderPath: string): Promise<void> {
    if (!plan) return;
    const nextPlan = applyManualPlanMove(plan, items, targetFolderPath);
    if (!nextPlan) return;
    setPlan(nextPlan);
    setValidation(await window.fileMind.validatePlan(nextPlan));
  }

  async function applyCurrentPlan(): Promise<void> {
    if (!plan) return;
    setPendingOpen(null);
    setConfirmApply(false);
    setBusy("applying");
    setError("");
    try {
      const result = await window.fileMind.applyPlan(plan);
      setApplyResult(result);
      if (result.ok) {
        const nextSnapshot = await window.fileMind.scanDirectories(directories, { ...scanOptions, includeHiddenFiles: true });
        setSnapshot(nextSnapshot);
      }
      setStep("done");
    } catch (caught) {
      setError(readError(caught, "Apply failed."));
    } finally {
      setBusy("idle");
    }
  }

  async function undo(): Promise<void> {
    if (!applyResult?.manifestId) return;
    setBusy("undoing");
    setError("");
    try {
      const result = await window.fileMind.undoApply(applyResult.manifestId);
      setApplyResult(result);
      const nextSnapshot = await window.fileMind.scanDirectories(directories, { ...scanOptions, includeHiddenFiles: true });
      setSnapshot(nextSnapshot);
      setPlan(null);
      setValidation(null);
      setStep("before");
    } catch (caught) {
      setError(readError(caught, "Undo failed."));
    } finally {
      setBusy("idle");
    }
  }

  async function previewFile(filePath: string): Promise<void> {
    setError("");
    try {
      setPreview(await window.fileMind.previewFile(filePath));
    } catch (caught) {
      setError(readError(caught, "FileMind could not preview that file."));
    }
  }

  async function openInFileManager(filePath: string): Promise<void> {
    setError("");
    try {
      await window.fileMind.openInFileManager(filePath);
      setPendingOpen(null);
    } catch (caught) {
      setError(readError(caught, "FileMind could not open that file location."));
    }
  }

  function requestOpenInFileManager(filePath: string, point?: FileActionPoint): void {
    const fallback = { x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 2) };
    const nextPoint = point ?? fallback;
    setPendingOpen({
      path: filePath,
      x: clamp(nextPoint.x, 16, window.innerWidth - 300),
      y: clamp(nextPoint.y, 86, window.innerHeight - 170)
    });
  }

  return (
    <main className={`${pageScrollLocked ? "h-screen overflow-hidden" : "min-h-screen overflow-x-hidden"} bg-[radial-gradient(circle_at_20%_8%,rgba(59,130,246,0.20),transparent_32%),radial-gradient(circle_at_80%_0%,rgba(15,23,42,0.16),transparent_30%),linear-gradient(135deg,#f8fafc_0%,#e2e8f0_48%,#dbeafe_100%)] text-slate-950`}>
      <div className={pageScrollLocked ? "flex h-full flex-col overflow-hidden" : "min-h-screen"}>
        <header
          className={`flex h-[76px] shrink-0 items-center justify-between px-6 shadow-sm backdrop-blur-xl ${
            immersive ? "border-b border-white/15 bg-blue-800 text-white" : "border-b border-slate-900/10 bg-white/72"
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="relative grid h-11 w-11 place-items-center rounded-lg bg-[linear-gradient(135deg,#0f172a,#2563eb)] text-white shadow-soft">
              <span className="absolute inset-1 rounded-md border border-white/25" />
              <BrainCircuit size={23} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-semibold tracking-normal">FileMind</h1>
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${immersive ? "bg-white text-blue-800" : "bg-blue-950 text-white"}`}>V2</span>
              </div>
              <p className={`text-xs ${immersive ? "text-blue-100" : "text-slate-500"}`}>AI directory organization wizard</p>
            </div>
          </div>

          {!immersive && <StepRail currentStep={step} />}

          <div className="flex items-center gap-2">
            {busy !== "idle" && (
              busy === "planning" ? (
                <div className="thinking-chip">
                  <BrainCircuit size={16} />
                  Thinking
                </div>
              ) : (
                <Pill tone="neutral">
                  <Loader2 size={14} className="animate-spin" />
                  {busyLabel(busy)}
                </Pill>
              )
            )}
          </div>
        </header>

        <section
          className={`relative ${
            pageScrollLocked
              ? immersive
                ? "min-h-0 flex-1 overflow-hidden p-0"
                : "min-h-0 flex-1 overflow-hidden px-6 py-5"
              : "px-6 py-5 pb-10"
          }`}
        >
          {(error || (modelError && step !== "source")) && busy !== "planning" && (
            <div className="mx-auto mb-4 flex max-w-6xl items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 shadow-sm">
              <AlertTriangle size={18} className="mt-0.5 shrink-0" />
              <div>
                <div className="font-semibold">{error ? "Attention" : "AI unavailable"}</div>
                <div>{error || modelError}</div>
              </div>
            </div>
          )}

          <AnimatePresence mode="wait">
            {busy === "planning" && (
              <WizardPanel key="planning" fullBleed>
                <PlanningScreen revising={Boolean(plan)} />
              </WizardPanel>
            )}

            {busy !== "planning" && step === "source" && (
              <WizardPanel key="source" fullBleed>
                <div className="relative h-full min-h-0 overflow-hidden bg-[radial-gradient(circle_at_18%_18%,rgba(191,219,254,0.52),transparent_30%),radial-gradient(circle_at_85%_10%,rgba(30,64,175,0.26),transparent_32%),linear-gradient(135deg,#1e40af_0%,#2563eb_52%,#93c5fd_100%)] p-10 text-white">
                  <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.10)_1px,transparent_1px),linear-gradient(0deg,rgba(255,255,255,0.08)_1px,transparent_1px)] bg-[length:72px_72px] opacity-25" />
                  <div className="relative mx-auto flex h-full max-w-2xl flex-col items-center justify-center text-center">
                    <div className="thinking-orbit mx-auto">
                      <BrainCircuit size={24} />
                    </div>
                    <h2 className="mt-8 text-5xl font-semibold tracking-normal">Choose your source.</h2>
                    <p className="mx-auto mt-4 max-w-lg text-base leading-7 text-blue-100">Organize your computer files with the help of AI.</p>
                    <button
                      className="mt-8 inline-flex h-12 w-fit items-center justify-center gap-2 rounded-md border border-white/25 bg-white px-5 text-sm font-semibold text-blue-950 shadow-lg shadow-blue-950/20 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
                      type="button"
                      onClick={refreshSelectedDirectories}
                      disabled={busy !== "idle"}
                    >
                      <FolderOpen size={17} />
                      Choose source
                    </button>

                    <AnimatePresence>
                      {directories.length > 0 && (
                      <motion.div
                        initial={{ opacity: 0, y: 14, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 8, scale: 0.98 }}
                        transition={{ type: "spring", stiffness: 190, damping: 24 }}
                        className="mt-8 w-full max-w-xl rounded-xl border border-white/18 bg-white/12 p-4 text-left shadow-2xl shadow-blue-950/20 backdrop-blur-xl"
                      >
                        <div className="text-sm font-semibold text-white">Selected source</div>
                        <div className="mt-3 space-y-2">
                          {directories.map((directory) => (
                            <div key={directory} className="break-all rounded-lg border border-white/15 bg-white/14 px-3 py-2 text-xs text-blue-50">
                              {directory}
                            </div>
                          ))}
                        </div>

                        <div className="mt-5 space-y-4">
                          <div className="flex items-center gap-2 text-sm font-semibold text-white">
                            <Settings2 size={17} />
                            Scan configuration
                          </div>
                          <label className="flex items-start justify-between gap-4 rounded-lg border border-white/15 bg-white/14 p-4 text-sm text-white">
                            <span>
                              <span className="font-semibold">Read text previews for AI context</span>
                              <span className="mt-1 block text-xs leading-5 text-blue-100">
                                Reads short excerpts from supported text files so the AI can understand more than filenames.
                              </span>
                            </span>
                            <input
                              type="checkbox"
                              className="mt-1 rounded border-white/40 text-blue-900 focus:ring-white"
                              checked={scanOptions.includeTextSnippets}
                              onChange={(event) => setScanOptions({ ...scanOptions, includeHiddenFiles: true, includeTextSnippets: event.target.checked })}
                            />
                          </label>

                          <button
                            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-md border border-white/25 bg-white px-4 text-sm font-semibold text-blue-950 shadow-lg shadow-blue-950/20 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
                            onClick={scan}
                            disabled={directories.length === 0 || busy !== "idle"}
                            type="button"
                          >
                            <ScanLine size={17} />
                            Scan
                          </button>
                        </div>
                      </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              </WizardPanel>
            )}

            {busy !== "planning" && step === "before" && snapshot && (
              <WizardPanel key="before">
                <div className="mb-4 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <button className="secondary-button h-8 px-2 text-xs" type="button" onClick={() => setStep("source")} disabled={busy !== "idle"}>
                        <ArrowLeft size={14} />
                        Source
                      </button>
                      <Pill tone="success">
                        <CheckCircle2 size={14} />
                        Snapshot ready
                      </Pill>
                    </div>
                    <h2 className="mt-3 text-2xl font-semibold tracking-normal">Current directory structure</h2>
                    <p className="mt-1 text-sm text-slate-500">Use the map and tree controls to inspect the current structure while the left panel stays browsable.</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {stats.map((item) => (
                        <span key={item.label} className="rounded-md border border-slate-900/10 bg-white/70 px-2.5 py-1 text-xs font-semibold text-slate-600">
                          {item.label}: <span className="text-slate-950">{item.value}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                  <AiGenerateControls
                    selectedModel={selectedModel}
                    models={localModelOptions}
                    canGenerate={canGenerate}
                    busy={busy}
                    onModelChange={setSelectedModel}
                    onGenerate={generatePlan}
                  />
                </div>
                <DirectoryVisualization
                  snapshot={snapshot}
                  plan={null}
                  layout="single-before"
                  showTreeSidebar
                  disableTreeView
                  onPreviewFile={(filePath) => void previewFile(filePath)}
                  onOpenInFileManager={requestOpenInFileManager}
                  heightClassName="h-[min(760px,calc(100vh-210px))] min-h-[560px]"
                />
              </WizardPanel>
            )}

            {busy !== "planning" && step === "review" && snapshot && plan && (
              <WizardPanel key="review">
                <div className="mb-4 flex items-center justify-between gap-4">
                  <div>
                    <Pill tone={blockedOperationCount > 0 ? "warning" : "success"}>
                      {validOperationCount} valid · {blockedOperationCount} blocked
                    </Pill>
                    <h2 className="mt-3 text-2xl font-semibold tracking-normal">Review the proposed organization</h2>
                    <p className="mt-1 text-sm text-slate-500">Compare before and after, then choose whether FileMind should perform the moves.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => {
                        setPlan(null);
                        setValidation(null);
                        setStep("before");
                      }}
                    >
                      <X size={16} />
                      No
                    </button>
                    <button
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-amber-500 bg-[linear-gradient(135deg,#f59e0b,#facc15)] px-3 text-sm font-semibold text-amber-950 shadow-sm transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
                      type="button"
                      disabled={busy !== "idle"}
                      onClick={() => setChangeRequestOpen(true)}
                    >
                      <MessageSquare size={16} />
                      Request Changes
                    </button>
                    <button className="danger-button" type="button" disabled={validOperationCount === 0 || busy !== "idle"} onClick={() => setConfirmApply(true)}>
                      <Play size={16} />
                      Yes, perform actions
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-[minmax(0,1fr)_340px] gap-4">
                  <DirectoryVisualization
                    snapshot={snapshot}
                    plan={plan}
                    initialView="tree"
                    onPreviewFile={(filePath) => void previewFile(filePath)}
                    onOpenInFileManager={requestOpenInFileManager}
                    onMoveAfterItem={(sourcePaths, targetFolderPath) => void manuallyMoveInPlan(sourcePaths, targetFolderPath)}
                    heightClassName="h-[min(740px,calc(100vh-260px))] min-h-[540px]"
                  />
                  <PlanSummary plan={plan} validation={validation} />
                </div>
              </WizardPanel>
            )}

            {busy !== "planning" && step === "done" && (
              <WizardPanel key="done">
                <div className="mx-auto grid h-[calc(100vh-116px)] max-w-3xl place-items-center overflow-hidden rounded-xl border border-slate-900/10 bg-white/80 p-10 text-center shadow-soft backdrop-blur-xl">
                  <div>
                    <div className="mx-auto grid h-16 w-16 place-items-center rounded-xl bg-[linear-gradient(135deg,#0f172a,#2563eb)] text-white">
                      <Sparkles size={28} />
                    </div>
                    <h2 className="mt-6 text-3xl font-semibold tracking-normal">{applyResult?.ok ? "Organization complete" : "Organization stopped"}</h2>
                    <p className="mt-3 text-sm leading-6 text-slate-600">{applyResult?.message ?? "FileMind finished the workflow."}</p>
                    <div className="mt-7 flex justify-center gap-2">
                      {applyResult?.manifestId && (
                        <button className="secondary-button" type="button" onClick={undo} disabled={busy !== "idle"}>
                          <RotateCcw size={16} />
                          Undo
                        </button>
                      )}
                      <button className="command-button" type="button" onClick={() => setStep("source")}>
                        Start another scan
                      </button>
                    </div>
                  </div>
                </div>
              </WizardPanel>
            )}
          </AnimatePresence>
        </section>
      </div>

      <Modal open={confirmApply} title="Apply organization plan" onClose={() => setConfirmApply(false)}>
        <p className="text-sm leading-6 text-slate-600">
          FileMind will move {validOperationCount} file{validOperationCount === 1 ? "" : "s"} inside the selected directories and write
          an undo manifest. {blockedOperationCount > 0 ? `${blockedOperationCount} blocked move${blockedOperationCount === 1 ? "" : "s"} will be skipped.` : ""}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button className="secondary-button" onClick={() => setConfirmApply(false)} type="button">
            Cancel
          </button>
          <button className="danger-button" onClick={applyCurrentPlan} type="button">
            <Play size={16} />
            Apply
          </button>
        </div>
      </Modal>

      <ChangeRequestPanel
        open={changeRequestOpen}
        busy={busy}
        onClose={() => setChangeRequestOpen(false)}
        onRegenerate={(request) => void regenerateWithChanges(request)}
      />

      <Modal open={Boolean(preview)} title={preview?.name ?? "Preview"} onClose={() => setPreview(null)}>
        {preview && (
          <motion.div initial={{ opacity: 0, y: 10, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.22, ease: "easeOut" }}>
            <div className="overflow-hidden rounded-lg border border-slate-900/10 bg-slate-950">
              <img src={preview.dataUrl} alt={preview.name} className="max-h-[62vh] w-full object-contain" />
            </div>
            <div className="mt-3 break-all rounded bg-slate-50 px-3 py-2 font-mono text-xs leading-5 text-slate-600">{preview.path}</div>
            <div className="mt-4 flex items-center justify-between gap-3">
              <span className="text-xs font-semibold text-slate-500">{formatBytes(preview.size)}</span>
              <button className="secondary-button" type="button" onClick={() => requestOpenInFileManager(preview.path)}>
                <FolderOpen size={16} />
                Open in directory
              </button>
            </div>
          </motion.div>
        )}
      </Modal>

      <AnimatePresence>
        {pendingOpen && (
          <motion.div
            ref={openLocationPopoverRef}
            key={pendingOpen.path}
            initial={{ opacity: 0, y: -4, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.96 }}
            transition={{ duration: 0.14, ease: "easeOut" }}
            className="fixed z-50 w-[280px] rounded-lg border border-slate-200 bg-white p-3 text-left shadow-soft"
            style={{ left: pendingOpen.x, top: pendingOpen.y }}
          >
            <div className="text-sm font-semibold text-slate-900">Open in File Explorer?</div>
            <div className="mt-2 max-h-20 overflow-auto break-all rounded bg-slate-50 px-2 py-1.5 font-mono text-[11px] leading-5 text-slate-600">
              {pendingOpen.path}
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button className="secondary-button h-8 px-2 text-xs" type="button" onClick={() => setPendingOpen(null)}>
                Cancel
              </button>
              <button className="command-button h-8 px-2 text-xs" type="button" onClick={() => void openInFileManager(pendingOpen.path)}>
                <FolderOpen size={14} />
                Open
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

    </main>
  );
}

function WizardPanel({ children, fullBleed = false }: { children: React.ReactNode; fullBleed?: boolean }): JSX.Element {
  return (
    <motion.div
      initial={{ opacity: 0, y: 18, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -14, scale: 0.99 }}
      transition={{ type: "spring", stiffness: 170, damping: 24 }}
      className={fullBleed ? "h-full" : "mx-auto max-w-[1500px]"}
    >
      {children}
    </motion.div>
  );
}

function StepRail({ currentStep }: { currentStep: WizardStep }): JSX.Element {
  const currentIndex = steps.findIndex((step) => step.id === currentStep);
  return (
    <div className="hidden items-center gap-2 lg:flex">
      {steps.map((step, index) => {
        const active = step.id === currentStep;
        const complete = index < currentIndex;
        return (
          <div key={step.id} className="flex items-center gap-2">
            <div
              className={`grid h-8 w-8 place-items-center rounded-full border text-xs font-bold ${
                active || complete ? "border-blue-950 bg-blue-950 text-white" : "border-slate-300 bg-white/70 text-slate-500"
              }`}
            >
              {complete ? <CheckCircle2 size={15} /> : index + 1}
            </div>
            <span className={`text-xs font-semibold ${active ? "text-slate-950" : "text-slate-500"}`}>{step.label}</span>
            {index < steps.length - 1 && <ChevronRight size={14} className="text-slate-400" />}
          </div>
        );
      })}
    </div>
  );
}

function AiGenerateControls({
  selectedModel,
  models,
  canGenerate,
  busy,
  onModelChange,
  onGenerate
}: {
  selectedModel: string;
  models: ReturnType<typeof availableLocalModelChoices>;
  canGenerate: boolean;
  busy: BusyState;
  onModelChange: (model: string) => void;
  onGenerate: () => void;
}): JSX.Element {
  const unavailableReason =
    models.length === 0
      ? `Install High Effort or Low Effort in Ollama before generating.`
      : !selectedModel
        ? "Choose a local effort level before generating."
        : "";

  return (
    <div className="rounded-lg border border-slate-200 bg-white/90 p-2 shadow-sm">
      <div className="flex items-center gap-2">
        <select
          aria-label="Local effort"
          className="h-10 w-[150px] rounded-md border-slate-300 bg-white text-sm text-slate-800 shadow-none focus:border-blue-800 focus:ring-blue-800"
          value={selectedModel}
          onChange={(event) => onModelChange(event.target.value)}
        >
          {models.length === 0 ? (
            <option value="">No supported models</option>
          ) : (
            models.map((model) => (
              <option value={model.model} key={model.model}>
                {model.label}
              </option>
            ))
          )}
        </select>
        <button className="command-button" type="button" onClick={() => onGenerate()} disabled={!canGenerate || busy !== "idle"}>
          <Bot size={16} />
          Generate
        </button>
      </div>
      {unavailableReason && <div className="mt-2 text-xs leading-5 text-amber-700">{unavailableReason}</div>}
    </div>
  );
}

function PlanSummary({ plan, validation }: { plan: OrganizationPlan; validation: PlanValidationResult | null }): JSX.Element {
  return (
    <aside className="overflow-hidden rounded-lg border border-slate-900/10 bg-white/82 shadow-sm backdrop-blur">
      <div className="border-b border-slate-900/10 bg-[linear-gradient(135deg,#f8fafc,#eff6ff)] p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <Sparkles size={16} className="text-blue-900" />
          Proposed plan
        </div>
        <p className="mt-3 text-sm font-semibold text-slate-900">{plan.summary}</p>
      </div>
      <div className="max-h-[calc(100vh-430px)] space-y-2 overflow-auto p-3">
        {plan.operations.map((operation) => {
          const blocked = validation?.blockedOperations.find((item) => item.operation.id === operation.id);
          return (
            <div key={operation.id ?? operation.sourcePath} className="rounded-lg border border-slate-900/10 bg-white p-3 text-xs shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-slate-500">{operation.riskLevel}</span>
                {blocked ? <Pill tone="warning">Blocked</Pill> : <Pill tone="success">Ready</Pill>}
              </div>
              <div className="mt-2 truncate text-sm font-semibold text-slate-800">{basename(operation.sourcePath)}</div>
              <div className="mt-1 break-all rounded bg-slate-50 px-2 py-1 font-mono leading-5 text-slate-600">{operation.destinationPath}</div>
              <p className="mt-2 leading-5 text-slate-600">{blocked?.reason ?? operation.reason}</p>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function PlanningScreen({ revising }: { revising: boolean }): JSX.Element {
  const [tipIndex, setTipIndex] = useState(0);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setTipIndex((current) => (current + 1) % planningTips.length);
    }, 3600);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <div className="relative h-full min-h-0 overflow-hidden bg-[radial-gradient(circle_at_18%_18%,rgba(191,219,254,0.52),transparent_30%),radial-gradient(circle_at_85%_10%,rgba(30,64,175,0.26),transparent_32%),linear-gradient(135deg,#1e40af_0%,#2563eb_52%,#93c5fd_100%)] p-10 text-white">
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.10)_1px,transparent_1px),linear-gradient(0deg,rgba(255,255,255,0.08)_1px,transparent_1px)] bg-[length:72px_72px] opacity-25" />
      <div className="relative mx-auto flex h-full max-w-3xl flex-col items-center justify-center text-center">
        <div className="thinking-orbit planning-orbit mx-auto">
          <BrainCircuit size={28} />
        </div>
        <h2 className="mt-8 text-5xl font-semibold tracking-normal">{revising ? "Reorganizing files..." : "Organizing files..."}</h2>
        <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-blue-100">
          FileMind is reviewing the scan, project clusters, text previews, and safe move rules.
        </p>

        <div className="mt-9 h-2 w-full max-w-md overflow-hidden rounded-full bg-white/18 shadow-inner">
          <motion.div
            className="h-full rounded-full bg-white"
            initial={{ x: "-80%" }}
            animate={{ x: "130%" }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
            style={{ width: "48%" }}
          />
        </div>

        <div className="absolute inset-x-0 bottom-8 mx-auto max-w-xl px-4">
          <AnimatePresence mode="wait">
            <motion.div
              key={tipIndex}
              initial={{ opacity: 0, y: 10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.98 }}
              transition={{ duration: 0.28, ease: "easeOut" }}
              className="rounded-xl border border-white/18 bg-white/12 px-4 py-3 text-sm font-semibold text-blue-50 shadow-2xl shadow-blue-950/20 backdrop-blur-xl"
            >
              {planningTips[tipIndex]}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function ChangeRequestPanel({
  open,
  busy,
  onClose,
  onRegenerate
}: {
  open: boolean;
  busy: BusyState;
  onClose: () => void;
  onRegenerate: (request: string) => void;
}): JSX.Element {
  const [draft, setDraft] = useState("");
  const dragControls = useDragControls();
  const canRegenerate = draft.trim().length > 0 && busy === "idle";

  useEffect(() => {
    if (!open) setDraft("");
  }, [open]);

  function close(): void {
    setDraft("");
    onClose();
  }

  function regenerate(): void {
    const request = draft.trim();
    if (!request) return;
    setDraft("");
    onRegenerate(request);
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: 10, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.98 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          drag
          dragControls={dragControls}
          dragListener={false}
          dragMomentum={false}
          className="fixed right-6 top-28 z-40 w-[420px] max-w-[calc(100vw-48px)] overflow-hidden rounded-xl border border-amber-200/80 bg-white/92 text-left shadow-soft backdrop-blur-xl"
        >
          <div
            className="flex cursor-move touch-none items-center justify-between gap-3 border-b border-amber-100 bg-[linear-gradient(135deg,#fffbeb,#eff6ff)] px-4 py-3"
            onPointerDown={(event) => dragControls.start(event)}
          >
            <div className="flex min-w-0 items-center gap-2">
              <div className="grid h-8 w-8 place-items-center rounded-md bg-[linear-gradient(135deg,#f59e0b,#facc15)] text-amber-950">
                <MessageSquare size={16} />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-950">Request changes</div>
                <div className="truncate text-xs text-slate-500">Drag this panel anywhere while you inspect the tree.</div>
              </div>
            </div>
            <button className="secondary-button h-8 px-2 text-xs" type="button" onClick={close}>
              <X size={14} />
            </button>
          </div>

          <div className="space-y-3 p-4">
            <p className="text-sm leading-6 text-slate-600">
              Tell FileMind what you want changed. The selected local model will regenerate the organization plan from your request.
            </p>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Example: Keep photos grouped by year, leave installers alone, and put work PDFs in a Work folder."
              className="min-h-36 w-full resize-y rounded-md border border-slate-300 bg-white p-3 text-sm leading-6 focus:border-blue-900 focus:ring-blue-900"
            />
            <div className="flex justify-end gap-2">
              <button className="secondary-button" type="button" onClick={close}>
                Cancel
              </button>
              <button className="command-button" type="button" disabled={!canRegenerate} onClick={regenerate}>
                <MessageSquare size={16} />
                Regenerate
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function readError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[index]}`;
}

function basename(filePath: string): string {
  return filePath.split(/[\\/]/).at(-1) ?? filePath;
}

function buildRevisionContext(request: string, plan: OrganizationPlan | null): string {
  const trimmedRequest = limitText(request.trim(), revisionUserRequestLimit, "User request trimmed for prompt size.");
  const previousOperations = plan?.operations
    .slice(0, 35)
    .map((operation) => `- ${basename(operation.sourcePath)} -> ${operation.destinationPath}`)
    .join("\n");
  const context = [
    "The user is unhappy with the previous organization proposal and is requesting changes.",
    plan ? `Previous plan summary: ${plan.summary}` : "",
    previousOperations ? `Previous proposed moves:\n${previousOperations}` : "",
    `User request: ${trimmedRequest}`
  ]
    .filter(Boolean)
    .join("\n\n");

  return limitText(context, revisionContextLimit, "Previous plan context trimmed for prompt size.");
}

function limitText(value: string, limit: number, note: string): string {
  if (value.length <= limit) return value;
  const suffix = `\n\n[${note}]`;
  return `${value.slice(0, Math.max(0, limit - suffix.length))}${suffix}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function busyLabel(busy: BusyState): string {
  const labels: Record<BusyState, string> = {
    idle: "Ready",
    models: "Checking models",
    installing: "Installing models",
    selecting: "Selecting",
    scanning: "Scanning",
    planning: "Thinking",
    applying: "Moving",
    undoing: "Undoing"
  };
  return labels[busy];
}

export default App;
