import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { generate, inpaint, type RunProgress } from './core/pipeline/orchestrator';
import { DraftCache, generationKey, type PreparedGeneration } from './core/pipeline/draftCache';
import { RunFailureDialog } from './ui/RunFailureDialog';
import { isTimeout, TimeoutError } from './core/net/transport';
import { userFacingReason } from './core/net/friendly';
import { deleteProject, listProjects, loadProject, saveProject, type ProjectMeta } from './core/projects';
import { ProviderError, type ProviderConfig, type ProviderId } from './core/providers/types';
import {
  createDefaultSettings,
  loadSettings,
  saveSettings,
  type Settings,
} from './core/settings';
import { createDefaultIntent, type Artboard, type DrawingIntent, type MaskRegion } from './core/types';
import { createDefaultCadWorkspace } from './core/cad';
import { createSafeId } from './core/projectSafety';
import { shouldOverlayLabels } from './core/textOverlay';
import { sheetLayout } from './core/sheetLayout';
import { sheetFurniture, sheetViewHeight } from './core/sheetFurniture';
import { buildSheetSvg } from './core/sheetSvg';
import { rasterizeSheetSvg } from './core/sheetRaster';
import { cadSuitability, sheetToDxf } from './core/cadExport';
import { hasMeasurementRows } from './core/prompt/builder';
import { resolveRunTimeoutSec } from './core/runTimeout';
import { I18nProvider, useT } from './i18n';
import { DrawingCanvas } from './ui/DrawingCanvas';
import {
  IconClose,
  IconDimension,
  IconExport,
  IconCad,
  IconFolder,
  IconGenerate,
  IconHistory,
  IconMask,
  IconNew,
  IconSave,
  IconSettings,
  IconZoomFit,
} from './ui/icons';
import { IntentPanel } from './ui/IntentPanel';
import { Button, Dot, Field, Section, Select } from './ui/primitives';
import { SettingsSheet, type CategoryId } from './ui/SettingsSheet';
import { UpdatePromptDialog } from './ui/UpdatePromptDialog';
import { canAutoUpdate, updateBackend, type UpdateInfo } from './core/update';
import { ProjectSheet } from './ui/ProjectSheet';
import { CadToolbar } from './ui/CadToolbar';
import './ui/shell.css';
import './ui/cad-toolbar.css';
import './ui/utility-dialog.css';

type RunState =
  | { kind: 'idle' }
  | { kind: 'busy'; progress: RunProgress; startedAt: number; limitSec: number }
  | { kind: 'error'; message: string; hint?: string };

/* ============================================================================
   設定的載入是非同步的（值來自 %APPDATA% 的原生設定檔，透過宿主橋接讀取），
   所以這裡刻意分成兩層：

   App          持有 settings 與 hydrated 旗標，並提供 I18nProvider
   Workspace    真正的畫面；useT() 必須在 Provider 內側才取得到字典

   hydrated 旗標不是裝飾：若在讀檔完成前就讓「設定變更 → 寫檔」的 effect 跑起來，
   首次掛載時的預設值會立刻把使用者的設定檔覆蓋掉 —— 那正是「每次開啟都被重置」
   的第二種寫法。所以寫入 effect 一律等 hydrated 為真才動作。
   ========================================================================== */

