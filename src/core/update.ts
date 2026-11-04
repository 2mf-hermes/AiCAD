/* ============================================================================
   應用程式更新 (Auto Update)
   ----------------------------------------------------------------------------
   使用者要的不是「跳出一個下載連結」，而是「按一下就更新完」。所以這一層把
   更新拆成四個可觀測的階段：檢查 → 下載 → 驗證 → 安裝並重啟。每一階段都有
   明確狀態，UI 才能誠實地顯示現在在做什麼、卡在哪裡。

   為什麼要 backend 抽象（與 settingsStore.ts 同一套思路）：
   - 真正能「替換自己並重啟」的只有原生宿主。瀏覽器沙箱做不到，也不該假裝
     做得到 —— 開發模式一律回報 unavailable，UI 直接說明原因。
   - 驗證（SHA-256）與檔案落地都在 Go 側完成。前端不碰位元組，避免把幾十 MB
     的 EXE 塞進 JS 記憶體，也避免前端成為「決定要不要驗簽」的一方。

   下載進度採「啟動 + 輪詢」而非 SSE / WebSocket：宿主橋接刻意只提供
   POST + JSON 的單一形狀（見 host.ts），為一個進度條增開長連線通道並不值得。
   ========================================================================== */

export interface UpdateInfo {
  /** 語意化版號，例如 0.2.0 */
  version: string;
  /** 版本說明（純文字，逐行顯示） */
  notes: string;
  /** EXE 下載位址 */
  url: string;
  /** 小寫十六進位 SHA-256；宿主用它驗證下載結果 */
  sha256: string;
  /** 位元組數；0 表示未知 */
  size: number;
  /**
   * 這次資訊實際是從哪裡取得的（網址，或本機清單的完整路徑）。
   * 由宿主端填入。UI 顯示它是為了讓「取得位置失敗」變成可診斷的訊息：
   * 使用者一眼就看得出程式去哪裡找過更新，而不是只看到一句網路錯誤。
   */
  source?: string;
}

export type UpdateStage =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'up-to-date' }
  | { kind: 'available'; info: UpdateInfo }
  | { kind: 'downloading'; percent: number; info: UpdateInfo }
  | { kind: 'verifying'; info: UpdateInfo }
  | { kind: 'ready'; info: UpdateInfo }
  | { kind: 'installing' }
  | { kind: 'error'; message: string };

export interface UpdateProgress {
  /** 0–100；未知總長度時停在 0 */
  percent: number;
  /** true 表示下載與驗證都已完成 */
  done: boolean;
  /** 非空表示這次下載失敗 */
  error: string;
}

export interface UpdateBackend {
  readonly kind: 'native' | 'unavailable';
  /** 回傳 null 表示已是最新版 */
  check(channel: string): Promise<UpdateInfo | null>;
  /** 啟動下載（立即回傳，進度由 progress() 輪詢） */
  start(info: UpdateInfo): Promise<void>;
  progress(): Promise<UpdateProgress>;
  /** 替換執行檔並重新啟動；成功時本行程即將結束 */
  install(): Promise<void>;
}

const unavailableBackend: UpdateBackend = {
  kind: 'unavailable',
  async check() {
    throw new Error('UPDATE_UNAVAILABLE');
  },
  async start() {
    throw new Error('UPDATE_UNAVAILABLE');
  },
  async progress() {
    return { percent: 0, done: false, error: 'UPDATE_UNAVAILABLE' };
  },
  async install() {
    throw new Error('UPDATE_UNAVAILABLE');
  },
};

let backend: UpdateBackend = unavailableBackend;

export function setUpdateBackend(b: UpdateBackend): void {
  backend = b;
}

export function updateBackend(): UpdateBackend {
  return backend;
}

/** UI 用來判斷「要不要顯示自動更新按鈕」 */
export function canAutoUpdate(): boolean {
  return backend.kind === 'native';
}

/** 錯誤訊息哨兵：讓 UI 能把「環境不支援」和「網路失敗」分開講。 */
export const UPDATE_UNAVAILABLE = 'UPDATE_UNAVAILABLE';

/* ---------------------------------------------------------------------------
   版本比較
   刻意只支援 major.minor.patch(-prerelease)。理由：發佈流程由我們自己控制，
   不需要完整 semver 解析器；但預發佈標記要能被辨識，否則 0.2.0-rc1 會被誤判
   成比 0.2.0 新。
   --------------------------------------------------------------------------- */

export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core = '', pre = ''] = v.replace(/^v/i, '').split('-', 2);
    const nums = core.split('.').map((n) => Number.parseInt(n, 10) || 0);
    return { nums: [nums[0] ?? 0, nums[1] ?? 0, nums[2] ?? 0], pre };
  };
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i += 1) {
    if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] > pb.nums[i] ? 1 : -1;
  }
  // 有預發佈標記者較舊（1.0.0-rc1 < 1.0.0）
  if (pa.pre && !pb.pre) return -1;
  if (!pa.pre && pb.pre) return 1;
  if (pa.pre === pb.pre) return 0;
  return pa.pre > pb.pre ? 1 : -1;
}

export function isNewer(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0;
}

/** 輪詢下載進度直到完成或失敗。間隔 400ms —— 夠即時，又不會把橋接打滿。 */
export async function pollUntilDone(
  onProgress: (p: UpdateProgress) => void,
  shouldStop: () => boolean,
): Promise<UpdateProgress> {
  for (;;) {
    if (shouldStop()) return { percent: 0, done: false, error: 'ABORTED' };
    const p = await backend.progress();
    onProgress(p);
    if (p.done || p.error) return p;
    await new Promise((r) => setTimeout(r, 400));
  }
}
