# Phase 3 驗收說明

驗收重點：精確尺寸資料由應用程式向量標註層呈現，不再要求生成式模型自行繪製可信的尺寸數值。

## 本輪完成

1. DrawingCanvas 的尺寸標註由 HTML 底部清單升級為獨立 SVG 向量層。
2. SVG 標註包含尺寸線、延伸線、雙向實心箭頭與使用者輸入的精確標籤／數值。
3. 標註資料仍直接來自 `DrawingIntent.measurements`，不由 AI 模型臆測。
4. 向量層與 raster AI 底圖分離，因此縮放時線條與文字仍由瀏覽器向量渲染。
5. OpenAI-compatible inpainting 已存在黑白遮罩轉 alpha mask 的轉換流程；SD WebUI 繼續使用黑底白選區遮罩。
6. Ollama 已透過 OpenAI-compatible adapter 註冊，預設端點為 `http://127.0.0.1:11434/v1`，用於文字精煉。

## 尚需外部條件才能驗收

真實雲端 AI API 的端到端生成與重繪仍需有效 API 憑證。本專案不以模擬成功取代這項驗收。

## 驗收命令

- `npm test`
- `npm run build`
- `go test ./...`
- `powershell -ExecutionPolicy Bypass -File build.ps1`

完成上述驗證後，交付產物為 `dist-exe/AiCad.exe`。
