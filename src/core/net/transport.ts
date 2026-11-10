/* ============================================================================
   HTTP 傳輸層 —— 唯一的對外出口
   ----------------------------------------------------------------------------
   為什麼要抽這一層：瀏覽器 fetch 受 CORS 限制，而 OpenAI / Anthropic 都不發
   CORS 標頭。開發時我們透過 Vite proxy 或本地服務繞過；打包成桌面應用後，
   請求必須改由原生端 (Tauri 的 tauri-plugin-http / Go 的 net/http bridge)
   發出，才能真正無視 CORS 並保護 API Key 不出現在 WebView 記憶體裡。

   因此：所有 adapter 只准呼叫 request()，不准直接呼叫 fetch。
   Phase 2 替換 nativeTransport 即可，adapter 一行都不用改。
   ========================================================================== */

export interface HttpRequest {
  url: string;
  method: 'GET' | 'POST';
  headers?: Record<string, string>;
  /** 已序列化的 JSON body */
  json?: unknown;
  /** 原生宿主會依結構化 parts 組成 multipart/form-data。 */
  multipart?: MultipartPart[];
  timeoutMs: number;
  signal?: AbortSignal;
  /**
   * 'base64' 時回應以 base64 交回（用來抓二進位影像）。
   * 只有原生 transport 能真正無視 CORS 抓圖；Web 後備會盡力而為。
   */
  responseAs?: 'text' | 'base64';
}

export type MultipartPart =
  | { name: string; value: string }
  | { name: string; filename: string; contentType: string; base64: string };

export interface HttpResponse {
  status: number;
  ok: boolean;
  text: string;
}

export type Transport = (req: HttpRequest) => Promise<HttpResponse>;

/** 開發用：直接 fetch。生產環境會被原生 transport 取代。 */
const webTransport: Transport = async (req) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new TimeoutError(req.timeoutMs)), req.timeoutMs);
  const onAbort = () => ctrl.abort(req.signal?.reason);
  req.signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const multipart = req.multipart ? buildFormData(req.multipart) : undefined;
    const res = await fetch(req.url, {
      method: req.method,
      headers: {
        ...(req.json !== undefined ? { 'content-type': 'application/json' } : {}),
        ...req.headers,
      },
      body: multipart ?? (req.json !== undefined ? JSON.stringify(req.json) : undefined),
      signal: ctrl.signal,
    });
    if (req.responseAs === 'base64') {
      const buf = new Uint8Array(await res.arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i += 1) bin += String.fromCharCode(buf[i]);
      return { status: res.status, ok: res.ok, text: btoa(bin) };
    }
    return { status: res.status, ok: res.ok, text: await res.text() };
  } finally {
    clearTimeout(timer);
    req.signal?.removeEventListener('abort', onAbort);
  }
};

function buildFormData(parts: MultipartPart[]): FormData {
  const form = new FormData();
  for (const part of parts) {
    if ('base64' in part) {
      const raw = atob(part.base64.replace(/^data:[^;]+;base64,/, ''));
      const bytes = new Uint8Array(raw.length);
      for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
      form.append(part.name, new Blob([bytes], { type: part.contentType }), part.filename);
    } else {
      form.append(part.name, part.value);
    }
  }
  return form;
}

/**
 * 逾時專用錯誤型別。
 *
 * 為什麼需要一個型別而不是 new Error('timeout')：上層要能分辨「使用者按了
 * 取消」與「等到逾時」，前者不該顯示錯誤、後者必須顯示並提示調高秒數。
 * 之前兩者都是字串比對，訊息一改就失效。
 */
export class TimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`逾時：已等待 ${Math.round(timeoutMs / 1000)} 秒仍未收到回應`);
    this.name = 'TimeoutError';
  }
}

export function isTimeout(e: unknown): boolean {
  return e instanceof TimeoutError || (e instanceof Error && e.name === 'TimeoutError');
}

let active: Transport = webTransport;

/** 由原生殼層在啟動時注入 */
export function setTransport(t: Transport): void {
  active = t;
}

export function request(req: HttpRequest): Promise<HttpResponse> {
  return active(req);
}

/**
 * 抓一張圖回來變 base64。
 *
 * 存在理由：OpenAI 相容端點的 /images/generations 有兩種回應形狀 ——
 * b64_json（官方預設）與 url（大量第三方聚合／中轉站只給這個）。過去前端
 * 遇到 url 就直接放棄並報「端點未回傳 base64」，使用者的體感就是「送出了
 * 但永遠拿不到圖」。這個函式把第二種形狀補完。
 */
