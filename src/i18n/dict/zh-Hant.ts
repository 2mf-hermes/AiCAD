/* ============================================================================
   字典 — 繁體中文（參考語言 / Reference Locale）
   ----------------------------------------------------------------------------
   這一份是「型別的來源」：其他語言必須滿足 Dict，缺一個鍵、或參數簽章不一致，
   tsc 就會擋下來。刻意不做「缺鍵時回退英文」的執行期機制 —— 那會讓漏譯默默
   出貨；讓它在編譯期就爆掉更誠實。

   帶參數的字串一律用函式而非 {0} 佔位符。理由：函式的參數有型別與名字，
   翻譯者看得懂語意，而且語序可以隨語言自由調整（日文／韓文的語序與中文不同，
   佔位符字串常會被迫寫成不自然的句子）。
   ========================================================================== */

export const zhHant = {
  app: {
    untitled: '未命名文件',
    docTitle: (n: number, w: number, h: number) => `圖面 ${n} · ${w}×${h}`,
    exportPng: '匯出 PNG',
    exportCad: '匯出 DXF（CAD）',
    preferences: '偏好設定',
  },

  common: {
    save: '儲存', edit: '編輯',
    cancel: '取消',
    remove: '移除',
    close: '關閉',
    done: '完成',
    add: '新增',
    name: '名稱',
    never: '從未',
  },

  left: {
    title: '圖面規格',
    generate: '產生圖面',
    generating: '生成中…',
    noEngine: '尚未啟用任何出圖引擎，請先開啟偏好設定。',
  },

  stage: {
    maskMode: '選區模式',
    maskModeHint: '選區模式（局部重繪）',
    grid: '格線',
  },

  intent: {
    kindSection: '圖面類型',
    textSection: '語言與文字',
    textRenderMode: '圖面文字',
    textRenderModeHint: '標題、標示與註記由誰繪製',
    textRenderApplication: '由應用程式精確繪製',
    textRenderTextModel: '文字模型疊加',
    textRenderImageModel: '由生圖模型繪製',
    customFieldsSection: '自訂標題欄位',
    kindLabel: '類別',
    kindHint: '決定視角配置與標註慣例',
    subject: '主體描述',
    subjectHint: '用中文或英文寫清楚結構、特徵與數量',
    subjectPlaceholder:
      '例：法蘭式軸承座，四個 M8 沉頭孔對稱分佈，中央 ⌀40 軸孔帶油封槽，底面兩側各有加強肋',
    textLanguage: '圖面文字語言',
    textLanguageHint: '控制標題欄、標籤、註記與引線文字，不影響尺寸數字與標準符號',

    dimsSection: '關鍵尺寸',
    dimsEmpty: '尚未指定尺寸。留空時模型會自行推估比例；填入後會要求數值逐字出現在圖上。',
    dimValuePlaceholder: '120',
    removeRow: (name: string) => `移除 ${name}`,
    thisRow: '這一列',
    unit: '單位',

    specSection: '製圖規範',
    annotationSection: '標註項目',
    projection: '投影法',
    projectionHint: '第一角為 ISO／台灣慣例；第三角為 ANSI',
    firstAngle: '第一角',
    thirdAngle: '第三角',
    lineStyle: '線條風格',

    dimensions: '尺寸標註',
    dimensionsHint: '延伸線、尺寸線與數值',
    tolerance: '公差',
    toleranceHint: '關鍵尺寸旁標註 ±值',
    gdt: '幾何公差 GD&T',
    gdtHint: '平面度、同心度、垂直度符號',
    callouts: '零件編號引線',
    titleBlock: '標題欄',
    titleBlockHint: 'ISO 7200 樣式，置於右下角',
    scaleBar: '比例尺',
    annotationPreHint: '生圖前就要決定，會改變圖面本身',
    annotationPostHint: '生圖前後都能自由開關，由應用程式繪製，不交給生圖模型',
    scaleBarHint: '圖形比例尺，左下角',
    sheetTitle: '圖面標題',
    sheetTitleHint: '顯示在標題欄內',
    sheetDate: '日期',
    sheetDateHint: '留空則不顯示日期',
    dateToday: '今天',
    addField: '新增欄位',
    fieldValue: '值',

    extraSection: '附加條件',
    notes: '補充要求',
    notesPlaceholder: '例：右上角加一個 A-A 剖視圖，比例 1:2',
    exclude: '排除項目',
    excludeHint: '以逗號分隔；系統已預設排除打光、陰影與背景',
    excludePlaceholder: '透視變形, 手寫字',
  },

  drawingLanguage: {
    'zh-Hant': '繁體中文', 'zh-Hans': '簡體中文', en: '英文', ja: '日文', ko: '韓文', none: '不產生文字',
  },

  /** 下拉清單的選項群組小標題 */
  group: {
    mechanical: '機械製造',
    architectural: '建築營建',
    system: '系統與配置圖',
    formal: '正式交付圖',
    sketch: '概念草圖',
  },

  kind: {
    'mechanical-part': '機械零件',
    assembly: '組立圖',
    'floor-plan': '建築平面',
    elevation: '立面／剖面',
    electrical: '電氣配線',
    piping: '管線 P&ID',
    schematic: '原理方塊圖',
    'exploded-view': '爆炸示意',
  },

  lineStyle: {
    'technical-ink': '工程墨線',
    blueprint: '藍圖',
    'pencil-draft': '鉛筆草圖',
    'cad-vector': 'CAD 向量',
  },

  provider: {
    saveBeforeClosing: '目前正在編輯 AI Provider。完成設定前要先儲存變更嗎？',
    add: '新增 Provider', duplicate: '複製', delete: '刪除', moveUp: '提高優先序', moveDown: '降低優先序',
    type: 'Provider 類型', typeHint: '選擇內建協定、相容 API、自訂閘道或本機服務',
    priority: '優先序', priorityHint: '數字越小越先執行；失敗後依序接手',
    fallbackEnabled: '加入備用接續', fallbackEnabledHint: '允許此 Provider 在其他引擎失敗後依優先序接手',
    textFallbackEnabled: '文字模型備用', textFallbackEnabledHint: '允許文字模型接手提示語精煉',
    imageFallbackEnabled: '生圖模型備用', imageFallbackEnabledHint: '允許影像模型接手生圖與局部重繪',
    endpoint: 'Endpoint', endpointHint: '相對路徑或完整 URL', endpointPreset: '參考端點',
    endpointText: '文字模型端點',
    endpointImage: '生圖端點',
    endpointInpaint: '局部重繪端點',
    retryCount: '重試次數', retryHint: '切換到下一組 Provider 前重試 0 至 5 次',
    authentication: '驗證方式', authHint: '憑證只保存在 Windows DPAPI，不寫入一般設定檔',
    authNone: '無', authBearer: 'Bearer Token', authApiKey: 'API Key Header', authQuery: 'Query Parameter',
    headers: '自訂 Headers', headersHint: '每行一筆：Header: value',
    requestFormat: 'Request Format', requestFormatHint: 'JSON 樣板，可使用 {{prompt}}、{{model}}、{{mode}}',
    textPath: '文字回應路徑', imagePath: '影像回應路徑', dotPath: 'JSON dot path',
    loadModels: '載入模型', models: '模型', modelsHint: '選擇端點回傳的模型', modelsFound: (count: number) => `找到 ${count} 個模型`,
    typeOpenAICompatible: 'OpenAI 相容', typeCustom: '自訂 Relay / Gateway', typeLocal: '本機 LLM',
  },

  right: {
    titleInpaint: '局部重繪',
    titleEngine: '引擎與歷程',
    imageEngine: '出圖引擎',
    disabledSuffix: '（未啟用）',
    noRefine: '不精煉提示語',
    refineWith: (name: string) => `以 ${name} 精煉`,
    refineOn: '精煉會把模糊描述編譯成精確幾何敘述，標註規範不受影響。',
    refineOff: '啟用一個文字引擎後即可自動精煉幾何描述。',
    refineEngine: '提示語精煉引擎',
    groupCloud: '雲端引擎',
    groupLocal: '本機引擎',
    groupOff: '不使用',

    masks: '選區',
    maskLabel: (i: number) => `選區 ${i}`,
    maskEmptyReady: '開啟選區模式後，在圖面上拖曳框選要修改的區域。',
    maskEmptyNoImage: '先產生一張圖面，才能進行局部重繪。',
    maskPlaceholder: '要在這個區域做什麼？例：加上 A-A 剖面線與 ⌀12 貫穿孔標註',
    redraw: '重繪選區',

    history: '歷程',
    historyEmpty: '每次生成與重繪都會保留，可隨時回溯比對。',
    historyDelete: '刪除此筆歷程',

    params: '本次參數',
    engine: '引擎',
    model: '模型',
    resolvedPrompt: '實際提示語',
    resolvedPromptHint: '可全選複製，用於重現或除錯',
  },

  generationRetry: {
    title: "圖面產生失敗",
    savedHint: "已保留上次文字模型的內容。沿用可略過文字模型，只重新生圖；全部重來會依目前設定重新產生文字與圖面。內容僅保留至關閉程式或切換專案。",
    noSavedHint: "沒有可沿用的文字模型內容，請重新產生。",
    reuse: "沿用上次內容重新生圖",
    restart: "全部重新產生",
  },

  status: {
    ready: (name: string) => `就緒 · ${name}`,
    readyText: (name: string) => `文字就緒 · ${name}`,
    readyImage: (name: string) => `生圖就緒 · ${name}`,
    noEngine: '尚未設定引擎',
    failed: '產生失敗，請檢查設定或網路後再試。',
    preparing: '準備中',
    maskMode: '選區模式',
    viewMode: '檢視模式',
    history: (n: number) => `歷程 ${n}`,
    elapsed: (sec: number, limitSec: number) => `已等待 ${sec} 秒 / 上限 ${limitSec} 秒`,
    timedOut: (limitSec: number) =>
      `逾時：等待 ${limitSec} 秒仍未收到回應。請在偏好設定調高該引擎的逾時秒數，或確認端點與模型名稱。`,
  },

  project: {
    newProject: '新增專案', openProject: '開啟專案', saveProject: '儲存專案',
    namePrompt: '專案名稱', newConfirm: '建立新專案？尚未儲存的變更將會遺失。',
    closeTitle: '儲存變更？', closeConfirm: '這個專案有尚未儲存的變更。關閉前要先儲存嗎？', discardChanges: '不儲存',
    openTitle: '開啟專案', openHint: '從最近儲存的作品繼續修改', empty: '尚未儲存任何專案。',
    meta: (when: string, boards: number) => `${when} · ${boards} 個版本`,
    deleteConfirm: '確定刪除這個專案？此動作無法復原。',
    saveFailed: (reason: string) => `儲存專案失敗：${reason}`,
    loadFailed: (reason: string) => `載入專案失敗：${reason}`,
    deleteFailed: (reason: string) => `刪除專案失敗：${reason}`,
  },

  settings: {
    title: '偏好設定',
    navGeneral: '一般',
    navModels: 'AI 模型',
    navUpdates: '更新',
    navAbout: '關於',

    appearance: '外觀',
    themeDark: '深色',
    themeLight: '淺色',
    themeSystem: '系統',

    language: '語言',
    languageLabel: '介面語言',
    languageHint: '選擇後立即套用，並隨設定一起保存',

    canvas: '畫布',
    canvasWidth: '預設寬度',
    canvasHeight: '預設高度',
    canvasHint: '像素；生成時作為輸出比例依據',

    engineList: 'AI 引擎',
    local: '本機',
    cloud: '雲端',
    capImage: '出圖',
    capInpaint: '重繪',
    capText: '文字',

    engineSection: '引擎',
    localNoAuth: '本機服務，無需憑證',
    cloudService: '雲端服務',
    enableEngine: '啟用此引擎',
    enableEngineHint: '啟用後才會出現在生成面板的引擎選單中',
    capImageFull: '出圖',
    capInpaintFull: '局部重繪',
    capTextFull: '提示語精煉',
    capVisionFull: '讀圖',

    connection: '連線',
    displayName: '顯示名稱',
    displayNameHint: '可改成便於辨識的名稱，例如「公司中轉站」',
    baseUrl: 'Base URL',
    baseUrlDefault: (url: string) => `留空則使用預設：${url}`,
    baseUrlRelay: '填入服務位址即可，API 路徑（如 /v1）由程式自動補齊',
    baseUrlPathAsk: (path: string) => `位址尾端帶有路徑 ${path}，要照這個路徑使用嗎？`,
    baseUrlPathKeep: '保留路徑',
    baseUrlPathDrop: '改為不帶路徑',
    apiKey: 'API 憑證',
    apiKeyOsHint: '由 Windows 加密保管（DPAPI，綁定本機帳戶），不寫入設定檔',
    apiKeySessionHint: '開發模式：僅存於本次工作階段，關閉視窗即清除',
    apiKeyPlaceholder: '貼上 API Key',
    textModel: '文字模型',
    textModelHint: '用於提示語精煉',
    imageModel: '影像模型',
    imageModelHint: '用於生成與重繪',
    imageModelPlaceholder: '（使用服務端當前模型）',
    notSupported: '此引擎不支援',
    timeout: '逾時（秒）',
    timeoutLocalHint: '本機推論建議 300 以上',
    timeoutCloudHint: '建議 60–120',
    textTimeout: '文字模型逾時（秒）',
    imageTimeout: '生圖模型逾時（秒）',
    timeoutTextLocalHint: '本機推論建議 300 以上',
    timeoutTextCloudHint: '建議 60–120',
    timeoutImageLocalHint: '本機推論建議 300 以上',
    timeoutImageCloudHint: '建議 60–180',

    probe: '測試連線',
    probing: '測試中…',
    probeIdle: '尚未測試',
    probeConnecting: '正在連線…',

    footNote: '設定即時生效並自動儲存。憑證與一般設定分開存放，不會出現在匯出的設定檔中。',
    storageNative: (path: string) => `設定檔位置：${path}`,
    storageFallback: '瀏覽器模式：設定僅存於此瀏覽器分頁的儲存區',
  },

  update: {
    section: '應用程式更新',
    autoCheck: '啟動時自動檢查更新',
    autoCheckHint: '關閉後仍可隨時手動檢查',
    channel: '更新通道',
    channelStable: '穩定版',
    channelNone: '不接收更新',
    lastChecked: (when: string) => `上次檢查：${when}`,
    check: '檢查更新',
    checking: '檢查中…',
    upToDate: '已是最新版本',
    found: (version: string) => `發現新版本 ${version}`,
    download: '下載更新',
    downloading: '下載中…',
    verifying: '驗證中…',
    install: '安裝並重新啟動',
    installing: '安裝中，請勿關閉視窗…',
    failed: '更新失敗',
    progress: (percent: number) => `下載中 ${percent}%`,
    unavailable: '此環境無法自動更新（開發模式）',
    currentVersion: (v: string) => `目前版本 ${v}`,
    releaseNotes: '版本說明',
    promptIntro: '更新內容摘要：',
    itemAdded: '新增',
    itemChanged: '修改',
    itemRemoved: '刪除',
    promptEmpty: '錯誤修正與穩定性改善。',
    promptTitle: (v: string) => `AiCAD ${v} 已上架`,
    promptHint: '更新可取得最新功能與錯誤修復。',
    goToUpdate: '前往更新',
    later: '稍後再說',
    retry: '重試',
    source: (where: string) => '來源：' + where,
  },

  about: {
    section: '關於 Ai Cad',
    tagline: 'AI 專業圖面生成與編輯工具',
    version: '版本',
    platform: '執行環境',
    desktop: '桌面宿主（WebView2）',
    browser: '瀏覽器（開發模式）',
    note: '本工具的尺寸標註以向量疊層渲染，數值取自你輸入的真實參數，不由模型臆測。',
  },
};

/** 其他語言的形狀契約。
    刻意不加 `as const`：否則每個值會變成字面型別（例如 '完成'），
    其他語言填入不同字串就會被判為型別不符。這裡要的是「形狀」相同，不是「內容」相同。 */
export type Dict = typeof zhHant;
