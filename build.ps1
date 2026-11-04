# =============================================================================
#  Ai Cad — 單一 EXE 建置腳本
# -----------------------------------------------------------------------------
#  流程：前端建置 → 把 dist 複製成 web/（go:embed 的來源）→ go build
#  產出：dist-exe\AiCad.exe  單一檔案，免安裝，雙擊即執行
#
#  用法：  powershell -ExecutionPolicy Bypass -File build.ps1
#          powershell -ExecutionPolicy Bypass -File build.ps1 -SkipWeb
# =============================================================================

param(
    [switch]$SkipWeb,
    [string]$Version = "0.1.0"
)

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

function Step($msg) { Write-Host "`n>>> $msg" -ForegroundColor Cyan }

# --- 1. 前端建置 -------------------------------------------------------------
if (-not $SkipWeb) {
    Step "建置前端 (tsc + vite)"
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "前端建置失敗" }
}

if (-not (Test-Path "dist\index.html")) {
    throw "找不到 dist\index.html — 請先執行 npm run build"
}

# --- 2. 準備 go:embed 來源 ---------------------------------------------------
# go:embed 只能讀取套件目錄下的路徑，所以把 dist 同步到 web/。
Step "同步前端資產到 web\ (go:embed 來源)"
if (Test-Path "web") { Remove-Item "web" -Recurse -Force }
Copy-Item "dist" "web" -Recurse

# --- 3. 編譯單一 EXE ---------------------------------------------------------
Step "編譯 Windows 單一執行檔"
New-Item -ItemType Directory -Force -Path "dist-exe" | Out-Null

$env:GOOS = "windows"
$env:GOARCH = "amd64"
# 純 Go 綁定 (jchv/go-webview2) 不需要 cgo，也就不需要 Windows SDK 標頭檔。
# 這讓建置環境只需要 Go 本身，產物是完全靜態連結的單一 EXE。
$env:CGO_ENABLED = "0"

# -H windowsgui : 不要彈出黑色主控台視窗
# -s -w         : 去除符號表與 DWARF，體積可少三成
$ldflags = "-H windowsgui -s -w -X main.version=$Version"

go build -trimpath -ldflags $ldflags -o "dist-exe\AiCad.exe" .
if ($LASTEXITCODE -ne 0) { throw "Go 編譯失敗" }

# --- 4. 回報 -----------------------------------------------------------------
$exe = Get-Item "dist-exe\AiCad.exe"
$mb = [math]::Round($exe.Length / 1MB, 2)

Write-Host "`n=============================================" -ForegroundColor Green
Write-Host " 建置完成" -ForegroundColor Green
Write-Host " 路徑： $($exe.FullName)"
Write-Host " 體積： $mb MB"
Write-Host " 版本： $Version"
Write-Host " 相依： 僅需 WebView2 Runtime（Win10/11 已內建）"
Write-Host "=============================================" -ForegroundColor Green
