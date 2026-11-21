# AiCAD 幾何改版實作計畫

使用者已指示維持名稱並繼續；按依賴順序在現有儲存與 Go host 上實作。

1. `src/core/geometry/`：文件 schema、安全參數運算、局部替換保護、Replicad Worker 核心、單元與真實核心測試。產出有 ID 的 mesh 與 B-Rep STEP。
2. `src/core/settings.ts` 與 `src/ui/GeometryModels.tsx`：統一／分工角色選擇，延用 Provider、密鑰及模型查詢；保存時保留舊欄位。
3. `src/core/geometry/ai.ts`：精煉、建模、全域／局部修改、三次修復、取消與錯誤提示。所有輸出通過 schema 及核心檢查再提交。
4. `src/ui/EngineeringWorkspace.tsx`、`GeometryViewport.tsx`：模式優先流程、參考檔、設定、特徵樹、參數、歷程、選取與 AI 指令；保留舊工作區入口。2D 接上現有 CAD 實體工具並提供向量輸出。
5. 擴充 `projects.ts` 保存幾何與歷程，沿用 native backend；驗證舊專案不被過濾、新專案重開不損失幾何。
6. 核對格式與能力，測試 TypeScript、Vitest、真實 WASM、瀏覽器及正式封裝。所有 src 正規化 CRLF，版本進到 0.4.0。
7. 更新三語 README 與授權說明；提交並推送來源後依原腳本打包到 dist-exe/AiCad.exe、檢查圖示及版本後發布。不得將未測過的 live AI 或未完成能力宣稱完成。

自由曲面、完整裝配、專有格式、協作與雲端服務依設計規格分項追蹤；任何未完成項目在交付時列明，不隱藏為成功選項。
