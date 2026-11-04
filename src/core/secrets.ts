/* ============================================================================
   憑證保管橋接 (Secrets Bridge)
   ----------------------------------------------------------------------------
   安全設計：API Key 是使用者的付費憑證，必須與一般設定分離。
   - 生產環境：由原生殼層存入 Windows Credential Manager（DPAPI 加密，
     綁定使用者帳戶），前端只持有 secretRef 字串，永不接觸明文長期儲存。
   - 開發環境：退回 sessionStorage —— 關閉分頁即消失，不落地到磁碟。
     刻意不用 localStorage，避免明文金鑰留在 WebView 的 IndexedDB 目錄。

   Phase 2 只需在原生端注入 setSecretsBackend()，UI 零改動。
   ========================================================================== */

export interface SecretsBackend {
  get(ref: string): Promise<string>;
  set(ref: string, value: string): Promise<void>;
  remove(ref: string): Promise<void>;
  /** 供 UI 顯示「憑證由系統金鑰保管庫保護」等說明 */
  readonly kind: 'os-keychain' | 'session-only';
}

const sessionBackend: SecretsBackend = {
  kind: 'session-only',
  async get(ref) {
    return sessionStorage.getItem(ref) ?? '';
  },
  async set(ref, value) {
    if (value) sessionStorage.setItem(ref, value);
    else sessionStorage.removeItem(ref);
  },
  async remove(ref) {
    sessionStorage.removeItem(ref);
  },
};

let backend: SecretsBackend = sessionBackend;

export function setSecretsBackend(b: SecretsBackend): void {
  backend = b;
}

export function secrets(): SecretsBackend {
  return backend;
}

/** 遮罩顯示：sk-abc…9f2z，永遠不在 UI 上還原完整金鑰 */
export function maskSecret(s: string): string {
  if (!s) return '';
  if (s.length <= 10) return '•'.repeat(s.length);
  return `${s.slice(0, 5)}${'•'.repeat(6)}${s.slice(-4)}`;
}
