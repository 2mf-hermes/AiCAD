# Phase 2 六項需求驗收報告

驗證日期：2026-08-31
產物：`aicad/dist-exe/AiCad.exe`（6.7 MB，單一檔案，僅需 Win10/11 內建的 WebView2 Runtime）

---

## 結論一覽

| # | 需求 | 狀態 | 驗證方式 |
|---|------|------|----------|
| 1 | 多國語言（繁中／簡中／英／日／韓） | 完成 | `tsc` 型別強制字典齊備 |
| 2 | 設定必須被保存 | 完成（本輪修掉最後一個缺陷） | 跨行程實測 6/6 通過 |
| 3 | 設定分類 | 完成 | 四類分頁已實作 |
| 4 | 檢查更新 + 自動安裝 | 完成 | 12 項 Go 測試通過 |
| 5 | Icon（EXE 小圖示） | 完成 | 資源探測：7 種尺寸 |
| 6 | 所有元件套用設計風格 | 完成 | 全專案無原生表單元件 |

未完成的項目屬 Phase 3 範圍，列於文末。

---

## 1. 多國語言

五種語言：`zh-Hant`（繁體，參考語言）、`zh-Hans`、`en`、`ja`、`ko`，位於 `src/i18n/dict/`。

設計要點：`zh-Hant.ts` 導出型別 `Dict`，其餘語言以 `import type { Dict }` 實作。任何語言漏一個字串，`tsc --noEmit` 就會失敗，不可能靜默留下未翻譯的介面。這比人工核對字典可靠。

翻譯採各地製圖術語而非機械直譯 —— 日文用 JIS 的「第一角法」、韓文用 KS 的「제1각법／표제란／기하공차」、英文依 ISO/ASME 慣例。製圖工具用錯術語，專業使用者立刻看得出來。

## 2. 設定保存

### 原始缺陷（架構性，已修）

前端原本用 `localStorage`。但宿主每次啟動綁 `127.0.0.1` 的**隨機埠**，而 `localStorage` 以 origin（含 port）隔離 —— 埠一變就是一份全新的空儲存區。這才是「每次開啟都被重置」的真正原因，不是前端邏輯寫錯。

修正方向刻意**不改成固定埠**（隨機埠是安全設計，避免其他本機程式預測端點），而是改由 Go 宿主寫入 `%APPDATA%\AiCad\settings.json`。寫入採「寫暫存檔再 rename」的原子替換，避免斷電留下半截 JSON——那等於又回到空設定。

### 本輪抓到並修掉的第二個缺陷

跨行程實測第一次跑，6 項全部被重置。追查後發現：**設定檔開頭有 UTF-8 BOM（`EF BB BF`）**，`JSON.parse` 遇到 BOM 直接拋錯，前端因此退回預設值並寫回檔案——症狀與原始 bug 一模一樣，但成因完全不同。

BOM 的來源是 Windows 生態的常態：記事本另存、PowerShell 的 `Set-Content -Encoding UTF8` 都會加。使用者手改設定檔就會踩到。修正在 `store_windows.go` 的 `readIfExists()` 讀取時 `bytes.TrimPrefix` 去除 BOM，三個 byte 的檢查換掉整類難以察覺的資料遺失。

### 驗證

`verify-persist.ps1` 做真正的跨行程測試：寫入非預設值 → 啟動真實 EXE 完整跑一輪載入 → 關閉 → 讀回檔案比對。

```
OK   language               = ko
OK   canvas.width           = 2048
OK   updates.channel        = none
OK   updates.autoCheck      = False
OK   activeImageProvider    = sd-webui
OK   updates.lastCheckedAt  = PERSIST-TEST-185739

結果：設定在關閉並重新啟動後完整保留（6/6 項通過）
```

另有 `bridge_test.go` 的 `TestSettingsTolerateUTF8BOM` 作為回歸測試，防止這個 bug 再次溜回來。

API 金鑰另存 `%APPDATA%\AiCad\secrets.bin`，以 Windows DPAPI 加密（綁定使用者帳戶，複製到別台機器解不開）。測試 `TestSecretRoundTripEncrypted` 會檢查落地檔案不含明文標記。金鑰與偏好設定分兩個檔，因為兩者的風險等級與生命週期完全不同。

## 3. 設定分類

浮層 Sheet 內四類分頁導覽：

- **一般** — 語言、主題、畫布尺寸
- **AI 模型** — 七個 provider 的啟用／端點／模型／金鑰
- **更新** — 自動檢查、更新通道、立即檢查與安裝
- **關於** — 版本、儲存位置、相依說明

