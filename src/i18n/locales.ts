/* ============================================================================
   語言清單與型別 (Locales)
   ----------------------------------------------------------------------------
   刻意讓這個檔案「零依賴」：settings.ts 需要語言型別，i18n 的字典又需要
   settings 之外的東西，若把型別放進字典檔就會繞出一圈相依。把最小的事實
   （有哪些語言、預設是誰、怎麼驗證）獨立成一個葉節點模組，兩邊都能安全 import。

   標籤一律用該語言自己的寫法（endonym）。理由：使用者若誤選了看不懂的語言，
   仍能在清單裡找回自己的母語 —— 如果把「韓文」寫成中文，韓國使用者就找不到。
   ========================================================================== */

export const LOCALES = ['zh-Hant', 'zh-Hans', 'en', 'ja', 'ko'] as const;

export type Locale = (typeof LOCALES)[number];

/** 預設繁體中文：這是本專案的主要使用者群 */
export const DEFAULT_LOCALE: Locale = 'zh-Hant';

/** 選單顯示用；永遠以該語言自身的文字書寫 */
export const LOCALE_LABEL: Record<Locale, string> = {
  'zh-Hant': '繁體中文',
  'zh-Hans': '简体中文',
  en: 'English',
  ja: '日本語',
  ko: '한국어',
};

/** BCP 47 標籤，供 <html lang> 與 Intl 使用 */
export const LOCALE_TAG: Record<Locale, string> = {
  'zh-Hant': 'zh-Hant-TW',
  'zh-Hans': 'zh-Hans-CN',
  en: 'en-US',
  ja: 'ja-JP',
  ko: 'ko-KR',
};

export function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && (LOCALES as readonly string[]).includes(v);
}
