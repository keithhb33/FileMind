import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Archive,
  ChevronDown,
  ChevronRight,
  File,
  FileCode2,
  FolderTree,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Folder,
  Music,
  Network,
  Sparkles,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import type { DirectorySnapshot, FileNode, MoveOperation, OrganizationPlan } from "../../../shared/types";
import type { ManualMoveItem } from "../manualPlanEdits";

type VisualItem = {
  id: string;
  name: string;
  path: string;
  sourcePath?: string;
  kind: "file" | "folder";
  extension?: string;
  depth: number;
};

type TreeItem = VisualItem & {
  children: TreeItem[];
};

type ViewMode = "map" | "tree";
type LayoutMode = "comparison" | "single-before" | "single-after";
export type FileActionPoint = { x: number; y: number };

export function DirectoryVisualization({
  snapshot,
  plan,
  layout = "comparison",
  initialView = "map",
  showTreeSidebar = false,
  disableTreeView = false,
  onPreviewFile,
  onOpenInFileManager,
  onMoveAfterItem,
  heightClassName = "h-[calc(100vh-150px)] min-h-[560px]"
}: {
  snapshot: DirectorySnapshot | null;
  plan: OrganizationPlan | null;
  layout?: LayoutMode;
  initialView?: ViewMode;
  showTreeSidebar?: boolean;
  disableTreeView?: boolean;
  onPreviewFile?: (filePath: string) => void;
  onOpenInFileManager?: (filePath: string, point?: FileActionPoint) => void;
  onMoveAfterItem?: (items: ManualMoveItem[], targetFolderPath: string) => void;
  heightClassName?: string;
}): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>(initialView);
  const [mapZoom, setMapZoom] = useState(1);
  const [splitPercent, setSplitPercent] = useState(50);
  const [comparisonHeight, setComparisonHeight] = useState(620);
  const [resizing, setResizing] = useState<"horizontal" | "both" | null>(null);
  const beforeTree = useMemo(() => (snapshot ? snapshot.roots.map((root) => cloneFileNode(root, 0)) : []), [snapshot]);
  const afterTree = useMemo(() => (snapshot ? buildProjectedTree(snapshot, plan) : []), [snapshot, plan]);
  const beforeItems = useMemo(() => flattenTreeItems(beforeTree).slice(0, 260), [beforeTree]);
  const afterItems = useMemo(() => flattenTreeItems(afterTree).slice(0, 260), [afterTree]);

  useEffect(() => {
    setViewMode(disableTreeView ? "map" : initialView);
  }, [disableTreeView, initialView, layout]);

  useEffect(() => {
    if (disableTreeView && viewMode === "tree") setViewMode("map");
  }, [disableTreeView, viewMode]);

  useEffect(() => {
    if (!resizing || layout !== "comparison") return;

    function onPointerMove(event: PointerEvent): void {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      if (resizing === "horizontal" || resizing === "both") {
        setSplitPercent(clamp(((event.clientX - rect.left) / rect.width) * 100, 28, 72));
      }
      if (resizing === "both") {
        setComparisonHeight(clamp(event.clientY - rect.top, 380, Math.max(420, window.innerHeight - rect.top - 24)));
      }
    }

    function onPointerUp(): void {
      setResizing(null);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }

    document.body.style.cursor = resizing === "both" ? "nwse-resize" : "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [resizing]);

  const isSingle = layout !== "comparison";
  const focusedTree = layout === "single-after" ? afterTree : beforeTree;
  const focusedItems = layout === "single-after" ? afterItems : beforeItems;
  const focusedTitle = layout === "single-after" ? "After" : "Before";
  const focusedSubtitle = viewMode === "map" ? "Animated map view" : "Animated tree view";

  return (
    <div className={heightClassName}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="inline-flex overflow-hidden rounded-md border border-slate-900/10 bg-white/80 shadow-sm">
          <button
            type="button"
            aria-label="Map view"
            title="Map view"
            onClick={() => setViewMode("map")}
            className={`grid h-9 w-10 place-items-center ${viewMode === "map" ? "bg-blue-950 text-white" : "text-slate-600 hover:bg-slate-50"}`}
          >
            <Network size={17} />
          </button>
          {!disableTreeView && (
            <button
              type="button"
              aria-label="Tree view"
              title="Tree view"
              onClick={() => setViewMode("tree")}
              className={`grid h-9 w-10 place-items-center ${viewMode === "tree" ? "bg-blue-950 text-white" : "text-slate-600 hover:bg-slate-50"}`}
            >
              <FolderTree size={17} />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Zoom out"
            title="Zoom out"
            onClick={() => setMapZoom((current) => clamp(current - 0.15, 0.55, 1.8))}
            className="grid h-9 w-9 place-items-center rounded-md border border-slate-900/10 bg-white/80 text-slate-600 shadow-sm hover:bg-blue-50 disabled:opacity-40"
            disabled={viewMode !== "map"}
          >
            <ZoomOut size={17} />
          </button>
          <input
            aria-label="Map zoom"
            type="range"
            min={0.55}
            max={1.8}
            step={0.05}
            value={mapZoom}
            disabled={viewMode !== "map"}
            onChange={(event) => setMapZoom(Number(event.target.value))}
            className="w-28 accent-blue-900 disabled:opacity-40"
          />
          <button
            type="button"
            aria-label="Zoom in"
            title="Zoom in"
            onClick={() => setMapZoom((current) => clamp(current + 0.15, 0.55, 1.8))}
            className="grid h-9 w-9 place-items-center rounded-md border border-slate-900/10 bg-white/80 text-slate-600 shadow-sm hover:bg-blue-50 disabled:opacity-40"
            disabled={viewMode !== "map"}
          >
            <ZoomIn size={17} />
          </button>
        </div>
      </div>

      {isSingle ? (
        <div className={`grid h-[calc(100%-48px)] gap-3 ${showTreeSidebar ? "grid-cols-[280px_minmax(0,1fr)]" : "grid-cols-1"}`}>
          {showTreeSidebar && <DirectoryTreeSidebar tree={focusedTree} onPreviewFile={onPreviewFile} onOpenInFileManager={onOpenInFileManager} />}
          <VisualPanel
            title={focusedTitle}
            subtitle={focusedSubtitle}
            items={focusedItems}
            tree={focusedTree}
            mode={layout === "single-after" ? "after" : "before"}
            viewMode={viewMode}
            mapZoom={mapZoom}
            onMapZoomChange={setMapZoom}
            onPreviewFile={onPreviewFile}
            onOpenInFileManager={onOpenInFileManager}
            onMoveAfterItem={onMoveAfterItem}
            empty={!snapshot || (layout === "single-after" && !plan)}
          />
        </div>
      ) : (
      <div
        ref={containerRef}
        className="relative grid gap-0"
        style={{ gridTemplateColumns: `${splitPercent}% 8px minmax(0, 1fr)`, height: comparisonHeight }}
      >
        <VisualPanel
          title="Before"
          subtitle={viewMode === "map" ? "Current map" : "Current tree"}
          items={beforeItems}
          tree={beforeTree}
          mode="before"
          viewMode={viewMode}
          mapZoom={mapZoom}
          onMapZoomChange={setMapZoom}
          onPreviewFile={onPreviewFile}
          onOpenInFileManager={onOpenInFileManager}
          onMoveAfterItem={onMoveAfterItem}
          empty={!snapshot}
        />
        <button
          type="button"
          aria-label="Resize before and after panels"
          title="Resize before and after panels"
          onPointerDown={() => setResizing("horizontal")}
          className="mx-1 cursor-col-resize rounded bg-slate-900/10 transition hover:bg-blue-300"
        />
        <div className="flex min-h-0 flex-col gap-2">
          <div className="inline-flex w-fit items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-950">
            <Sparkles size={14} />
            Drag-select, Ctrl-click, or Shift-click items in After; drag them onto a folder to edit the plan.
          </div>
          <div className="min-h-0 flex-1">
            <VisualPanel
              title="After"
              subtitle={viewMode === "map" ? "Projected map" : "Projected tree"}
              items={afterItems}
              tree={afterTree}
              mode="after"
              viewMode={viewMode}
              mapZoom={mapZoom}
              onMapZoomChange={setMapZoom}
              onPreviewFile={onPreviewFile}
              onOpenInFileManager={onOpenInFileManager}
              onMoveAfterItem={onMoveAfterItem}
              empty={!snapshot || !plan}
            />
          </div>
        </div>
        <button
          type="button"
          aria-label="Resize comparison area"
          title="Resize comparison area"
          onPointerDown={() => setResizing("both")}
          className="absolute bottom-1 right-1 z-20 h-5 w-5 cursor-nwse-resize rounded border border-blue-300 bg-white/90 shadow-sm transition hover:bg-blue-50"
        >
          <span className="block h-full w-full bg-[linear-gradient(135deg,transparent_0_45%,#2563eb_46%_52%,transparent_53%_62%,#2563eb_63%_69%,transparent_70%)]" />
        </button>
      </div>
      )}
    </div>
  );
}

function VisualPanel({
  title,
  subtitle,
  items,
  tree,
  mode,
  viewMode,
  mapZoom,
  onMapZoomChange,
  onPreviewFile,
  onOpenInFileManager,
  onMoveAfterItem,
  empty
}: {
  title: string;
  subtitle: string;
  items?: VisualItem[];
  tree?: TreeItem[];
  mode: "before" | "after";
  viewMode: ViewMode;
  mapZoom: number;
  onMapZoomChange: (zoom: number | ((current: number) => number)) => void;
  onPreviewFile?: (filePath: string) => void;
  onOpenInFileManager?: (filePath: string, point?: FileActionPoint) => void;
  onMoveAfterItem?: (items: ManualMoveItem[], targetFolderPath: string) => void;
  empty: boolean;
}): JSX.Element {
  return (
    <section className="relative h-full overflow-hidden rounded-lg border border-slate-900/10 bg-white/84 shadow-sm backdrop-blur">
      <div className="flex h-14 items-center justify-between border-b border-slate-900/10 bg-[linear-gradient(90deg,#ffffffdd,#eff6ffdd)] px-4">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="text-xs text-slate-500">{subtitle}</p>
        </div>
        {mode === "before" ? <Network size={18} className="text-slate-500" /> : <Sparkles size={18} className="text-blue-800" />}
      </div>

      {empty ? (
        <div className="grid h-[calc(100%-56px)] place-items-center bg-slate-50/80 px-8 text-center">
          <div>
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-lg bg-slate-100 text-slate-500">
              {mode === "before" ? <Network size={24} /> : <Folder size={24} />}
            </div>
            <div className="mt-3 text-sm font-semibold text-slate-700">{mode === "before" ? "Scan a source" : "Generate a plan"}</div>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              {mode === "before" ? "The current file web will appear here." : "The organized structure will animate here."}
            </p>
          </div>
        </div>
      ) : viewMode === "map" ? (
        <ClutterWeb
          items={items ?? []}
          zoom={mapZoom}
          onZoomChange={onMapZoomChange}
          onPreviewFile={onPreviewFile}
          onOpenInFileManager={onOpenInFileManager}
        />
      ) : (
        <OrganizedTree
          tree={tree ?? []}
          editable={mode === "after"}
          onPreviewFile={onPreviewFile}
          onOpenInFileManager={onOpenInFileManager}
          onMoveItem={onMoveAfterItem}
        />
      )}
    </section>
  );
}

function ClutterWeb({
  items,
  zoom,
  onZoomChange,
  onPreviewFile,
  onOpenInFileManager
}: {
  items: VisualItem[];
  zoom: number;
  onZoomChange: (zoom: number | ((current: number) => number)) => void;
  onPreviewFile?: (filePath: string) => void;
  onOpenInFileManager?: (filePath: string, point?: FileActionPoint) => void;
}): JSX.Element {
  const wheelRef = useRef<HTMLDivElement | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragStart = useRef<{ pointerId: number; x: number; y: number; panX: number; panY: number } | null>(null);
  const panFrame = useRef<number | null>(null);
  const pendingPan = useRef(pan);

  useEffect(() => {
    pendingPan.current = pan;
  }, [pan]);

  useEffect(() => {
    return () => {
      if (panFrame.current) window.cancelAnimationFrame(panFrame.current);
    };
  }, []);

  useEffect(() => {
    const element = wheelRef.current;
    if (!element) return;

    function zoomWithWheel(event: WheelEvent): void {
      event.preventDefault();
      event.stopPropagation();
      const step = event.deltaY > 0 ? -0.08 : 0.08;
      onZoomChange((current) => clamp(current + step, 0.55, 1.8));
    }

    element.addEventListener("wheel", zoomWithWheel, { passive: false });
    return () => element.removeEventListener("wheel", zoomWithWheel);
  }, [onZoomChange]);

  function startPan(event: React.PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return;
    dragStart.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      panX: pan.x,
      panY: pan.y
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function movePan(event: React.PointerEvent<HTMLDivElement>): void {
    const start = dragStart.current;
    if (!start || start.pointerId !== event.pointerId) return;
    pendingPan.current = {
      x: start.panX + event.clientX - start.x,
      y: start.panY + event.clientY - start.y
    };
    if (panFrame.current) return;
    panFrame.current = window.requestAnimationFrame(() => {
      panFrame.current = null;
      setPan(pendingPan.current);
    });
  }

  function stopPan(event: React.PointerEvent<HTMLDivElement>): void {
    if (dragStart.current?.pointerId === event.pointerId) dragStart.current = null;
  }

  function previewItem(item: VisualItem): void {
    if (item.kind === "file" && isImageFile(item)) onPreviewFile?.(actionPathForItem(item));
  }

  function openItemLocation(event: React.MouseEvent, item: VisualItem): void {
    event.preventDefault();
    event.stopPropagation();
    onOpenInFileManager?.(actionPathForItem(item), { x: event.clientX, y: event.clientY });
  }

  return (
    <div
      ref={wheelRef}
      className="relative h-[calc(100%-56px)] cursor-grab overflow-hidden overscroll-contain bg-slate-50 active:cursor-grabbing"
      onPointerDown={startPan}
      onPointerMove={movePan}
      onPointerUp={stopPan}
      onPointerCancel={stopPan}
    >
      <div
        className="absolute left-1/2 top-1/2 h-[820px] w-[1120px] will-change-transform"
        style={{ transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px)) scale(${zoom})`, transformOrigin: "center" }}
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_24px_24px,rgba(37,99,235,0.11)_1px,transparent_1px)] bg-[length:48px_48px]" />
        <AnimatePresence>
          {items.map((item, index) => {
            const x = 8 + ((index * 37) % 76);
            const y = 8 + ((index * 53) % 78);
            const pixelX = (x / 100) * 1120;
            const pixelY = (y / 100) * 820;
            return (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, scale: 0.82, x: pixelX, y: pixelY }}
                animate={{ opacity: 1, scale: 1, x: pixelX, y: pixelY }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ type: "spring", stiffness: 260, damping: 30, mass: 0.7 }}
                className={`absolute left-0 top-0 flex max-w-[150px] -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-md border border-slate-900/10 bg-white/95 px-2 py-1.5 text-xs shadow-sm will-change-transform ${
                  isImageFile(item) ? "cursor-pointer hover:border-blue-300 hover:bg-blue-50" : "cursor-default"
                }`}
                title={isImageFile(item) ? `${item.path}\nClick to preview. Right-click to show in folder.` : `${item.path}\nRight-click to show in folder.`}
                onClick={() => previewItem(item)}
                onContextMenu={(event) => openItemLocation(event, item)}
                onPointerDown={(event) => event.stopPropagation()}
              >
                <FileIcon item={item} />
                <span className="truncate">{item.name}</span>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}

function DirectoryTreeSidebar({
  tree,
  onPreviewFile,
  onOpenInFileManager
}: {
  tree: TreeItem[];
  onPreviewFile?: (filePath: string) => void;
  onOpenInFileManager?: (filePath: string, point?: FileActionPoint) => void;
}): JSX.Element {
  const [expanded, setExpanded] = useState<Set<string>>(() => initialExpanded(tree));
  const visibleItems = useMemo(() => flattenVisibleTree(tree, expanded), [tree, expanded]);

  useEffect(() => {
    setExpanded(initialExpanded(tree));
  }, [tree]);

  function toggle(item: TreeItem): void {
    if (item.kind !== "folder") return;
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
  }

  function activate(item: TreeItem): void {
    if (item.kind === "folder") toggle(item);
    else if (isImageFile(item)) onPreviewFile?.(actionPathForItem(item));
  }

  function openItemLocation(event: React.MouseEvent, item: TreeItem): void {
    event.preventDefault();
    event.stopPropagation();
    onOpenInFileManager?.(actionPathForItem(item), { x: event.clientX, y: event.clientY });
  }

  return (
    <aside className="overflow-hidden rounded-lg border border-slate-900/10 bg-white/80 shadow-sm backdrop-blur">
      <div className="flex h-14 items-center gap-2 border-b border-slate-900/10 bg-[linear-gradient(90deg,#f8fafc,#eff6ff)] px-4">
        <div>
          <div className="text-sm font-semibold text-slate-900">Directory tree</div>
          <div className="text-xs text-slate-500">{visibleItems.length.toLocaleString()} visible nodes</div>
        </div>
      </div>
      <div className="h-[calc(100%-56px)] overflow-auto bg-slate-50/80 p-3">
        <div className="space-y-1">
          {visibleItems.map((item) => (
            <button
              type="button"
              key={item.id}
              className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs text-slate-700 hover:bg-blue-50"
              style={{ paddingLeft: `${8 + Math.min(item.depth, 8) * 14}px` }}
              onClick={() => activate(item)}
              onContextMenu={(event) => openItemLocation(event, item)}
              title={isImageFile(item) ? `${item.path}\nClick to preview. Right-click to show in folder.` : `${item.path}\nRight-click to show in folder.`}
            >
              {item.kind === "folder" ? (
                expanded.has(item.id) ? <ChevronDown size={14} className="shrink-0 text-slate-400" /> : <ChevronRight size={14} className="shrink-0 text-slate-400" />
              ) : (
                <span className="h-3.5 w-3.5 shrink-0" />
              )}
              <FileIcon item={item} />
              <span className="truncate">{item.name}</span>
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}

function OrganizedTree({
  tree,
  editable = false,
  onPreviewFile,
  onOpenInFileManager,
  onMoveItem
}: {
  tree: TreeItem[];
  editable?: boolean;
  onPreviewFile?: (filePath: string) => void;
  onOpenInFileManager?: (filePath: string, point?: FileActionPoint) => void;
  onMoveItem?: (items: ManualMoveItem[], targetFolderPath: string) => void;
}): JSX.Element {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => initialExpanded(tree));
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  const [dragItems, setDragItems] = useState<ManualMoveItem[]>([]);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  const [selectionBox, setSelectionBox] = useState<{ startX: number; startY: number; currentX: number; currentY: number } | null>(null);
  const marquee = useRef<{ pointerId: number; additive: boolean; base: Set<string> } | null>(null);
  const visibleItems = useMemo(() => flattenVisibleTree(tree, expanded), [tree, expanded]);

  useEffect(() => {
    setExpanded(initialExpanded(tree));
  }, [tree]);

  useEffect(() => {
    const visiblePaths = new Set(visibleItems.map((item) => actionPathForItem(item)));
    setSelectedPaths((current) => new Set([...current].filter((path) => visiblePaths.has(path))));
  }, [visibleItems]);

  function toggle(item: TreeItem): void {
    if (item.kind !== "folder") return;
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
  }

  function previewItem(item: TreeItem): void {
    if (item.kind === "file" && isImageFile(item)) onPreviewFile?.(actionPathForItem(item));
  }

  function selectItem(event: React.MouseEvent, item: TreeItem, index: number): void {
    if (!editable) {
      previewItem(item);
      return;
    }

    const itemPath = actionPathForItem(item);
    if (event.shiftKey && lastSelectedIndex !== null) {
      const start = Math.min(lastSelectedIndex, index);
      const end = Math.max(lastSelectedIndex, index);
      const range = visibleItems.slice(start, end + 1).map((visibleItem) => actionPathForItem(visibleItem));
      setSelectedPaths(new Set(range));
      return;
    }

    if (event.metaKey || event.ctrlKey) {
      setSelectedPaths((current) => {
        const next = new Set(current);
        if (next.has(itemPath)) next.delete(itemPath);
        else next.add(itemPath);
        return next;
      });
      setLastSelectedIndex(index);
      return;
    }

    setSelectedPaths(new Set([itemPath]));
    setLastSelectedIndex(index);
  }

  function openItemLocation(event: React.MouseEvent, item: TreeItem): void {
    event.preventDefault();
    event.stopPropagation();
    onOpenInFileManager?.(actionPathForItem(item), { x: event.clientX, y: event.clientY });
  }

  function startDrag(event: React.DragEvent, item: TreeItem): void {
    if (!editable) return;
    const sourcePath = actionPathForItem(item);
    const paths = selectedPaths.has(sourcePath) ? [...selectedPaths] : [sourcePath];
    const selectedItems = paths
      .map((path) => visibleItems.find((visibleItem) => actionPathForItem(visibleItem) === path))
      .filter((visibleItem): visibleItem is TreeItem => Boolean(visibleItem))
      .map((visibleItem) => manualMoveItemForTreeItem(visibleItem));
    setSelectedPaths(new Set(paths));
    setDragItems(selectedItems);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-filemind-items", JSON.stringify(selectedItems));
    event.dataTransfer.setData("text/plain", paths.join("\n"));
  }

  function enterDropTarget(event: React.DragEvent, item: TreeItem): void {
    if (!editable || item.kind !== "folder") return;
    event.preventDefault();
    const targetPath = item.path;
    const items = readDraggedItems(event) || dragItems;
    if (items.length === 0 || items.some((draggedItem) => normalizePath(draggedItem.projectedPath) === normalizePath(targetPath))) return;
    setDropTargetPath(targetPath);
    event.dataTransfer.dropEffect = "move";
  }

  function leaveDropTarget(item: TreeItem): void {
    if (dropTargetPath === item.path) setDropTargetPath(null);
  }

  function dropOnFolder(event: React.DragEvent, item: TreeItem): void {
    if (!editable || item.kind !== "folder") return;
    event.preventDefault();
    event.stopPropagation();
    const items = readDraggedItems(event) || dragItems;
    setDragItems([]);
    setDropTargetPath(null);
    const filtered = items.filter((draggedItem) => {
      const source = normalizePath(draggedItem.projectedPath);
      const target = normalizePath(item.path);
      return source !== target && !target.startsWith(`${source}/`);
    });
    if (filtered.length === 0) return;
    onMoveItem?.(filtered, item.path);
    setSelectedPaths(new Set());
  }

  function startMarquee(event: React.PointerEvent<HTMLDivElement>): void {
    if (!editable || event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("[data-tree-item='true']")) return;
    marquee.current = {
      pointerId: event.pointerId,
      additive: event.metaKey || event.ctrlKey,
      base: event.metaKey || event.ctrlKey ? new Set(selectedPaths) : new Set()
    };
    if (!event.metaKey && !event.ctrlKey) setSelectedPaths(new Set());
    setSelectionBox({ startX: event.clientX, startY: event.clientY, currentX: event.clientX, currentY: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function updateMarquee(event: React.PointerEvent<HTMLDivElement>): void {
    const active = marquee.current;
    if (!active || active.pointerId !== event.pointerId || !selectionBox) return;
    const box = { ...selectionBox, currentX: event.clientX, currentY: event.clientY };
    setSelectionBox(box);
    const selected = pathsInBox(box);
    setSelectedPaths(active.additive ? new Set([...active.base, ...selected]) : new Set(selected));
  }

  function stopMarquee(event: React.PointerEvent<HTMLDivElement>): void {
    if (marquee.current?.pointerId !== event.pointerId) return;
    marquee.current = null;
    setSelectionBox(null);
  }

  function pathsInBox(box: { startX: number; startY: number; currentX: number; currentY: number }): string[] {
    const rect = normalizedRect(box);
    return [...(scrollRef.current?.querySelectorAll<HTMLElement>("[data-tree-path]") ?? [])]
      .filter((element) => intersects(rect, element.getBoundingClientRect()))
      .map((element) => element.dataset.treePath)
      .filter((path): path is string => Boolean(path));
  }

  return (
    <div
      ref={scrollRef}
      className="relative h-[calc(100%-56px)] select-none overflow-auto bg-slate-50 p-4"
      onPointerDown={startMarquee}
      onPointerMove={updateMarquee}
      onPointerUp={stopMarquee}
      onPointerCancel={stopMarquee}
    >
      {selectionBox && <div className="pointer-events-none fixed z-50 rounded border border-blue-500 bg-blue-400/15" style={selectionBoxStyle(selectionBox)} />}
      <div className="space-y-1">
        <AnimatePresence>
          {visibleItems.map((item, index) => {
            const itemPath = actionPathForItem(item);
            const selected = selectedPaths.has(itemPath);
            return (
            <motion.div
              layout
              key={item.id}
              data-tree-item="true"
              data-tree-path={itemPath}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 12 }}
              transition={{ type: "spring", stiffness: 210, damping: 24 }}
              className={`flex h-9 items-center gap-2 rounded-md border px-2 text-sm ${
                dropTargetPath === item.path
                  ? "border-blue-500 bg-blue-100/90"
                  : selected
                    ? "border-blue-500 bg-blue-100 text-blue-950"
                    : "border-transparent bg-white/78 hover:border-blue-900/10 hover:bg-blue-50/70"
              } ${editable ? "cursor-grab active:cursor-grabbing" : ""}`}
              style={{ marginLeft: `${Math.min(item.depth, 7) * 18}px` }}
              title={
                isImageFile(item)
                  ? `${item.path}\nClick to preview. Right-click to show in folder.`
                  : editable
                    ? `${item.path}\nDrag onto a folder to edit the plan. Right-click to show in folder.`
                    : `${item.path}\nRight-click to show in folder.`
              }
              draggable={editable}
              onDragStartCapture={(event) => startDrag(event, item)}
              onDragEndCapture={() => {
                setDragItems([]);
                setDropTargetPath(null);
              }}
              onDragOver={(event) => enterDropTarget(event, item)}
              onDragEnter={(event) => enterDropTarget(event, item)}
              onDragLeave={() => leaveDropTarget(item)}
              onDrop={(event) => dropOnFolder(event, item)}
              onClick={(event) => selectItem(event, item, index)}
              onContextMenu={(event) => openItemLocation(event, item)}
            >
              {item.kind === "folder" ? (
                <button
                  type="button"
                  aria-label={`${expanded.has(item.id) ? "Collapse" : "Expand"} ${item.name}`}
                  className="grid h-6 w-6 shrink-0 place-items-center rounded text-stone-500 hover:bg-stone-100 hover:text-stone-900"
                  onClick={(event) => {
                    event.stopPropagation();
                    toggle(item);
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    enterDropTarget(event, item);
                  }}
                  onDrop={(event) => dropOnFolder(event, item)}
                >
                  {expanded.has(item.id) ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                </button>
              ) : (
                <span className="h-6 w-6 shrink-0" />
              )}
              <FileIcon item={item} />
              <span className="truncate">{item.name}</span>
              {selected && <span className="ml-auto shrink-0 rounded bg-blue-900 px-1.5 py-0.5 text-[10px] font-bold text-white">Selected</span>}
              {item.kind === "folder" && (
                <span className="ml-auto shrink-0 text-[11px] text-stone-400">{countChildren(item).toLocaleString()}</span>
              )}
            </motion.div>
          );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}

function FileIcon({ item }: { item: VisualItem }): JSX.Element {
  if (item.kind === "folder") return <Folder size={17} className="shrink-0 text-amber-700" />;

  const extension = item.extension?.toLowerCase() ?? "";
  if (isImageFile(item)) {
    return <FileImage size={17} className="shrink-0 text-cyan-700" />;
  }
  if ([".mp4", ".mov", ".avi", ".mkv"].includes(extension)) {
    return <FileVideo size={17} className="shrink-0 text-rose-700" />;
  }
  if ([".mp3", ".wav", ".flac", ".m4a"].includes(extension)) {
    return <Music size={17} className="shrink-0 text-violet-700" />;
  }
  if ([".zip", ".tar", ".gz", ".rar", ".7z"].includes(extension)) {
    return <Archive size={17} className="shrink-0 text-stone-600" />;
  }
  if ([".csv", ".xls", ".xlsx"].includes(extension)) {
    return <FileSpreadsheet size={17} className="shrink-0 text-emerald-700" />;
  }
  if ([".ts", ".tsx", ".js", ".jsx", ".py", ".rs", ".go", ".java"].includes(extension)) {
    return <FileCode2 size={17} className="shrink-0 text-blue-700" />;
  }
  if ([".txt", ".md", ".pdf", ".doc", ".docx"].includes(extension)) {
    return <FileText size={17} className="shrink-0 text-indigo-700" />;
  }

  return <File size={17} className="shrink-0 text-stone-600" />;
}

function readDraggedItems(event: React.DragEvent): ManualMoveItem[] | undefined {
  const structured = event.dataTransfer.getData("application/x-filemind-items");
  if (structured) {
    try {
      const parsed = JSON.parse(structured);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (item): item is ManualMoveItem =>
            Boolean(item) && (typeof item.sourcePath === "string" || typeof item.sourcePath === "undefined") && typeof item.projectedPath === "string"
        );
      }
    } catch {
      return undefined;
    }
  }

  const text = event.dataTransfer.getData("text/plain");
  return text
    ? text
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean)
        .map((path) => ({ sourcePath: path, projectedPath: path }))
    : undefined;
}

function manualMoveItemForTreeItem(item: VisualItem): ManualMoveItem {
  return {
    sourcePath: actionPathForItem(item),
    projectedPath: item.path
  };
}

function normalizedRect(box: { startX: number; startY: number; currentX: number; currentY: number }): DOMRect {
  const left = Math.min(box.startX, box.currentX);
  const top = Math.min(box.startY, box.currentY);
  const width = Math.abs(box.currentX - box.startX);
  const height = Math.abs(box.currentY - box.startY);
  return new DOMRect(left, top, width, height);
}

function selectionBoxStyle(box: { startX: number; startY: number; currentX: number; currentY: number }): React.CSSProperties {
  const rect = normalizedRect(box);
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height
  };
}

function intersects(a: DOMRect, b: DOMRect): boolean {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
}

function isImageFile(item: VisualItem): boolean {
  return item.kind === "file" && [".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".bmp"].includes(item.extension?.toLowerCase() ?? "");
}

function actionPathForItem(item: VisualItem): string {
  return item.sourcePath ?? item.path;
}

function flattenFileNodes(nodes: FileNode[], depth = 0): VisualItem[] {
  return nodes.flatMap((node) => [
    {
      id: node.id,
      name: node.name,
      path: node.absolutePath,
      sourcePath: node.absolutePath,
      kind: node.kind,
      extension: node.extension,
      depth
    },
    ...(node.children ? flattenFileNodes(node.children, depth + 1) : [])
  ]);
}

function flattenTreeItems(nodes: TreeItem[]): VisualItem[] {
  return nodes.flatMap((node) => [
    {
      id: node.id,
      name: node.name,
      path: node.path,
      sourcePath: node.sourcePath,
      kind: node.kind,
      extension: node.extension,
      depth: node.depth
    },
    ...flattenTreeItems(node.children)
  ]);
}

function buildProjectedTree(snapshot: DirectorySnapshot, plan: OrganizationPlan | null): TreeItem[] {
  const roots = snapshot.roots.map((root) => cloneFileNode(root, 0));
  if (!plan) return roots;

  for (const operation of plan.operations) {
    projectMove(roots, operation);
  }

  pruneEmptyProjectedFolders(roots, true);
  sortTree(roots);
  return roots;
}

function cloneFileNode(node: FileNode, depth: number): TreeItem {
  return {
    id: `current:${normalizePath(node.absolutePath)}`,
    name: node.name,
    path: node.absolutePath,
    sourcePath: node.absolutePath,
    kind: node.kind,
    extension: node.extension,
    depth,
    children: node.children?.map((child) => cloneFileNode(child, depth + 1)) ?? []
  };
}

function projectMove(roots: TreeItem[], operation: MoveOperation): void {
  const sourcePath = normalizePath(operation.sourcePath);
  const destinationPath = normalizePath(operation.destinationPath);
  const removed = removeNode(roots, sourcePath);
  if (!removed) return;

  const root = findContainingRoot(roots, destinationPath);
  if (!root) {
    insertNodeAtPath(roots, sourcePath, removed);
    return;
  }

  const relativeDestination = relativePath(root.path, destinationPath);
  const segments = relativeDestination.split("/").filter(Boolean);
  if (segments.length === 0) {
    insertNodeAtPath(roots, sourcePath, removed);
    return;
  }

  const fileName = segments.at(-1) ?? removed.name;
  const folderSegments = segments.slice(0, -1);
  let parent = root;
  for (const segment of folderSegments) {
    parent = findOrCreateFolder(parent, segment);
  }

  parent.children.push({
    ...removed,
    id: `projected:${destinationPath}`,
    name: fileName,
    path: operation.destinationPath,
    sourcePath: removed.sourcePath ?? removed.path,
    extension: extensionOf(fileName),
    depth: parent.depth + 1,
    children: removed.kind === "folder" ? removed.children : []
  });
  refreshDepths(root, root.depth);
}

function removeNode(nodes: TreeItem[], targetPath: string): TreeItem | undefined {
  const index = nodes.findIndex((node) => normalizePath(node.path) === targetPath);
  if (index >= 0) return nodes.splice(index, 1)[0];

  for (const node of nodes) {
    const removed = removeNode(node.children, targetPath);
    if (removed) return removed;
  }

  return undefined;
}

function insertNodeAtPath(roots: TreeItem[], pathToRestore: string, node: TreeItem): void {
  const root = findContainingRoot(roots, pathToRestore);
  if (!root) {
    roots.push(node);
    return;
  }

  const relative = relativePath(root.path, pathToRestore);
  const segments = relative.split("/").filter(Boolean);
  const folderSegments = segments.slice(0, -1);
  let parent = root;
  for (const segment of folderSegments) {
    parent = findOrCreateFolder(parent, segment);
  }
  parent.children.push(node);
  refreshDepths(root, root.depth);
}

function findContainingRoot(roots: TreeItem[], candidatePath: string): TreeItem | undefined {
  return roots.find((root) => {
    const rootPath = normalizePath(root.path);
    return candidatePath === rootPath || candidatePath.startsWith(`${rootPath}/`);
  });
}

function findOrCreateFolder(parent: TreeItem, name: string): TreeItem {
  const existing = parent.children.find((child) => child.kind === "folder" && child.name === name);
  if (existing) return existing;

  const folderPath = `${normalizePath(parent.path)}/${name}`;
  const folder: TreeItem = {
    id: `projected-folder:${folderPath}`,
    name,
    path: folderPath,
    kind: "folder",
    depth: parent.depth + 1,
    children: []
  };
  parent.children.push(folder);
  return folder;
}

function refreshDepths(node: TreeItem, depth: number): void {
  node.depth = depth;
  for (const child of node.children) refreshDepths(child, depth + 1);
}

function sortTree(nodes: TreeItem[]): void {
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const node of nodes) sortTree(node.children);
}

function pruneEmptyProjectedFolders(nodes: TreeItem[], keepCurrentLevel = false): TreeItem[] {
  for (const node of nodes) {
    node.children = pruneEmptyProjectedFolders(node.children);
  }

  if (keepCurrentLevel) return nodes;
  return nodes.filter((node) => node.kind !== "folder" || node.children.length > 0);
}

function flattenVisibleTree(nodes: TreeItem[], expanded: Set<string>): TreeItem[] {
  return nodes.flatMap((node) => [
    node,
    ...(node.kind === "folder" && expanded.has(node.id) ? flattenVisibleTree(node.children, expanded) : [])
  ]);
}

function initialExpanded(nodes: TreeItem[]): Set<string> {
  const expanded = new Set<string>();
  for (const node of nodes) {
    if (node.kind === "folder") expanded.add(node.id);
  }
  return expanded;
}

function countChildren(item: TreeItem): number {
  return item.children.reduce((total, child) => total + 1 + (child.kind === "folder" ? countChildren(child) : 0), 0);
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/\/+$/, "");
}

function relativePath(rootPath: string, childPath: string): string {
  const root = normalizePath(rootPath);
  const child = normalizePath(childPath);
  return child.startsWith(`${root}/`) ? child.slice(root.length + 1) : child;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
