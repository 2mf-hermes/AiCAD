# AiCAD

AiCAD 是 Windows 免安裝應用程式，結合 AI 圖面生成與本機 2D CAD 編輯工作區。

[English](README.md) | **繁體中文** | [简体中文](README.zh-Hans.md)

## 徽章

[![Release](https://img.shields.io/github/v/release/2mf-hermes/AiCAD)](https://github.com/2mf-hermes/AiCAD/releases)
[![MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Windows](https://img.shields.io/badge/Windows-10%2F11%20x64-blue)

## 特色功能

- 依描述、尺寸、參考圖片與文字文件生成圖面影像。
- 草稿優先流程：文字模型先產生經安全處理的 SVG 幾何，協助生圖；草稿失敗時回到原本生成流程。
- 文字、視圖、生圖與局部重繪模型可分別選擇，依 Provider 能力提供支援。
- 標題欄與自訂欄位可由程式繪製、生圖模型產生，或以文字模型輔助後期疊加。
- 本機 CAD 工作區提供圖層、物件鎖點、尺寸標註、編輯命令、復原與專案儲存。
- 單一 EXE，內嵌前端與 Windows 圖示，限制單一實例。
- 使用 GitHub Releases 更新，安裝前強制驗證 SHA-256，保留本機清單與環境變數覆蓋。

**限制：** AI 輸出並非經驗證的工程圖；生成圖片不會自動轉成可編輯 CAD 圖元。使用前須人工檢查尺寸與幾何。AI 功能需要設定 Provider、連網，並可能產生 API 費用；提示與附件會傳送至所選 Provider。

## 安裝與環境需求

### 直接執行

從 [Releases](https://github.com/2mf-hermes/AiCAD/releases) 下載 `AiCad.exe` 與 `SHA256SUMS.txt`。需要 Windows 10/11 x64 與 [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)；若缺少 WebView2 請先安裝。執行 EXE 不需要 Node.js 或 Go。

```powershell
Get-FileHash .\AiCad.exe -Algorithm SHA256
# 與 SHA256SUMS.txt 比對後執行
.\AiCad.exe
```

### 原始碼建置

需要 Windows x64、Node.js 22 LTS、Go 1.23.5 或相容新版、PowerShell 5.1+；不需要 C 編譯器。

```powershell
git clone https://github.com/2mf-hermes/AiCAD.git
cd AiCAD
npm ci
powershell -ExecutionPolicy Bypass -File build.ps1
```

產出：`dist-exe\AiCad.exe`。建置會複製前端資產至 `web\` 供 Go 內嵌；全新下載的原始碼須先建置，再執行 Go 測試。

## 使用方式

1. 啟動 EXE，開啟 Provider 設定。
2. 設定端點、API 金鑰與支援的文字、視圖、生圖、局部重繪模型。
3. 選擇圖面類型、尺寸、線條風格與文字模式，視需要加入參考檔。
4. 生成並檢查結果，編輯本機 CAD 物件，儲存專案。

輸入範例：

```text
法蘭正視圖，中央內孔 40 mm，四個螺栓孔。
使用黑色工程線條與程式繪製的標題欄。
```

預期輸出：

```text
畫布顯示生成圖面影像與設定的標題欄。
幾何與標籤依模型而異，須人工檢查。
```

開發與驗證：

```powershell
npm run dev       # 前端預覽；桌面宿主功能須使用 EXE
npm test
npm run typecheck
npm run build
powershell -ExecutionPolicy Bypass -File build.ps1 -SkipWeb
go test ./...
```

### 更新與發佈

在「設定 → 更新」檢查新版。來源順序：明確設定的 `AICAD_UPDATE_FEED`；既有本機清單；官方 `https://api.github.com/repos/2mf-hermes/AiCAD/releases`。Stable 排除預發佈與草稿。Release 必須包含 `AiCad.exe`，以及有效的附件 SHA-256 digest 或 `SHA256SUMS.txt`。

維護者確認原始碼已審查並提交、GitHub CLI 已登入後，可執行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\release.ps1 -Version 0.2.0
```

腳本建置 EXE、產生校驗碼並上傳附件。每次發佈使用新版本號。校驗碼可偵測損壞，但不取代程式碼簽章或 GitHub 帳號的可信度。

## 貢獻指南與授權

歡迎在 [Issues](https://github.com/2mf-hermes/AiCAD/issues) 提供重現步驟、預期與實際結果、OS 與 Provider 資訊。勿附 API 金鑰或私人專案。建立主題分支、補上迴歸測試，再向 `main` 提交 Pull Request；提交前執行前端測試、Windows 建置與 Go 測試。

請維持存檔相容性、Provider 路由、參考素材處理、變更狀態、單一實例與校驗碼驗證。

專案程式碼採 [MIT 授權](LICENSE)。相依套件保留各自授權；npm 清單見 [`dependency-licenses.json`](dependency-licenses.json)，Go 相依見 [`go.mod`](go.mod)。
