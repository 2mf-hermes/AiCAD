# AiCAD

AiCAD 是 Windows 免安裝的 AI 可編輯 3D 建模與 2D CAD 製圖程式。

[English](README.md) | **繁體中文** | [简体中文](README.zh-Hans.md)

## 徽章

[![Release](https://img.shields.io/github/v/release/2mf-hermes/AiCAD)](https://github.com/2mf-hermes/AiCAD/releases)
[![MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Windows](https://img.shields.io/badge/Windows-10%2F11%20x64-blue)

## 特色功能


- 先選 3D 或 2D，再輸入需求、加入參考檔案與選擇性精煉提示詞。
- AI 產生結構化特徵文件，由本機 OpenCascade WASM 建立實體；無效結果最多自動修復三輪。
- 支援參數與公式、選取特徵後局部 AI 修改、特徵抑制、復原與重做。
- 實體支援方體、圓柱、球體、矩形／圓形拉伸、布林、平移與全邊圓角／倒角。
- 向量支援直線、矩形、圓、圓弧、文字、圖層、移動與有上限的陣列；實體可投影為前／俯／右視圖，分離可見線、隱藏線及中心線。
- 匯出 STEP／STL／JSON、SVG／DXF、實際紙張尺寸圖紙與 1:1 切割 DXF。
- AI 可統一模型或分別設定精煉、3D、2D、參考圖辨識角色，沿用既有 Provider 與專案儲存。
- 保留舊生圖／CAD 工作區、Windows 圖示、單一實例及 GitHub 校驗更新。

**支援範圍：** 工程工作區提供上述操作；完整草圖約束求解、組合件、SubD、掃掠／旋轉／抽殼、DWG／IGES／Parasolid 與向量 PDF 尚未實作。ISO／JIS／ASME／CNS 選項記錄製圖資訊，不代表符合標準認證。製造前請核對尺寸。AI 需設定 Provider，提示詞與參考檔案會傳送至該供應商。

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


1. 選擇 **3D 模型** 或 **2D 圖紙**。
2. 在設定加入可用文字模型的 Provider，再選統一模型或工程角色分工。
3. 輸入需求與參考檔案，調整工程設定後生成；可先精煉提示詞。
4. 修改參數，或選取物件下達局部 AI 指令後儲存。既有影像專案由「舊圖面」開啟。
5. 實體可匯出 STEP／STL，投影後可匯出 SVG／DXF；切割 DXF 使用實際 1:1 座標。

範例：`建立 80 × 40 × 12 mm 板件，含兩個半徑 6 mm 的貫穿孔。`

預期結果：可編輯的特徵文件與本機計算的實體；具體特徵安排依所選模型而異。


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
powershell -ExecutionPolicy Bypass -File scripts\release.ps1 -Version 0.4.0
```

腳本建置 EXE、產生校驗碼並上傳附件。每次發佈使用新版本號。校驗碼可偵測損壞，但不取代程式碼簽章或 GitHub 帳號的可信度。

## 貢獻指南與授權

歡迎在 [Issues](https://github.com/2mf-hermes/AiCAD/issues) 提供重現步驟、預期與實際結果、OS 與 Provider 資訊。勿附 API 金鑰或私人專案。建立主題分支、補上迴歸測試，再向 `main` 提交 Pull Request；提交前執行前端測試、Windows 建置與 Go 測試。

請維持存檔相容性、Provider 路由、參考素材處理、變更狀態、單一實例與校驗碼驗證。

專案程式碼採 [MIT 授權](LICENSE)。相依套件保留各自授權；npm 清單見 [`dependency-licenses.json`](dependency-licenses.json)，Go 相依見 [`go.mod`](go.mod)。
