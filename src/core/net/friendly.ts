/* ============================================================================
   使用者可見的錯誤措辭（去來源化）
   ----------------------------------------------------------------------------
   使用者明確要求：錯誤與警告只說明「發生什麼」與「下一步」，不要揭露它從
   哪裡來 —— 畫面上一律不出現網址、主機名、端點路徑、下載來源或供應商位址。

   為什麼集中在這裡而不是逐點改寫：來源資訊可能來自伺服器回應（error.message）、
   HTTP 狀態、更新資訊的來源字串…只要有任何一處漏掉，提示就會又露出網址。
   在「顯示前」統一過濾，才能一次守住全部出口。

   注意：這裡只換措辭。狀態碼、錯誤種類、原始 error 物件照舊往上傳，
   診斷能力不受影響 —— 被拿掉的只有給人看的那一層。
   ========================================================================== */

/** 看起來像來源的片段：網址、網域、IP、端點路徑、Windows 路徑。 */
const SOURCE_PATTERNS: readonly RegExp[] = [
  /[a-z][a-z0-9+.-]*:\/\/\S+/i,
  /\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|net|org|io|ai|dev|app|cloud|run|sh|co|tw|cn|jp|kr|hk|sg|local|internal|lan|test|example)\b(?::\d+)?/i,
  /\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/,
  /\blocalhost(?::\d+)?\b/i,
  /(?:^|[\s(（"'：:])\/v\d[\w/.-]*/i,
  /(?:^|[\s(（"'：:])\/(?:images|edits|chat|completions|models|api|sdapi|v1beta|v1alpha)[\w/.-]*/i,
  /\b[A-Za-z]:\\[^\s"'<>]*/,
];

/** 這段文字是否提到「來源」（網址／主機／端點／路徑）。 */
export function mentionsSource(text: string): boolean {
  const value = String(text ?? '');
  return SOURCE_PATTERNS.some((pattern) => pattern.test(value));
}

/**
 * 把任意錯誤訊息壓成一句可以給使用者看的字。
 * 含來源資訊就整句換成 fallback（截掉網址會留下殘缺句子，反而更難懂）；
 * 不含來源則原樣保留，只收斂空白與長度。
 */
export function userFacingReason(raw: unknown, fallback: string): string {
  const text = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  if (!text) return fallback;
  if (mentionsSource(text)) return fallback;
  return text.length > 160 ? `${text.slice(0, 160)}…` : text;
}

/**
 * 依 HTTP 狀態給一句看得懂、又不帶來源的說明。
 * 伺服器原話只在「本身不含來源」時採用 —— 那通常是最精確的線索。
 */
export function httpFailureReason(status: number | undefined, raw: unknown, fallback: string): string {
  const detail = userFacingReason(raw, '');
  switch (status) {
    case 400:
    case 422:
      return detail || '請求內容未被接受，請調整提示詞或模型設定';
    case 401:
    case 403:
      return 'API 金鑰無效或權限不足，請檢查供應商設定';
    case 404:
      return detail || '找不到指定的模型，請確認模型名稱';
    case 408:
    case 504:
      return '服務回應逾時，請稍後再試';
    case 429:
      return '請求次數或額度已達上限，請稍後再試';
    default:
      if (typeof status === 'number' && status >= 500) return '服務暫時無法使用，請稍後再試';
      return detail || fallback;
  }
}
