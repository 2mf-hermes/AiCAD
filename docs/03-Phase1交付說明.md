# Ai Cad — Phase 1 交付說明與後續路線

版本 0.1.0 · 2026-08-30 · Windows 10/11 x64

---

## 一、Phase 1 已達成什麼

**核心硬需求已驗證成立：單一 EXE、雙擊即執行、免安裝任何相依套件。**

```
dist-exe\AiCad.exe    6.46 MB    完全靜態連結，無 DLL、無 runtime、無安裝程式
```

實機驗證結果（`verify.ps1` 執行紀錄）：

| 驗證項 | 結果 |
| --- | --- |
| 程序啟動 | 存活，PID 正常 |
| 主視窗建立 | 標題 `Ai Cad`，1440×900 置中 |
| 記憶體佔用 | 27.3 MB（Electron 同類約 120–200 MB） |
| 內嵌資產供應 | `/index.html` HTTP 200 · 465 B |
| JS bundle | `assets/index-*.js` HTTP 200 · 232 KB |
| 橋接端點權限 | 未帶 token 的請求 → **403 拒絕** |

前端建置：`tsc --noEmit` 零錯誤，vite 6 transform 50 modules，CSS 17.6 KB / JS 229.6 KB（gzip 75 KB）。

---

## 二、最終技術棧（含一次重要的路線修正）

```
單一 EXE (Go 1.23, CGO_ENABLED=0, -H windowsgui -s -w -trimpath)
  ├── go:embed all:web            前端資產內嵌，執行期不落地
  ├── net/http on 127.0.0.1:0     從記憶體供應資產（隨機埠）
  ├── /bridge/http                原生 HTTP 出口，繞過 CORS
  └── jchv/go-webview2            純 Go 綁定 → 系統內建 WebView2 Runtime
        └── React 19 + TypeScript + Vite 6
```

### 建置期踩到的實際障礙與修正

**1. Tauri 不可用。** 本機無 `cargo` / `rustc`，Rust + MSVC 工具鏈不存在。改走 Go。

**2. 官方 `webview/webview_go` 編譯失敗。** 它走 cgo，需要 Windows SDK 標頭檔。實測錯誤：

```
mswebview2/include/WebView2.h:978:10:
fatal error: EventToken.h: No such file or directory
```

本機的 TDM-GCC 沒有 Windows SDK 標頭。**改用 `jchv/go-webview2`** —— 純 Go，透過 `go-winloader` 在執行期動態載入 WebView2Loader，可用 `CGO_ENABLED=0` 編譯。

這個替換帶來三個額外好處：建置只需要 Go 本身、產物完全靜態連結、未來在 CI 上重現建置不需要安裝任何 C 工具鏈。

### 為什麼是 loopback HTTP 而不是 `file://`

`file://` 下 `fetch`、Web Crypto、部分 CSS 特性都會受限。走 `127.0.0.1` 能拿到完整的現代瀏覽器能力，代價只有一個由 OS 指派的隨機埠。

---

## 三、安全設計（未被要求，但必須說明）

宿主開了一個能代發任意 HTTP 請求的端點。若不設防，機器上任何程式或任何瀏覽器分頁都能拿它當 SSRF 跳板。已實作的四道防線：

1. **只綁 `127.0.0.1`**，不對外網開放。
2. **埠號由 OS 隨機指派**，每次啟動不同，無法預先猜測。
3. **`X-AiCad-Token` 標頭驗證**：每次啟動用 `crypto/rand` 產生 32 bytes，僅透過 `w.Init()` 注入到頁面。比較用 `subtle.ConstantTimeCompare`，避免 timing side channel。已驗證未帶 token → 403。
4. **協定與方法白名單**：只允許 `http`/`https` 與 `GET`/`POST`；回應上限 64 MB。

另外：WebView2 使用者資料夾指向 `%LOCALAPPDATA%\AiCad\WebView2`，不寫在 EXE 旁邊。這讓 EXE 放在 Program Files 或唯讀隨身碟時仍能啟動。

**仍待補強**：API Key 目前存在前端 `settings`。`src/core/secrets.ts` 已把憑證與一般設定的邊界切開，Phase 2 應改接 Windows DPAPI，由 Go 側加解密後才算真正安全。

---

## 四、專案結構