export async function fetchImageAsBase64(
  url: string,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<string> {
  const res = await request({ url, method: 'GET', timeoutMs, signal, responseAs: 'base64' });
  if (!res.ok) throw new HttpError(res.status, `下載影像失敗 (${res.status})`, url);
  if (!res.text) throw new HttpError(res.status, '下載影像失敗：內容為空', url);
  return res.text;
}

/** 便利函式：POST JSON 並解析回應，非 2xx 一律轉成可讀錯誤 */
export async function postJson<T>(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<T> {
  const res = await request({ url, method: 'POST', json: body, headers, timeoutMs, signal });
  if (!res.ok) throw new HttpError(res.status, extractMessage(res.text), url);
  return JSON.parse(res.text) as T;
}

export async function postMultipart<T>(
  url: string,
  parts: MultipartPart[],
  headers: Record<string, string>,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<T> {
  const res = await request({ url, method: 'POST', multipart: parts, headers, timeoutMs, signal });
  if (!res.ok) throw new HttpError(res.status, extractMessage(res.text), url);
  try {
    return JSON.parse(res.text) as T;
  } catch {
    throw new HttpError(res.status, '服務端回應不是有效的 JSON', url);
  }
}

export async function getJson<T>(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<T> {
  const res = await request({ url, method: 'GET', headers, timeoutMs, signal });
  if (!res.ok) throw new HttpError(res.status, extractMessage(res.text), url);
  return JSON.parse(res.text) as T;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly url: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/** 各家錯誤格式不同，盡量挖出人看得懂的那一句 */
function extractMessage(raw: string): string {
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    const err = j.error;
    if (typeof err === 'string') return err;
    if (err && typeof err === 'object') {
      const m = (err as Record<string, unknown>).message;
      if (typeof m === 'string') return m;
    }
    if (typeof j.message === 'string') return j.message;
    if (typeof j.detail === 'string') return j.detail;
  } catch {
    /* 不是 JSON，原文回傳 */
  }
  return raw.slice(0, 400) || '無回應內容';
}

/** 去掉尾斜線，避免 baseUrl 拼接出 // */
export function trimSlash(u: string): string {
  return u.replace(/\/+$/, '');
}

/* ----------------------------------------------------------------------------
   Base URL 正規化
   ----------------------------------------------------------------------------
   使用者只要填服務位址（例如 https://api.openai.com）；API 版本路徑（/v1、/v1beta…）
   由程式在組 URL 時自動補齊，因此欄位提示與預設值都不再帶 /v1。
   若使用者自己在位址後帶了路徑（/v1、/api…），一律以他填的為準，且不會重複疊加
   版本段落（不會出現 /v1/v1）。
   -------------------------------------------------------------------------- */

/** 版本段落樣式：v1、v2、v1beta、v1alpha… */
const VERSION_SEGMENT = /^v\d+[a-z0-9]*$/i;

/** 取出 URL 的路徑部分（含前導斜線、不含 query/hash）；沒有路徑時回傳 ''。 */
export function apiPathOf(u: string): string {
  const s = (u ?? '').trim().replace(/[?#].*$/, '');
  if (!s) return '';
  const scheme = /^[a-z][a-z0-9+.-]*:\/\/[^/]*/i.exec(s);
  if (!scheme) {
    // 沒有 scheme（例：127.0.0.1:11434/v1）時，第一個斜線之後就是路徑
    const slash = s.indexOf('/');
    return slash < 0 ? '' : s.slice(slash);
  }
  return s.slice(scheme[0].length);
}

/** URL 是否已自帶路徑（例：https://host/v1、https://host/api）。 */
export function hasApiPath(u: string): boolean {
  return apiPathOf(u).replace(/\/+$/, '').length > 1;
}

/** URL 尾端的版本段落（'https://host/v1' → '/v1'）；沒有則回傳 ''。 */
export function apiVersionSegment(u: string): string {
  const segments = apiPathOf(u).replace(/\/+$/, '').split('/').filter(Boolean);
  const last = segments[segments.length - 1] ?? '';
  return VERSION_SEGMENT.test(last) ? `/${last}` : '';
}

/** 只留 scheme + host（'https://host/v1' → 'https://host'）。 */
export function stripApiPath(u: string): string {
  const s = (u ?? '').trim().replace(/[?#].*$/, '');
  const path = apiPathOf(s);
  return trimSlash(path ? s.slice(0, s.length - path.length) : s);
}

/** 位址尚未自帶路徑時補上 API 版本前綴（例：'/v1'）。 */
export function withApiPrefix(base: string, prefix: string): string {
  const b = trimSlash((base ?? '').trim());
  if (!b || !prefix || hasApiPath(b)) return b;
  return `${b}${prefix}`;
}

/** base + path，並避免版本段落重複（不會組出 /v1/v1/…）。 */
export function joinApiUrl(base: string, path: string): string {
  const b = trimSlash((base ?? '').trim());
  const p = path.startsWith('/') ? path : `/${path}`;
  const baseVersion = apiVersionSegment(b);
  const first = apiPathOf(p).split('/').filter(Boolean)[0] ?? '';
  const pathVersion = VERSION_SEGMENT.test(first) ? `/${first}` : '';
  if (baseVersion && pathVersion && baseVersion === pathVersion) {
    return `${b}${p.slice(pathVersion.length)}`;
  }
  return `${b}${p}`;
}

/** 一次做完「補版本前綴 + 串接路徑」，adapter 都用這支組 URL。 */
export function apiUrl(base: string, prefix: string, path: string): string {
  return joinApiUrl(withApiPrefix(base, prefix), path);
}