分類導覽沿用既有的 `provlist` 骨架，選中態用 `--accent-wash` + 1px 內描邊，ARIA 用 `aria-selected`。沒有做成多頁式視窗——設定不該把使用者帶離工作畫面。

## 4. 檢查更新與自動安裝

`update_windows.go` 實作完整流程，不是丟一個下載連結：

```
檢查版本 → 下載 → SHA-256 驗證 → 寫入暫存
  → 舊 EXE 改名 AiCad.exe.old → 啟動新 EXE → 退出
  → 下次啟動時於 main() 開頭清除 .old
```

安全設計：

- **來源白名單** `allowedUpdateHosts`：`api.github.com`、`github.com`、`codeload.github.com`、`objects.githubusercontent.com`、`release-assets.githubusercontent.com`。避免任意 URL 變成程式碼下載器。
- **強制 SHA-256**，沒有「跳過驗證」的路徑。缺雜湊直接拒絕下載。
- **後綴混淆防護**：`github.com.evil.example.com` 會被擋。
- 所有更新端點都經 `requireToken`。

12 項 Go 測試涵蓋這些行為，包含版本比較規則與前端 `update.ts` 一致（否則會出現「UI 說有新版、宿主說沒有」的矛盾）：

```
ok  aicad  1.606s
```

`channel=none` 時安靜回「已是最新」而非報錯 —— 使用者主動關閉更新，不該看到紅字。

## 5. Icon

`verify-icon.ps1` 直接讀 EXE 的 `RT_GROUP_ICON` 資源：

```
圖示            : 有 (32x32)
圖示資源        : 群組 1 個 / 影像 7 張 / 尺寸: 256x256@32, 128x128@32,
                  64x64@32, 48x48@32, 32x32@32, 24x24@32, 16x16@32
產品名稱        : 'Ai Cad'
檔案說明        : 'Ai Cad - AI 專業圖面生成與編輯工具'
檔案版本        : '0.1.0'
```

七種尺寸都是**獨立繪製的實體影像**，不是讓 Windows 拿 256×256 縮小。這是小圖示清晰與模糊的差別：檔案總管的詳細資料檢視用 16×16、工作列用 24×24、桌面用 48×48，各自都有對應原圖。

## 6. 元件風格

全專案 grep 過原生表單元件（`<select>`、`<input type=checkbox|range|color>`、`<progress>`、`<details>`），**零命中**。唯一提及 `<select>` 的地方是 `Select.tsx` 的註解，說明為何必須自製：原生 `<select>` 的彈出清單由作業系統繪製，CSS 完全碰不到，只要用了就一定會在畫面上留一塊 Windows 原生樣式。

自製 `Select`（301 行）含鍵盤導覽、ARIA、focus 管理。互動狀態一律用 1px 邊框／底色位移，刻意避免粗重陰影與漸層 —— 這是「去 AI 味」的具體落點，不是抽象美學宣言。圖示全自繪（20×20 網格、1.5px 線寬、圓角端點），未引入任何第三方 UI 套件。

---

## 完整驗證鏈（本輪實際執行）

| 步驟 | 結果 |
|------|------|
| `npm run build`（`tsc --noEmit && vite build`） | exit 0，60 modules |
| `go vet ./...` | exit 0 |
| `go test ./...` | ok，1.606s |
| `build.ps1` | 6.7 MB 單一 EXE |
| `verify.ps1` | 視窗標題 `Ai Cad`、資產 HTTP 200、無 token 橋接回 403 |
| `verify-icon.ps1` | 7 種尺寸圖示 + 版本資源 |
| `verify-persist.ps1` | 6/6 持久化通過 |

---

## 尚未完成（Phase 3 範圍，與這六點無關）

誠實列出，避免誤以為整個產品已完備：

1. **Provider 從未打過真實 API**。七個 adapter 型別完整、通過編譯，但沒有實機出圖 —— 需要真實 API 金鑰才能驗證。這是目前最大的未知。
2. **Inpainting 遮罩格式轉換層缺失**。OpenAI 要 alpha 透明 PNG、SD WebUI 要黑白遮罩，兩者不相容，尚無轉換層。框選 UI 已可用，端到端未通。
3. **精確尺寸標註**。擴散模型本質上做不到 —— 靠 prompt 要求「標註 25.4mm」不會得到精確結果。正解是 AI 生成底圖 + 前端 SVG 疊層渲染尺寸線與數值，排入 Phase 3。
4. **Ollama adapter 未寫**。Grok／聚合／中轉可用 `openaiCompatible.ts` 參數化補齊。
5. **UI 視覺未經人眼確認**。工具環境拒絕抓取 loopback 頁面，樣式正確性目前僅由程式碼與 CSS 推論，未看過實際渲染畫面。建議您雙擊 EXE 親自確認一次。