```
aicad/
├── main.go                  宿主主流程（資產伺服器 + 橋接 + 視窗）
├── host_windows.go          Win32 MessageBox、版本字串
├── build.ps1                一鍵建置：npm build → 同步 web/ → go build
├── verify.ps1               實機啟動驗證
├── docs/
│   ├── 01-技術棧與開發藍圖.md
│   ├── 02-UIUX設計規範.md
│   └── 03-Phase1交付說明.md   ← 本文件
└── src/
    ├── core/                    平台無關的領域邏輯
    │   ├── types.ts             Artboard / MaskRegion / DrawingIntent
    │   ├── host.ts              宿主偵測 + 原生 transport 注入
    │   ├── settings.ts          設定持久化
    │   ├── secrets.ts           憑證邊界（預留 DPAPI）
    │   ├── net/transport.ts     唯一對外出口
    │   ├── prompt/builder.ts    圖面規格 → prompt
    │   ├── pipeline/orchestrator.ts   generate / inpaint 編排
    │   └── providers/           Provider 抽象 + 各家 adapter + registry
    ├── ui/                      shell / 畫布 / 意圖面板 / 設定浮層 / 圖示
    └── styles/tokens.css        設計 token 單一真實來源
```

**分層紀律**：`core/` 不 import React，`ui/` 不直接 import provider adapter。UI 只透過 orchestrator 說話，adapter 只透過 transport 出網。這兩條規則讓「換 AI 引擎」與「換宿主平台」都不會擴散修改。

---

## 五、建置與執行

```powershell
# 完整建置
powershell -ExecutionPolicy Bypass -File build.ps1

# 只重編 Go（前端沒改時）
powershell -ExecutionPolicy Bypass -File build.ps1 -SkipWeb

# 實機驗證
powershell -ExecutionPolicy Bypass -File verify.ps1

# 前端熱重載開發（此時 __AICAD_HOST__ 不存在，transport 自動退回 fetch）
npm run dev
```

同一份 adapter 程式碼在「瀏覽器開發」與「EXE 執行」兩種環境都能跑，差別只在 `installHostBridge()` 的回傳值。

**終端使用者需求**：Windows 10/11 x64 + WebView2 Runtime（Win11 內建；Win10 經 Windows Update 已幾乎全面覆蓋）。若缺少，啟動時會彈出可行動的錯誤對話框，而不是靜默失敗。

---

## 六、Phase 2 起的路線

依「解除阻塞的程度」排序，不是依難度：

**Phase 2 — 讓功能真的能跑**
1. 端到端實機驗證：填入真實 API Key → 產生圖面 → 框選 → 重繪。目前只驗證到型別層與宿主層，尚未打過真實 API。
2. 補完 adapter：Grok、Ollama、第三方聚合／中轉。`openaiCompatible.ts` 已參數化，多數情境只需在 registry 加設定，不需新程式碼。
3. 憑證改接 DPAPI（見上節）。

**Phase 3 — 精確標註（這才是「CAD」的關鍵）**
4. **向量標註疊層**。純靠擴散模型生成的尺寸數字必然不精確——這是模型本質，不是 prompt 能修的。正確解法是：AI 生成底圖，尺寸線與數值由**前端 SVG 疊層**渲染，數值來自使用者輸入的真實參數。標註因此永遠精確、永遠可編輯、可匯出為向量。
5. 圖層系統：底圖 / 標註 / 註記分層，各自可隱藏與鎖定。

**Phase 4 — 生產力細節**
6. 匯出 PNG / SVG / PDF（PDF 由 Go 側產生，避免前端引入重型依賴）。
7. 專案檔存讀（`.aicad`，JSON + 內嵌 base64 圖）。
8. 復原／重做堆疊。
9. 鍵盤快捷鍵全覆蓋 —— 專業工具的使用者用鍵盤，不用滑鼠選單。

**Phase 5 — 發佈**
10. 應用程式圖示與 EXE 中繼資料（`versioninfo` + `.syso`）。
11 . 程式碼簽章（避免 SmartScreen 警告）。
12. 自動更新檢查。

---

## 七、目前的已知限制

誠實列出，避免誤判專案成熟度：

- **尚未打過真實 API。** provider 層型別完整、編譯通過，但沒有任何一次成功的實機出圖。
- **尺寸標註尚未實作。** 目前 prompt 會要求模型畫標註，但如上所述這條路不可能精確；Phase 3 的向量疊層才是真解。
- **Inpainting 只通到型別層。** 畫布遮罩 → orchestrator → provider 的資料流已接好，但未實機驗證遮罩格式是否符合各家 API 要求（OpenAI 要 alpha 透明 PNG、SD WebUI 要黑白遮罩，兩者需要轉換）。
- **API Key 未加密儲存。**
- **僅 Windows。** Go + WebView2 是 Windows 專屬路線；跨平台需改用 webview 的其他後端，屬另一個決策。
