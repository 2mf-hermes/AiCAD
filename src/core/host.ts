/* ============================================================================
   宿主橋接 (Host Bridge)
   ----------------------------------------------------------------------------
   Go 宿主在頁面腳本執行前注入 window.__AICAD_HOST__。這個模組是前端唯一
   讀取它的地方，並在偵測到宿主時把三件事切換到原生實作：

     1. transport   → 經由 Go 代發 HTTP，繞過 CORS
     2. 設定儲存    → 寫入 %APPDATA%\AiCad\settings.json
     3. 憑證保管    → 寫入 %APPDATA%\AiCad\secrets.bin（DPAPI 加密）
     4. 自動更新    → 下載、SHA-256 驗證、替換執行檔並重啟

   為什麼設定不能留在 localStorage：宿主每次啟動都綁一個隨機埠，而
   localStorage 是以 origin（含埠號）隔離的。埠一變就是全新的空儲存，
   使用者看到的現象就是「設定每次開啟都被重置」。這不是前端邏輯的錯，
   是儲存位置選錯了 —— 唯一穩定的位置在宿主的檔案系統。

   在瀏覽器裡開發時 __AICAD_HOST__ 不存在，四者都保持 Web 後備實作
   （更新則一律回報 unavailable，不假裝做得到），讓同一份程式碼在兩種環境都能跑。
   ========================================================================== */

import {
  setTransport,
  TimeoutError,
  type HttpRequest,
  type HttpResponse,
  type Transport,
} from './net/transport';
import { setSecretsBackend, type SecretsBackend } from './secrets';
import { setSettingsBackend, type SettingsBackend } from './settingsStore';
import { setProjectBackend, normalizeProject, type ProjectBackend, type ProjectDocument, type ProjectMeta } from './projects';
import {
  setUpdateBackend,
  type UpdateBackend,
  type UpdateInfo,
  type UpdateProgress,
} from './update';

export interface HostInfo {
  readonly platform: 'windows';
  readonly version: string;
  /** 例：http://127.0.0.1:52341 —— 舊版宿主沒有這個欄位，需從 bridgeUrl 推導 */
  readonly origin?: string;
  readonly bridgeUrl: string;
  readonly token: string;
}

declare global {
  interface Window {
    __AICAD_HOST__?: HostInfo;
    __AICAD_REQUEST_CLOSE__?: () => void;
	__AICAD_HOST_CLOSE_NOW__?: () => Promise<void>;
  }
}

export function getHost(): HostInfo | null {
  const h = typeof window !== 'undefined' ? window.__AICAD_HOST__ : undefined;
  if (!h || typeof h.bridgeUrl !== 'string' || typeof h.token !== 'string') return null;
  return h;
}

export function isDesktop(): boolean {
  return getHost() !== null;
}

export function hostVersion(): string {
  return getHost()?.version ?? '0.0.0-dev';
}

/** 宿主的 origin。舊注入格式只有 bridgeUrl 時，砍掉尾段路徑推回來。 */
function hostOrigin(host: HostInfo): string {
  if (typeof host.origin === 'string' && host.origin) return host.origin;
  return host.bridgeUrl.replace(/\/bridge\/http$/, '');
}

interface BridgeReply {
  status: number;
  ok: boolean;
  text: string;
  error?: string;
}

interface StoreReply {
  ok: boolean;
  data?: string;
  error?: string;
}

