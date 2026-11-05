# =============================================================================
#  Ai Cad — 發佈腳本（建立 GitHub Release）
# -----------------------------------------------------------------------------
#  為什麼要有一支打包＋發佈的腳本：
#  更新程序現在以 GitHub Release 為來源，而它讀的是「附件」——
#  一個 AiCad.exe，以及一份 SHA256SUMS.txt。附件名稱與校驗碼格式只要有一個
#  不一致，使用者端的更新就會停在「找不到校驗碼」而無法自動更新。
#  與其靠人工記得，不如把整套流程寫成一支可重複執行的腳本：
#
#     1. 以指定版本號重新建置 dist-exe\AiCad.exe
#     2. 計算 SHA-256，產生 SHA256SUMS.txt（sha256sum 標準格式）
#     3. 以同一份檔案建立 GitHub Release（tag = v<版本>）
#
#  用法：
#      powershell -ExecutionPolicy Bypass -File scripts\release.ps1 -Version 0.3.0
#      powershell -ExecutionPolicy Bypass -File scripts\release.ps1 -Version 0.3.0 -Draft
#      powershell -ExecutionPolicy Bypass -File scripts\release.ps1 -Version 0.3.0 -Prerelease
#      powershell -ExecutionPolicy Bypass -File scripts\release.ps1 -Version 0.3.0 -NotesFile notes.md
#
#   -NotesFile: read release notes from a UTF-8 file. Prefer this when the notes
#   contain CJK text: it avoids command-line quoting and encoding problems.
#
#  前置：已安裝 gh 並完成 gh auth login；建置環境需 Node.js 與 Go。
# =============================================================================

param(
    [Parameter(Mandatory = $true)][string]$Version,
    [switch]$Draft,
    [switch]$Prerelease,
    [switch]$SkipBuild,
    [string]$Notes = "",
    [string]$NotesFile = ""
)

$ErrorActionPreference = "Stop"
Set-Location -Path (Join-Path $PSScriptRoot "..")

function Step($msg) { Write-Host "`n>>> $msg" -ForegroundColor Cyan }

# 版本號一律以「v」開頭的 tag；_EXE 內嵌的版本與 tag 必須一致，否則使用者端會
# 出現「明明有新版本卻說已是最新」的矛盾。
$tag = if ($Version.StartsWith("v")) { $Version } else { "v$Version" }
$clean = $tag.TrimStart("v", "V")

if ($NotesFile) {
    if (-not (Test-Path $NotesFile)) { throw "notes file not found: $NotesFile" }
    $Notes = [System.IO.File]::ReadAllText($NotesFile, [System.Text.Encoding]::UTF8)
    if (-not $Notes.Trim()) { throw "notes file is empty: $NotesFile" }
}
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    throw "找不到 gh CLI。請先安裝並執行 gh auth login。"
}

# --- 1. 建置 ----------------------------------------------------------------
if (-not $SkipBuild) {
    Step "建置 $clean（前端 + Go，版本內嵌為 $clean）"
    & (Join-Path $PSScriptRoot "..\build.ps1") -Version $clean
    if ($LASTEXITCODE -ne 0) { throw "建置失敗" }
}

$exePath = Join-Path (Get-Location) "dist-exe\AiCad.exe"
if (-not (Test-Path $exePath)) { throw "找不到 $exePath" }

# --- 2. 校驗碼 --------------------------------------------------------------
# 格式刻意與 sha256sum 相同（小寫十六進位、兩個空白、檔名），
# 這樣 Linux／macOS 使用者也能直接 `sha256sum -c SHA256SUMS.txt` 驗證。
Step "計算 SHA-256 並產生 SHA256SUMS.txt"
$hash = (Get-FileHash -Path $exePath -Algorithm SHA256).Hash.ToLower()
$sumPath = Join-Path (Get-Location) "dist-exe\SHA256SUMS.txt"
"$hash  AiCad.exe" | Set-Content -Path $sumPath -Encoding ascii -NoNewline:$false
Write-Host "  SHA-256：$hash"

$exe = Get-Item $exePath
Write-Host "  體積：  $([math]::Round($exe.Length / 1MB, 2)) MB"

# --- 3. 發佈 ----------------------------------------------------------------
Step "建立 GitHub Release $tag"
if (-not $Notes) {
    $Notes = "Ai Cad $clean`n`n發佈附件：AiCad.exe（單一檔案、免安裝）與 SHA256SUMS.txt。"
}

$args = @(
    "release", "create", $tag,
    "--title", "Ai Cad $clean",
    "--notes", $Notes,
    $exePath,
    $sumPath
)
if ($Draft)      { $args += "--draft" }
if ($Prerelease) { $args += "--prerelease" }

& gh @args
if ($LASTEXITCODE -ne 0) { throw "建立 Release 失敗" }

# --- 4. 回報 ----------------------------------------------------------------
# 直接印出更新程序會打的那支 API，方便一眼確認附件真的上去了。
Step "完成"
Write-Host "  Release：$(gh release view $tag --json url --jq .url)"
Write-Host "  更新來源：https://api.github.com/repos/2mf-hermes/AiCAD/releases"
Write-Host "  使用者端會在下次啟動檢查更新時看到 $clean。"
