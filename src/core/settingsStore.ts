/* ============================================================================
   設定儲存後端 (Settings Storage Backend)
   ----------------------------------------------------------------------------
   刻意與 settings.ts 分開：settings.ts 負責「設定長什麼樣、怎麼驗證、怎麼
   合併預設值」，這裡只負責「字串存到哪裡」。分開之後，換儲存位置不必動
   schema，改 schema 也不必動儲存邏輯。

   後端有兩種：
   - native-file：桌面宿主，寫入 %APPDATA%\AiCad\settings.json（由 host.ts 注入）
   - local-storage：瀏覽器開發用後備。在打包後的 App 裡不可靠，因為宿主的
     隨機埠會讓 origin 每次啟動都變，localStorage 也就跟著歸零。
   ========================================================================== */

export interface SettingsBackend {
  /** 回傳原始 JSON 字串；從未存過時回空字串 */
  load(): Promise<string>;
  save(json: string): Promise<void>;
  readonly kind: 'native-file' | 'local-storage';
}

const STORAGE_KEY = 'aicad.settings.v1';

const localBackend: SettingsBackend = {
  kind: 'local-storage',
  async load() {
    try {
      return localStorage.getItem(STORAGE_KEY) ?? '';
    } catch {
      return ''; // 隱私模式或儲存被封鎖：以預設值運行，不阻斷啟動
    }
  },
  async save(json: string) {
    try {
      localStorage.setItem(STORAGE_KEY, json);
    } catch {
      /* 寫入失敗不該讓使用者的操作中斷 */
    }
  },
};

let backend: SettingsBackend = localBackend;

export function setSettingsBackend(b: SettingsBackend): void {
  backend = b;
}

export function settingsBackend(): SettingsBackend {
  return backend;
}