export default function App() {
  const [settings, setSettings] = useState<Settings>(createDefaultSettings);
  const [hydrated, setHydrated] = useState(false);
  /* 開機自動檢查的結果。與設定頁各自獨立：這邊只負責「啟動時發現有新版」
     就提示一次，不做下載（下載仍在設定 → 更新頁，流程與狀態機都完整）。 */
  const [autoUpdateInfo, setAutoUpdateInfo] = useState<UpdateInfo | null>(null);
  /* 開機更新提示按「前往更新」時，要直接把設定頁開到「更新」分頁。 */
  const [settingsCategory, setSettingsCategory] = useState<CategoryId | null>(null);

  useEffect(() => {
    let alive = true;
    void loadSettings().then((s) => {
      if (!alive) return;
      setSettings(s);
      setHydrated(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  // 設定變更立即持久化：專業工具不該有「儲存」按鈕帶來的資料遺失風險
  useEffect(() => {
    if (!hydrated) return;
    void saveSettings(settings);
  }, [hydrated, settings]);

  /* 開機自動檢查更新（設定 → 更新 → 「自動檢查更新」，預設開啟）。
     這個開關以前沒有任何地方消費，是死設定 —— 現在接上了。
     三個刻意的設計：
     1) 等 hydrated：否則讀到的是預設值，會蓋掉使用者關掉自動檢查的選擇。
     2) 失敗靜默：開機第一秒不該被網路錯誤打斷，手動檢查仍在設定頁。
     3) 只提示、不在這裡下載：下載流程（進度、驗證、安裝）在設定頁，
       兩邊同時下載會讓 Go 端的單一視窗保護複雜化，沒有好處。 */
  useEffect(() => {
    if (!hydrated) return;
    if (!settings.updates.autoCheck) return;
    if (settings.updates.channel === 'none') return;
    if (!canAutoUpdate()) return; // 開發模式（瀏覽器沙箱）沒有 updater
    let alive = true;
    void updateBackend()
      .check(settings.updates.channel)
      .then((info) => {
        if (alive && info) setAutoUpdateInfo(info);
      })
      .catch(() => {
        /* 靜默：開機檢查失敗不顯示錯誤，使用者仍可手動檢查 */
      });
    return () => {
      alive = false;
    };
  }, [hydrated, settings.updates.autoCheck, settings.updates.channel]);

  // 主題套用：system 模式跟隨作業系統並即時響應
  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme !== 'system') {
      root.dataset.theme = settings.theme;
      return;
    }
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const apply = () => {
      root.dataset.theme = mq.matches ? 'light' : 'dark';
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [settings.theme]);

  return (
    <I18nProvider locale={settings.language}>
      <Workspace
        settings={settings}
        onSettings={setSettings}
        settingsCategory={settingsCategory}
        onSettingsCategory={setSettingsCategory}
      />
      {autoUpdateInfo && (
        <UpdatePromptDialog
          version={autoUpdateInfo.version}
          onLater={() => setAutoUpdateInfo(null)}
          onGoToUpdate={() => {
            setAutoUpdateInfo(null);
            setSettingsCategory('updates');
          }}
        />
      )}
    </I18nProvider>
  );
}

function Workspace({
  settings,
  onSettings,
  settingsCategory,
  onSettingsCategory,
}: {
  settings: Settings;
  onSettings: (s: Settings) => void;
  /** 設定頁要開啟的分頁；由 App 層的更新提示指定（updates）。 */
  settingsCategory: CategoryId | null;
  /** 切換設定頁分頁 */
  onSettingsCategory: (category: CategoryId | null) => void;
}) {
  const t = useT();
  const [settingsOpen, setSettingsOpen] = useState(false);
  /* App 層指定分頁時（例如開機更新提示的「前往更新」）自動開啟設定頁。 */
  useEffect(() => {
    if (settingsCategory) setSettingsOpen(true);
  }, [settingsCategory]);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [projectDialog, setProjectDialog] = useState<null | { kind: 'new' } | { kind: 'save'; value: string } | { kind: 'delete'; id: string } | { kind: 'close' } | { kind: 'open'; id: string }>(null);
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState('');
  const initialIntentRef = useRef(createDefaultIntent());
  const initialCadWorkspaceRef = useRef(createDefaultCadWorkspace());
  const [intent, setIntent] = useState<DrawingIntent>(initialIntentRef.current);
  const [history, setHistory] = useState<Artboard[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [masks, setMasks] = useState<MaskRegion[]>([]);
  const [maskMode, setMaskMode] = useState(false);
  const [zoomBoxMode, setZoomBoxMode] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [cadWorkspace, setCadWorkspace] = useState(initialCadWorkspaceRef.current);
  const [run, setRun] = useState<RunState>({ kind: 'idle' });
  const abortRef = useRef<AbortController | null>(null);
  const draftCacheRef = useRef(new DraftCache());
  const [generationFailure, setGenerationFailure] = useState<{ key: string; message: string } | null>(null);
  const [failureOpen, setFailureOpen] = useState(false);
  const retryKey = useMemo(() => generationKey(intent, settings.canvas), [intent, settings.canvas.width, settings.canvas.height]);

  // Drawing changes invalidate text work; changing an engine or timeout does not.
  useEffect(() => {
    draftCacheRef.current.forget();
    setGenerationFailure(null);
    setFailureOpen(false);
  }, [retryKey]);
  const savedSnapshotRef = useRef(JSON.stringify({ intent: initialIntentRef.current, history: [], currentId: null, masks: [], showGrid: true, cadWorkspace: initialCadWorkspaceRef.current }));
  const closeAfterSaveRef = useRef(false);

  const projectSnapshot = useMemo(() => JSON.stringify({ intent, history, currentId, masks, showGrid, cadWorkspace }), [cadWorkspace, currentId, history, intent, masks, showGrid]);
  const hasUnsavedChanges = projectSnapshot !== savedSnapshotRef.current;

  const current = useMemo(
    () => history.find((a) => a.id === currentId) ?? null,
    [history, currentId],
  );

  /** 刪除單筆歷程。刪掉目前檢視的版本時，順移到同位置的下一筆（沒有就退到上一筆）。 */
  const removeHistory = useCallback(
    (id: string) => {
      const index = history.findIndex((a) => a.id === id);
      if (index === -1) return;
      const next = history.filter((a) => a.id !== id);
      setHistory(next);
      if (currentId === id) {
        setCurrentId(next[Math.min(index, next.length - 1)]?.id ?? null);
        setMasks([]);
      }
    },
    [currentId, history],
  );

  useEffect(() => () => abortRef.current?.abort(), []);

  const busy = run.kind === 'busy';
  const ratio = settings.canvas.width / settings.canvas.height;

  const newProject = useCallback(() => {
    if (busy) return;
    setProjectDialog({ kind: 'new' });
  }, [busy]);

  const confirmNewProject = useCallback(() => {
    draftCacheRef.current.forget();
    setGenerationFailure(null);
    setFailureOpen(false);
    const nextIntent = createDefaultIntent();
    setProjectId(null);
    setProjectName('');
    setIntent(nextIntent);
    setHistory([]);
    setCurrentId(null);
    setMasks([]);
    setMaskMode(false);
    setZoomBoxMode(false);
    setShowGrid(true);
    const nextCadWorkspace = createDefaultCadWorkspace();
    setCadWorkspace(nextCadWorkspace);
    savedSnapshotRef.current = JSON.stringify({ intent: nextIntent, history: [], currentId: null, masks: [], showGrid: true, cadWorkspace: nextCadWorkspace });
    setRun({ kind: 'idle' });
    setProjectDialog(null);
  }, []);

  const saveProjectWithName = useCallback(async (name: string) => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const id = projectId ?? createSafeId('project');
    try {
      await saveProject({ schemaVersion: 1, id, name: trimmedName, updatedAt: Date.now(), intent, history, currentId, masks, showGrid, cadWorkspace });
      setProjectId(id);
      setProjectName(trimmedName);
      savedSnapshotRef.current = projectSnapshot;
      setProjectDialog(null);
      setRun({ kind: 'idle' });
      if (closeAfterSaveRef.current) {
        closeAfterSaveRef.current = false;
        await window.__AICAD_HOST_CLOSE_NOW__?.();
      }
    } catch (e) {
      setRun({ kind: 'error', message: t.project.saveFailed(e instanceof Error ? e.message : String(e)) });
    }
  }, [cadWorkspace, currentId, history, intent, masks, projectId, projectSnapshot, showGrid, t]);

  const persistProject = useCallback(async () => {
    if (busy) return;
    const name = projectName.trim();
    if (!name) {
      setProjectDialog({ kind: 'save', value: intent.subject.trim() || t.app.untitled });
      return;
    }
    await saveProjectWithName(name);
  }, [busy, intent.subject, projectName, saveProjectWithName, t.app.untitled]);

  useEffect(() => {
    const requestClose = () => {
      if (hasUnsavedChanges) setProjectDialog({ kind: 'close' });
      else void window.__AICAD_HOST_CLOSE_NOW__?.();
    };
    window.__AICAD_REQUEST_CLOSE__ = requestClose;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      delete window.__AICAD_REQUEST_CLOSE__;
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [hasUnsavedChanges]);

  const showProjects = useCallback(async () => {
    try {
      setProjects(await listProjects());
      setProjectsOpen(true);
    } catch (e) {
      setRun({ kind: 'error', message: t.project.loadFailed(e instanceof Error ? e.message : String(e)) });
    }
  }, [t]);

  const loadingProjectRef = useRef(false);
  const loadSelectedProject = useCallback(async (id: string) => {
    if (loadingProjectRef.current || busy) return;
    loadingProjectRef.current = true;
    try {
      const project = await loadProject(id);
      draftCacheRef.current.forget();
      setGenerationFailure(null);
      setFailureOpen(false);
      setProjectId(project.id);
      setProjectName(project.name);
      setIntent(project.intent);
      setHistory(project.history);
      setCurrentId(project.currentId);
      setMasks(project.masks);
      setShowGrid(project.showGrid);
      setCadWorkspace(project.cadWorkspace ?? createDefaultCadWorkspace());
      savedSnapshotRef.current = JSON.stringify({ intent: project.intent, history: project.history, currentId: project.currentId, masks: project.masks, showGrid: project.showGrid, cadWorkspace: project.cadWorkspace ?? createDefaultCadWorkspace() });
      setMaskMode(false);
      setZoomBoxMode(false);
      // 「不儲存」與直接開啟都必須在同一次操作中關閉確認框；不可留下遮罩要求再按取消。
      setProjectDialog(null);
      setProjectsOpen(false);
      setRun({ kind: 'idle' });
    } catch (e) {
      setRun({ kind: 'error', message: t.project.loadFailed(e instanceof Error ? e.message : String(e)) });
    } finally {
      loadingProjectRef.current = false;
    }
  }, [busy, t]);

  const openProject = useCallback(async (id: string) => {
    if (busy) return;
    if (hasUnsavedChanges) {
      setProjectDialog({ kind: 'open', id });
      return;
    }
    await loadSelectedProject(id);
  }, [busy, hasUnsavedChanges, loadSelectedProject]);

  const removeProject = useCallback(async (id: string) => {
    setProjectDialog({ kind: 'delete', id });
  }, []);

  const confirmRemoveProject = useCallback(async (id: string) => {
    try {
      await deleteProject(id);
      setProjects((items) => items.filter((item) => item.id !== id));
      if (id === projectId) {
        const nextIntent = createDefaultIntent();
        setProjectId(null);
        setProjectName('');
        setIntent(nextIntent);
        setHistory([]);
        setCurrentId(null);
        setMasks([]);
        setMaskMode(false);
        setZoomBoxMode(false);
        setShowGrid(true);
        const nextCadWorkspace = createDefaultCadWorkspace();
        setCadWorkspace(nextCadWorkspace);
        savedSnapshotRef.current = JSON.stringify({ intent: nextIntent, history: [], currentId: null, masks: [], showGrid: true, cadWorkspace: nextCadWorkspace });
        setRun({ kind: 'idle' });
      }
      setProjectDialog(null);
    } catch (e) {
      setRun({ kind: 'error', message: t.project.deleteFailed(e instanceof Error ? e.message : String(e)) });
    }
  }, [projectId, t]);

  // 進行中時每秒推進一次，讓狀態列顯示「已等待 N 秒 / 上限 M 秒」。
  // 這是第一道使用者可見的證據：請求還活著、而且逾時上限確實是我設定的值。
  const [elapsedSec, setElapsedSec] = useState(0);
  useEffect(() => {
    if (run.kind !== 'busy') {
      setElapsedSec(0);
      return;
    }
    const startedAt = run.startedAt;
    const tick = () => setElapsedSec(Math.floor((Date.now() - startedAt) / 1000));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [run.kind, run.kind === 'busy' ? run.startedAt : 0]);

  const enabledImage = useMemo(
    () => settings.providers.filter((provider) => provider.enabled && provider.capabilities.imageGenerate),
    [settings.providers],
  );
  const enabledText = useMemo(
    () => settings.providers.filter((provider) => provider.enabled && provider.capabilities.text),
    [settings.providers],
  );

  // 文字模型與生圖模型可能指向不同供應商；下方狀態列要分別顯示兩邊的就緒來源。
  const activeTextName = settings.activeTextProvider === 'none'
    ? undefined
    : settings.providers.find((provider) => provider.id === settings.activeTextProvider)?.name ?? enabledText[0]?.name;
  const activeImageName = settings.providers.find((provider) => provider.id === settings.activeImageProvider)?.name
    ?? enabledImage[0]?.name;

  const readyLabel = useMemo(() => {
    // 兩邊都設定且不同供應商 → 分開標示，避免使用者誤判實際生效的引擎。
    if (activeTextName && activeImageName && activeTextName !== activeImageName) {
      return `${t.status.readyText(activeTextName)} \u00b7 ${t.status.readyImage(activeImageName)}`;
    }
    if (activeImageName) {
      return activeImageName === activeTextName
        ? t.status.ready(activeImageName)
        : t.status.readyImage(activeImageName);
    }
    if (activeTextName) return t.status.readyText(activeTextName);
    return t.status.noEngine;
  }, [activeTextName, activeImageName, t.status]);

  const execute = useCallback(
    async (task: 'generate' | 'inpaint', reuseText = false) => {
      // Prevent double-clicks from starting overlapping paid requests.
      if (abortRef.current) return;
      const key = generationKey(intent, settings.canvas);
      const reused = task === 'generate' && reuseText ? draftCacheRef.current.peek(key) : undefined;
      if (reuseText && !reused) return;
      setFailureOpen(false);
      if (task === 'generate') {
        setGenerationFailure(null);
        if (!reused) draftCacheRef.current.forget();
      }
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      // 這一輪的時間預算取自「當前出圖引擎」的逾時設定 —— 狀態列要能誠實
      // 顯示上限，使用者才知道自己調的秒數確實生效了。
      const limitSec = resolveRunTimeoutSec(settings, task);
      const startedAt = Date.now();
      const deadline = window.setTimeout(() => ctrl.abort(new TimeoutError(limitSec * 1000)), limitSec * 1000);
      setRun({
        kind: 'busy',
        progress: { stage: 'drawing', note: t.status.preparing },
        startedAt,
        limitSec,
      });

      const deps = {
        settings,
        signal: ctrl.signal,
        onPrepared: (prepared: PreparedGeneration) => {
          if (task === 'generate' && abortRef.current === ctrl && !ctrl.signal.aborted) {
            draftCacheRef.current.remember(prepared);
          }
        },
        onProgress: (progress: RunProgress) =>
          setRun({ kind: 'busy', progress, startedAt, limitSec }),
      };

      try {
        const board =
          task === 'generate'
            ? await generate(intent, deps, { reuse: reused })
            : await inpaint(current as Artboard, masks, deps);

        ctrl.signal.throwIfAborted();
        if (task === 'generate') {
          draftCacheRef.current.forget();
          setGenerationFailure(null);
        }
        setHistory((h) => [board, ...h].slice(0, 40));
        setCurrentId(board.id);
        setMasks([]);
        setMaskMode(false);
        setRun({ kind: 'idle' });
      } catch (e) {
        if (ctrl.signal.aborted && !isTimeout(ctrl.signal.reason)) {
          // 使用者主動取消：回到閒置，不當成錯誤。
          setRun({ kind: 'idle' });
          return;
        }
        // 逾時要說得非常清楚，並直接告訴使用者去哪裡調整 —— 這是先前「等很久
        // 卻什麼都沒發生」最需要的資訊。
        if (task === 'generate') {
          const message = isTimeout(e) || isTimeout(ctrl.signal.reason)
            ? t.status.timedOut(limitSec)
            : userFacingReason(e instanceof Error ? e.message : String(e), t.status.failed);
          setGenerationFailure({ key, message });
          setFailureOpen(true);
        }
        if (isTimeout(e) || isTimeout(ctrl.signal.reason)) {
          setRun({ kind: 'error', message: t.status.timedOut(limitSec) });
          return;
        }
        // 失敗訊息只留「發生什麼、下一步」，不帶來源（網址／主機／端點）。
        if (e instanceof ProviderError) {
          setRun({ kind: 'error', message: userFacingReason(e.message, t.status.failed), hint: e.hint });
        } else {
          setRun({ kind: 'error', message: userFacingReason(e instanceof Error ? e.message : String(e), t.status.failed) });
        }
      } finally {
        window.clearTimeout(deadline);
        if (abortRef.current === ctrl) abortRef.current = null;
      }
    },
    [current, intent, masks, settings, t],
  );

  const addMask = useCallback((r: Omit<MaskRegion, 'id' | 'instruction'>) => {
    setMasks((m) => [...m, { ...r, id: createSafeId('mask'), instruction: '' }]);
  }, []);

  /* 圖框配置：由標註選項推導；生圖提示詞、畫布預覽與匯出共用同一份幾何。 */
  const sheet = useMemo(() => {
    if (!current) return null;
    const layout = sheetLayout({
      titleBlock: current.intent.annotation.titleBlock,
      measurements: hasMeasurementRows(current.intent),
      scaleBar: current.intent.annotation.scaleBar,
    });
    const viewHeight = sheetViewHeight(current.width, current.height);
    const furniture = sheetFurniture({
      layout,
      text: current.intent.text,
      measurements: current.intent.measurements,
      labels: { date: t.intent.sheetDate, scaleBar: t.intent.scaleBar },
      viewHeight,
    });
    return { viewHeight, furniture };
  }, [current, t]);

  /** 匯出用：底圖、草稿向量、文字標示、圖框合成一張自足的 SVG。 */
  const composeSheet = useCallback(
    (withImage: boolean) => {
      if (!current || !sheet) return '';
      return buildSheetSvg({
        width: current.width,
        height: current.height,
        imageRef: withImage ? current.imageRef : undefined,
        draftSvg: current.draftSvg,
        labels: shouldOverlayLabels(current.intent) ? current.textLabels : undefined,
        furniture: sheet.furniture,
        viewHeight: sheet.viewHeight,
        dark: current.intent.lineStyle === 'blueprint',
      });
    },
    [current, sheet],
  );

  const exportPng = useCallback(async () => {
    if (!current) return;
    /* 草稿文字與圖框只疊在畫面上；匯出時要一起光柵化，否則 PNG 會少了它們。 */
    let href = current.imageRef;
    try {
      href = await rasterizeSheetSvg(composeSheet(true), current.width, current.height);
    } catch {
      href = current.imageRef;
    }
    const a = document.createElement('a');
    a.href = href;
    a.download = `aicad-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.png`;
    a.click();
  }, [composeSheet, current]);

  /* 只有草稿是向量且圖面類型適合進 CAD 時才給 DXF；否則按鈕停用，
     免得使用者拿到一張只有圖框的空檔案。 */
  const cadReady = !!current && cadSuitability(current.intent.kind, current.draftSvg) === 'vector';

  const exportCad = useCallback(() => {
    if (!current || !sheet || !cadReady) return;
    const result = sheetToDxf({
      sheetSvg: composeSheet(false),
      cadEntities: cadWorkspace.entities,
      cadLayers: cadWorkspace.layers,
      paperHeight: Math.round((420 * sheet.viewHeight) / 1000),
      viewHeight: sheet.viewHeight,
    });
    const blob = new Blob([result.dxf], { type: 'application/dxf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aicad-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.dxf`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  }, [cadReady, cadWorkspace, composeSheet, current, sheet]);

  const canGenerate = !busy && intent.subject.trim().length > 0 && enabledImage.length > 0;
  const canInpaint =
    !busy && !!current && masks.length > 0 && masks.every((m) => m.instruction.trim().length > 0);

  // 下拉選項加上群組小標題：引擎清單混著「雲端／本機／不使用」三種性質，
  // 沒有標題時使用者只能靠名稱猜，這是最容易選錯的一個控制項。
  // Select 的分組只認「相鄰」，所以這裡直接按組別接起來，不另外排序。
  const textProviderOptions = useMemo(() => {
    const all = settings.providers.filter((provider) => provider.enabled && provider.capabilities.text);
    const opt = (provider: ProviderConfig) => ({
      value: provider.id as ProviderId | 'none',
      label: t.right.refineWith(provider.name),
      note: provider.enabled ? undefined : t.right.disabledSuffix,
      group: provider.type === 'local' ? t.right.groupLocal : t.right.groupCloud,
    });
    return [
      ...all.filter((provider) => provider.type !== 'local').map(opt),
      ...all.filter((provider) => provider.type === 'local').map(opt),
      {
        value: 'none' as ProviderId | 'none',
        label: t.right.noRefine,
        note: undefined,
        group: t.right.groupOff,
      },
    ];
  }, [settings.providers, t]);

  const imageProviderOptions = useMemo(() => {
    const all = settings.providers.filter((provider) => provider.enabled && provider.capabilities.imageGenerate);
    const opt = (provider: ProviderConfig) => ({
      value: provider.id,
      label: provider.name,
      note: provider.enabled ? undefined : t.right.disabledSuffix,
      group: provider.type === 'local' ? t.right.groupLocal : t.right.groupCloud,
    });
    return [...all.filter((provider) => provider.type !== 'local').map(opt), ...all.filter((provider) => provider.type === 'local').map(opt)];
  }, [settings.providers, t]);

  return (
    <div className="shell">
      <header className="titlebar">
        <div className="titlebar__brand">
          <IconDimension size={15} className="titlebar__mark" />
          <span className="titlebar__name">Ai Cad</span>
        </div>
        <span className="titlebar__doc">
          {current
            ? t.app.docTitle(
                history.length - history.indexOf(current),
                current.width,
                current.height,
              )
            : projectName || t.app.untitled}
        </span>
        <div className="titlebar__spacer" />
        <div className="titlebar__actions">
          <button type="button" className="iconbtn" aria-label={t.project.newProject} title={t.project.newProject} disabled={busy} onClick={newProject}>
            <IconNew size={16} />
          </button>
          <button type="button" className="iconbtn" aria-label={t.project.openProject} title={t.project.openProject} disabled={busy} onClick={() => void showProjects()}>
            <IconFolder size={16} />
          </button>
          <button type="button" className="iconbtn" aria-label={t.project.saveProject} title={t.project.saveProject} disabled={busy} onClick={() => void persistProject()}>
            <IconSave size={16} />
          </button>
          <button
            type="button"
            className="iconbtn"
            aria-label={t.app.exportPng}
            title={t.app.exportPng}
            disabled={!current}
            onClick={exportPng}
            style={!current ? { opacity: 0.35 } : undefined}
          >
            <IconExport size={16} />
          </button>
          {/* 只有草稿是向量、且圖面類型適合進 CAD 時才出現，免得匯出一張空檔案。 */}
          {cadReady && (
            <button type="button" className="iconbtn" aria-label={t.app.exportCad} title={t.app.exportCad} onClick={exportCad}>
              <IconCad size={16} />
            </button>
          )}
          <button
            type="button"
            className="iconbtn"
            aria-label={t.app.preferences}
            title={t.app.preferences}
            aria-pressed={settingsOpen}
            onClick={() => {
              onSettingsCategory('general');
              setSettingsOpen(true);
            }}
          >
            <IconSettings size={16} />
          </button>
        </div>
      </header>

      <div className="body">
        {/* ---- 左欄：意圖建構 ---- */}
        <aside className="panel panel--left">
          <div className="panel__head">
            <span className="panel__head-title">{t.left.title}</span>
          </div>
          <div className="panel__scroll">
            <IntentPanel intent={intent} onChange={setIntent} />
          </div>
          <div className="panel__foot">
            <Button variant="primary" block disabled={!canGenerate} onClick={() => {
              if (generationFailure?.key === retryKey) setFailureOpen(true);
              else void execute('generate');
            }}>
              <IconGenerate size={16} />
              {busy ? t.left.generating : t.left.generate}
            </Button>
            {enabledImage.length === 0 && <p className="field__hint">{t.left.noEngine}</p>}
            {busy && (
              <Button variant="ghost" block onClick={() => abortRef.current?.abort()}>
                {t.common.cancel}
              </Button>
            )}
          </div>
        </aside>

        {/* ---- 中央：畫布 ---- */}
        <main className="stage">
          <CadToolbar value={cadWorkspace} onChange={setCadWorkspace} />
          <div className="stage__toolbar">
            <button
              type="button"
              className="iconbtn"
              aria-label={t.stage.maskMode}
              title={t.stage.maskModeHint}
              aria-pressed={maskMode}
              disabled={!current}
              onClick={() => setMaskMode((v) => !v)}
              style={!current ? { opacity: 0.35 } : undefined}
            >
              <IconMask size={16} />
            </button>
            <button
              type="button"
              className="iconbtn"
              aria-label="框選範圍縮放"
              title="框選範圍縮放"
              aria-pressed={zoomBoxMode}
              disabled={!current}
              onClick={() => {
                setMaskMode(false);
                setZoomBoxMode((value) => !value);
              }}
              style={!current ? { opacity: 0.35 } : undefined}
            >
              <IconDimension size={16} />
            </button>
            <button
              type="button"
              className="iconbtn"
              aria-label={t.stage.grid}
              title={t.stage.grid}
              aria-pressed={showGrid}
              onClick={() => setShowGrid((v) => !v)}
            >
              <IconZoomFit size={16} />
            </button>
            <div className="stage__spacer" />
            <span className="stage__meta num">
              {settings.canvas.width} × {settings.canvas.height}
            </span>
          </div>

          <div className="stage__viewport">
            {busy && (
              <div className="progress">
                <div className="progress__bar" />
              </div>
            )}
            <DrawingCanvas
              artboard={current}
              ratio={ratio}
              masks={masks}
              furniture={sheet?.furniture ?? []}
              furnitureHeight={sheet?.viewHeight ?? 700}
              showGrid={showGrid}
              maskMode={maskMode}
              zoomBoxMode={zoomBoxMode}
              cadWorkspace={cadWorkspace}
              onCadWorkspaceChange={setCadWorkspace}
              onZoomBoxModeChange={setZoomBoxMode}
              onAddMask={addMask}
            />
          </div>
        </main>

        {/* ---- 右欄：檢視器 ---- */}
        <aside className="panel panel--right">
          <div className="panel__head">
            <span className="panel__head-title">
              {maskMode || masks.length > 0 ? t.right.titleInpaint : t.right.titleEngine}
            </span>
          </div>
          <div className="panel__scroll">
            <Section variant="block" title={t.right.refineEngine}>
              <Select<ProviderId | 'none'>
                ariaLabel={t.right.refineEngine}
                value={settings.activeTextProvider}
                onChange={(activeTextProvider) => onSettings({ ...settings, activeTextProvider })}
                options={textProviderOptions}
              />
              <p className="field__hint">
                {enabledText.length > 0 ? t.right.refineOn : t.right.refineOff}
              </p>
            </Section>
            <Section variant="block" title={t.right.imageEngine}>
              <Select<ProviderId>
                ariaLabel={t.right.imageEngine}
                value={settings.activeImageProvider}
                onChange={(activeImageProvider) => onSettings({ ...settings, activeImageProvider })}
                options={imageProviderOptions}
              />
            </Section>

            <Section variant="block" title={t.right.masks} aside={<span className="field__hint num">{masks.length}</span>}>
              {masks.length === 0 ? (
                <p className="empty-note">
                  {current ? t.right.maskEmptyReady : t.right.maskEmptyNoImage}
                </p>
              ) : (
                <div className="masklist">
                  {masks.map((m, i) => (
                    <div className="maskcard" key={m.id}>
                      <div className="maskcard__head">
                        <span className="maskcard__id">{t.right.maskLabel(i + 1)}</span>
                        <span className="maskcard__geo num">
                          {Math.round(m.w * 100)}% × {Math.round(m.h * 100)}%
                        </span>
                        <div className="stage__spacer" />
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() => setMasks((v) => v.filter((x) => x.id !== m.id))}
                        >
                          {t.common.remove}
                        </button>
                      </div>
                      <textarea
                        className="textarea"
                        style={{ minHeight: 56 }}
                        value={m.instruction}
                        placeholder={t.right.maskPlaceholder}
                        onChange={(e) =>
                          setMasks((v) =>
                            v.map((x) => (x.id === m.id ? { ...x, instruction: e.target.value } : x)),
                          )
                        }
                      />
                    </div>
                  ))}
                  <Button variant="primary" block disabled={!canInpaint} onClick={() => void execute('inpaint')}>
                    <IconMask size={16} />
                    {t.right.redraw}
                  </Button>
                </div>
              )}
            </Section>

            <Section
              variant="block"
              title={t.right.history}
              aside={
                history.length > 0 ? (
                  <span className="field__hint num">{history.length}</span>
                ) : (
                  <IconHistory size={13} />
                )
              }
            >
              {history.length === 0 ? (
                <p className="empty-note">{t.right.historyEmpty}</p>
              ) : (
                <div className="history">
                  {history.map((a) => (
                    <div className="history__cell" key={a.id}>
                      <button
                        type="button"
                        className="history__item"
                        aria-current={a.id === currentId}
                        title={new Date(a.createdAt).toLocaleTimeString()}
                        onClick={() => {
                          setCurrentId(a.id);
                          setMasks([]);
                        }}
                      >
                        <img src={a.imageRef} alt="" />
                      </button>
                      <button
                        type="button"
                        className="history__del"
                        aria-label={t.right.historyDelete}
                        title={t.right.historyDelete}
                        onClick={() => removeHistory(a.id)}
                      >
                        <IconClose size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {current && (
              <>
                <Section variant="block" title={t.right.params}>
                  <Field label={t.right.engine}>
                    <input
                      className="input"
                      readOnly
                      value={settings.providers.find((provider) => provider.id === current.providerId)?.name ?? current.providerId}
                    />
                  </Field>
                  <Field label={t.right.model}>
                    <input className="input" readOnly value={current.model} />
                  </Field>
                  <Field label={t.right.resolvedPrompt} hint={t.right.resolvedPromptHint}>
                    <textarea
                      className="textarea selectable"
                      readOnly
                      style={{ minHeight: 110, fontSize: 'var(--fs-caption)' }}
                      value={current.resolvedPrompt}
                    />
                  </Field>
                </Section>
              </>
            )}
          </div>
        </aside>
      </div>

      <footer className="statusbar">
        <span className="statusbar__group">
          <Dot state={busy ? 'busy' : run.kind === 'error' ? 'danger' : enabledImage.length || enabledText.length ? 'ok' : 'warn'} />
          {busy
            ? `${run.progress.note} · ${t.status.elapsed(elapsedSec, run.limitSec)}`
            : run.kind === 'error'
              ? `${run.message}${run.hint ? ` — ${run.hint}` : ''}`
              : readyLabel}
        </span>
        <div className="statusbar__spacer" />
        <span className="statusbar__group num">
          {maskMode ? t.status.maskMode : t.status.viewMode} · {t.status.history(history.length)}
        </span>
      </footer>

      {failureOpen && generationFailure && !busy && (
        <RunFailureDialog
          message={generationFailure.message}
          canReuse={generationFailure.key === retryKey && !!draftCacheRef.current.peek(retryKey)}
          canGenerate={canGenerate}
          onClose={() => setFailureOpen(false)}
          onReuse={() => void execute('generate', true)}
          onRestart={() => void execute('generate')}
        />
      )}
      {settingsOpen && (
        <SettingsSheet
          settings={settings}
          onChange={onSettings}
          initialCategory={settingsCategory ?? 'general'}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {projectsOpen && (
        <ProjectSheet projects={projects} busy={busy} onOpen={(id) => void openProject(id)} onDelete={(id) => void removeProject(id)} onClose={() => setProjectsOpen(false)} />
      )}
      {projectDialog && (
        <div className="utility-dialog-backdrop" role="presentation" onMouseDown={() => setProjectDialog(null)}>
          <section className="utility-dialog" role="dialog" aria-modal="true" aria-labelledby="project-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="utility-dialog__content">
              <h2 id="project-dialog-title" className="utility-dialog__title">
                {projectDialog.kind === 'save' ? t.project.namePrompt : projectDialog.kind === 'new' ? t.project.newProject : projectDialog.kind === 'close' || projectDialog.kind === 'open' ? t.project.closeTitle : t.project.deleteConfirm}
              </h2>
              {projectDialog.kind === 'new' && <p className="utility-dialog__message">{t.project.newConfirm}</p>}
              {projectDialog.kind === 'delete' && <p className="utility-dialog__message">{t.project.deleteConfirm}</p>}
              {projectDialog.kind === 'close' && <p className="utility-dialog__message">{t.project.closeConfirm}</p>}
              {projectDialog.kind === 'open' && <p className="utility-dialog__message">{t.project.closeConfirm}</p>}
              {projectDialog.kind === 'save' && (
                <input
                  className="input utility-dialog__input"
                  autoFocus
                  value={projectDialog.value}
                  aria-label={t.project.namePrompt}
                  onChange={(event) => setProjectDialog({ kind: 'save', value: event.target.value })}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') setProjectDialog(null);
                    if (event.key === 'Enter' && projectDialog.value.trim()) void saveProjectWithName(projectDialog.value);
                  }}
                />
              )}
            </div>
            <div className="utility-dialog__actions">
              <Button variant="secondary" onClick={() => setProjectDialog(null)}>{t.common.cancel}</Button>
              {projectDialog.kind === 'close' && (
                <Button variant="secondary" onClick={() => void window.__AICAD_HOST_CLOSE_NOW__?.()}>{t.project.discardChanges}</Button>
              )}
              {projectDialog.kind === 'open' && (
                <Button variant="secondary" onClick={() => void loadSelectedProject(projectDialog.id)}>{t.project.discardChanges}</Button>
              )}
              <Button
                variant="primary"
                disabled={projectDialog.kind === 'save' && !projectDialog.value.trim()}
                onClick={() => {
                  if (projectDialog.kind === 'new') confirmNewProject();
                  else if (projectDialog.kind === 'delete') void confirmRemoveProject(projectDialog.id);
                  else if (projectDialog.kind === 'close') {
                    closeAfterSaveRef.current = true;
                    if (!projectName.trim()) setProjectDialog({ kind: 'save', value: intent.subject.trim() || t.app.untitled });
                    else void saveProjectWithName(projectName);
                  } else if (projectDialog.kind === 'open') void loadSelectedProject(projectDialog.id);
                  else void saveProjectWithName(projectDialog.value);
                }}
              >
                {projectDialog.kind === 'save' || projectDialog.kind === 'close' ? t.common.save : projectDialog.kind === 'open' ? t.project.openProject : projectDialog.kind === 'new' ? t.project.newProject : t.common.remove}
              </Button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
