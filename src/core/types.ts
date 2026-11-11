/* ============================================================================
   Ai Cad — 領域型別 (Domain Types)
   ----------------------------------------------------------------------------
   這一層不依賴 React、不依賴任何 provider SDK，只描述「圖面」這件事。
   ========================================================================== */

/** 圖面類型 —— 決定提示語骨架與預設標註慣例 */
export type DrawingKind =
  | 'mechanical-part'   // 機械零件（三視圖 / 剖視）
  | 'assembly'          // 組立圖 / 爆炸圖
  | 'floor-plan'        // 建築平面
  | 'elevation'         // 立面 / 剖面
  | 'electrical'        // 電氣 / 配線
  | 'piping'            // 管線 / P&ID
  | 'schematic'         // 原理圖 / 方塊圖
  | 'exploded-view';    // 爆炸示意

/** 投影法 —— 第一角（ISO/台灣常用）或第三角（ANSI） */
export type ProjectionAngle = 'first' | 'third';

/** 線條風格 —— 對應 CAD 出圖慣例 */
export type LineStyle = 'technical-ink' | 'blueprint' | 'pencil-draft' | 'cad-vector';

/** 尺寸單位 */
export type Unit = 'mm' | 'cm' | 'm' | 'in' | 'ft';
export type DrawingTextLanguage = 'zh-Hant' | 'zh-Hans' | 'en' | 'ja' | 'ko' | 'none';
export type DrawingTextRenderMode = 'application' | 'text-model-overlay' | 'image-model';
export interface TitleBlockField { key: string; value: string; }
export interface DrawingTextSpec {
  renderMode: DrawingTextRenderMode;
  title: string;
  date: string;
  customFields: TitleBlockField[];
}
export const DRAWING_TEXT_LANGUAGES: DrawingTextLanguage[] = ['zh-Hant', 'zh-Hans', 'en', 'ja', 'ko', 'none'];

/** 標註慣例 */
export interface AnnotationSpec {
  /** 是否要求標註尺寸線與延伸線 */
  dimensions: boolean;
  /** 是否要求公差（如 ±0.1） */
  tolerance: boolean;
  /** 是否要求幾何公差符號 (GD&T) */
  gdt: boolean;
  /** 是否要求零件編號與引線 (balloon callouts) */
  callouts: boolean;
  /** 是否要求標題欄 / 圖框 */
  titleBlock: boolean;
  /** 是否要求比例尺 */
  scaleBar: boolean;
  /** 單位 */
  unit: Unit;
}

/** 使用者對一張圖的完整意圖 —— 提示語建構層的唯一輸入 */
export interface ReferenceAttachment {
  id: string;
  name: string;
  mimeType: string;
  /** data URL；限制單檔 8 MiB，供生成前端點對點傳輸。 */
  dataUrl: string;
}

export interface DrawingIntent {
  kind: DrawingKind;
  /** 使用者自然語言描述（中文或英文皆可） */
  subject: string;
  /** 類別內容：補充所選圖面類別的用途、組成與交付範圍。 */
  categoryContent: string;
  /** Language used by title blocks, labels and callouts on the generated sheet. */
  textLanguage: DrawingTextLanguage;
  /** Authoritative drawing text and the strategy used to render it. */
  text: DrawingTextSpec;
  /** 已知的關鍵尺寸，例如 { '外徑': '120 mm', '厚度': '8 mm' } */
  measurements: Record<string, string>;
  projection: ProjectionAngle;
  lineStyle: LineStyle;
  annotation: AnnotationSpec;
  /** 額外要求（自由文字） */
  notes: string;
  /** 負面指令（不要陰影、不要透視…） */
  exclude: string[];
  references?: ReferenceAttachment[];
}

/** 畫布上的一個選區（局部重繪用） */
export interface MaskRegion {
  id: string;
  /** 正規化座標 0..1，與圖片解析度解耦 */
  x: number;
  y: number;
  w: number;
  h: number;
  /** 這個選區要做什麼 */
  instruction: string;
}

/** 一次生成/編輯的產出 */
/** 草稿中的文字標示。座標與字高皆為 0..1 正規化值，與圖片解析度脫鉤，生圖後由應用程式補回。 */
export interface DrawingTextLabel {
  text: string;
  x: number;
  y: number;
  anchor: 'start' | 'middle' | 'end';
  size: number;
  rotate: number;
}

export interface Artboard {
  id: string;
  createdAt: number;
  /** data: URL 或本機檔案路徑 */
  imageRef: string;
  width: number;
  height: number;
  intent: DrawingIntent;
  /** 若為局部重繪，指向上一版 */
  parentId?: string;
  masks?: MaskRegion[];
  /** 實際送出的提示語，保留以便重現 */
  resolvedPrompt: string;
  providerId: string;
  model: string;
  /** 草稿擷取的文字標示（選填，舊檔沒有此欄位）。 */
  textLabels?: DrawingTextLabel[];
  /** 草稿向量（選填，舊檔沒有此欄位）。有它才有真正的幾何可匯出成 CAD 檔。 */
  draftSvg?: string;
}

/** 顯示順序的單一來源。標籤文字改由 i18n 字典提供（t.kind / t.lineStyle），
    這裡只負責「有哪些、依什麼順序排」—— 順序屬於領域知識，不隨語言改變。

    順序同時決定下拉清單的分組：Select 的群組小標題只認「相鄰」，
    所以同一組的項目必須連在一起，改動順序時要一併檢查 DRAWING_KIND_GROUP。 */
export const DRAWING_KINDS: DrawingKind[] = [
  'mechanical-part',
  'assembly',
  'exploded-view',
  'floor-plan',
  'elevation',
  'electrical',
  'piping',
  'schematic',
];

/** 圖面類型的群組鍵（對應 t.group.*）。用途是讓下拉清單能標出
    「機械製造／建築營建／系統圖」，這三類的製圖慣例差異很大。 */
export type KindGroup = 'mechanical' | 'architectural' | 'system';

export const DRAWING_KIND_GROUP: Record<DrawingKind, KindGroup> = {
  'mechanical-part': 'mechanical',
  assembly: 'mechanical',
  'exploded-view': 'mechanical',
  'floor-plan': 'architectural',
  elevation: 'architectural',
  electrical: 'system',
  piping: 'system',
  schematic: 'system',
};

export const LINE_STYLES: LineStyle[] = [
  'technical-ink',
  'cad-vector',
  'blueprint',
  'pencil-draft',
];

/** 線條風格分兩類：可直接交付的正式圖，與用來溝通想法的概念草圖。 */
export type LineStyleGroup = 'formal' | 'sketch';

export const LINE_STYLE_GROUP: Record<LineStyle, LineStyleGroup> = {
  'technical-ink': 'formal',
  'cad-vector': 'formal',
  blueprint: 'formal',
  'pencil-draft': 'sketch',
};

export function createDefaultIntent(): DrawingIntent {
  return {
    kind: 'mechanical-part',
    subject: '',
    categoryContent: '',
    textLanguage: 'zh-Hant',
    text: {
      renderMode: 'application',
      title: '',
      date: '',
      customFields: [],
    },
    measurements: {},
    projection: 'first',
    lineStyle: 'technical-ink',
    annotation: {
      dimensions: true,
      tolerance: false,
      gdt: false,
      callouts: true,
      titleBlock: true,
      scaleBar: false,
      unit: 'mm',
    },
    notes: '',
    exclude: [],
  };
}