/** 所有 /bridge/* 端點的共同呼叫形式：POST + token + JSON。 */
async function callStore(host: HostInfo, path: string, payload: unknown): Promise<StoreReply> {
  const res = await fetch(`${hostOrigin(host)}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-aicad-token': host.token,
    },
    body: JSON.stringify(payload ?? {}),
  });
  if (!res.ok) throw new Error(`宿主橋接異常 (${res.status}) — 請重新啟動 Ai Cad`);
  return (await res.json()) as StoreReply;
}

/* ---------------------------------------------------------------------------
   原生 transport
   --------------------------------------------------------------------------- */

function createNativeTransport(host: HostInfo): Transport {
  return async (req: HttpRequest): Promise<HttpResponse> => {
    /* ---- 為什麼這裡也要自己計時 ------------------------------------------
       原本這段只把 req.signal 交給 fetch，時間管理全靠 Go 端。問題是：
       只要 Go 那頭因為任何原因沒有寫出回應（handler 異常、連線被中間層
       悶掉、回應大到緩衝異常），這個 await 就永遠不會 settle —— 前端沒有
       逾時、沒有錯誤、也沒有結果，畫面就一直停在「正在繪製圖面」。使用者
       調高逾時秒數當然沒用，因為那時根本沒有任何一方在計時。

       解法：前端自己壓一道看門狗，時限為「前端逾時 + 寬限」。寬限的意義是
       讓 Go 端先用它自己的逾時回報可讀錯誤（含 provider 訊息），前端看門狗
       只負責在宿主完全失聯時把 Promise 收掉。
       -------------------------------------------------------------------- */
    const budget = req.timeoutMs > 0 ? req.timeoutMs : 120_000;
    const watchdogMs = budget + BRIDGE_GRACE_MS;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new TimeoutError(watchdogMs)), watchdogMs);
    const onAbort = () => ctrl.abort(req.signal?.reason);
    if (req.signal?.aborted) onAbort();
    else req.signal?.addEventListener('abort', onAbort, { once: true });

    try {
      const res = await fetch(host.bridgeUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-aicad-token': host.token,
        },
        body: JSON.stringify({
          url: req.url,
          method: req.method,
          headers: {
            ...(req.json !== undefined ? { 'content-type': 'application/json' } : {}),
            ...req.headers,
          },
          body: req.json !== undefined ? JSON.stringify(req.json) : '',
          multipart: req.multipart,
          timeoutMs: budget,
          responseAs: req.responseAs ?? 'text',
        }),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        throw new Error(`宿主橋接異常 (${res.status}) — 請重新啟動 Ai Cad`);
      }

      const reply = (await res.json()) as BridgeReply;
      // error 是「請求根本沒送出去」，與「送出去但回 4xx」語意不同，必須拋出。
      if (reply.error) throw new Error(reply.error);
      return { status: reply.status, ok: reply.ok, text: reply.text };
    } catch (e) {
      // fetch 被 abort 時瀏覽器丟 AbortError，reason 才是我們塞進去的原因。
      const reason: unknown = ctrl.signal.reason;
      if (reason instanceof TimeoutError) throw reason;
      throw e;
    } finally {
      clearTimeout(timer);
      req.signal?.removeEventListener('abort', onAbort);
    }
  };
}

/**
 * 宿主寬限期。Go 端有自己的逾時並會回報可讀原因，前端只在宿主完全沒有
 * 回應時介入，所以寬限給得寬鬆（15 秒）比搶著報錯有用。
 */
const BRIDGE_GRACE_MS = 15_000;

/* ---------------------------------------------------------------------------
   原生設定儲存
   --------------------------------------------------------------------------- */

function createNativeSettingsBackend(host: HostInfo): SettingsBackend {
  return {
    kind: 'native-file',
    async load() {
      const r = await callStore(host, '/bridge/settings/get', {});
      if (r.error) throw new Error(r.error);
      return r.data ?? '';
    },
    async save(json: string) {
      const r = await callStore(host, '/bridge/settings/set', { data: json });
      if (r.error) throw new Error(r.error);
    },
  };
}

/* ---------------------------------------------------------------------------
   原生憑證保管
   --------------------------------------------------------------------------- */

function createNativeProjectBackend(host: HostInfo): ProjectBackend {
  return {
    kind: 'native-file',
    async list() {
      const r = await callStore(host, '/bridge/project/list', {});
      if (r.error) throw new Error(r.error);
      const parsed: unknown = JSON.parse(r.data ?? '[]');
      return Array.isArray(parsed) ? parsed.filter((item): item is ProjectMeta => Boolean(item && typeof item === 'object' && typeof (item as ProjectMeta).id === 'string')) : [];
    },
    async load(id: string) {
      const r = await callStore(host, '/bridge/project/get', { id });
      if (r.error) throw new Error(r.error);
      return normalizeProject(JSON.parse(r.data ?? '{}'));
    },
    async save(project: ProjectDocument) {
      const preview = project.history.find((a) => a.id === project.currentId)?.imageRef ?? '';
      const r = await callStore(host, '/bridge/project/save', {
        id: project.id,
        name: project.name,
        updatedAt: project.updatedAt,
        preview,
        boards: project.history.length,
        data: JSON.stringify(project),
      });
      if (r.error) throw new Error(r.error);
      return JSON.parse(r.data ?? '{}') as ProjectMeta;
    },
    async remove(id: string) {
      const r = await callStore(host, '/bridge/project/delete', { id });
      if (r.error) throw new Error(r.error);
    },
  };
}

function createNativeSecretsBackend(host: HostInfo): SecretsBackend {
  return {
    kind: 'os-keychain',
    async get(ref: string) {
      const r = await callStore(host, '/bridge/secret/get', { ref });
      if (r.error) throw new Error(r.error);
      return r.data ?? '';
    },
    async set(ref: string, value: string) {
      const r = await callStore(host, '/bridge/secret/set', { ref, value });
      if (r.error) throw new Error(r.error);
    },
    async remove(ref: string) {
      const r = await callStore(host, '/bridge/secret/set', { ref, value: '' });
      if (r.error) throw new Error(r.error);
    },
  };
}

/* ---------------------------------------------------------------------------
   原生更新
   ----------------------------------------------------------------------------
   四個端點對應 UpdateBackend 的四個方法。回應沿用 storeReply 形狀，data 欄位
   內是 JSON 字串 —— 所以這裡要做一次 JSON.parse。這個小小的雙層封裝換來的是
   宿主端只有一套呼叫慣例，不必為更新再開一種協定。
   --------------------------------------------------------------------------- */

function createNativeUpdateBackend(host: HostInfo): UpdateBackend {
  return {
    kind: 'native',
    async check(channel: string) {
      const r = await callStore(host, '/bridge/update/check', { channel });
      if (r.error) throw new Error(r.error);
      // data 為空字串即「已是最新版」—— 宿主刻意用「沒有資料」而非特殊旗標表達。
      if (!r.data) return null;
      return JSON.parse(r.data) as UpdateInfo;
    },
    async start(info: UpdateInfo) {
      const r = await callStore(host, '/bridge/update/start', info);
      if (r.error) throw new Error(r.error);
    },
    async progress() {
      const r = await callStore(host, '/bridge/update/progress', {});
      if (r.error) return { percent: 0, done: false, error: r.error };
      if (!r.data) return { percent: 0, done: false, error: '' };
      return JSON.parse(r.data) as UpdateProgress;
    },
    async install() {
      const r = await callStore(host, '/bridge/update/install', {});
      if (r.error) throw new Error(r.error);
      // 成功時宿主已在替換執行檔並準備重啟，本頁面即將隨視窗一起消失。
    },
  };
}

/** 在 App 掛載前呼叫一次。回傳是否成功接上原生出口。 */
export function installHostBridge(): boolean {
  const host = getHost();
  if (!host) return false;
  setTransport(createNativeTransport(host));
  setSettingsBackend(createNativeSettingsBackend(host));
  setProjectBackend(createNativeProjectBackend(host));
  setSecretsBackend(createNativeSecretsBackend(host));
  setUpdateBackend(createNativeUpdateBackend(host));
  return true;
}
