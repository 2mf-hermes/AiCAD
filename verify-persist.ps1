# =============================================================================
#  持久化實測：跨行程確認「設定不會每次開啟就被重置」
#  ---------------------------------------------------------------------------
#  Go 單元測試已驗證 set → get 往返，但那是同一行程內。這裡做的是真正的
#  跨行程驗證：寫入一個可辨識的值 → 啟動真實 EXE → 關閉 → 讀回檔案。
#  若啟動流程有任何「以預設值覆寫」的行為，這一步會抓到。
# =============================================================================

Set-Location -Path $PSScriptRoot
$exe = Join-Path $PSScriptRoot "dist-exe\AiCad.exe"
$store = Join-Path $env:APPDATA "AiCad\settings.json"
if (-not (Test-Path $exe)) { throw "找不到 $exe" }
if (-not (Test-Path $store)) { throw "找不到 $store（請先啟動一次 App）" }

# 備份，測試結束還原
$backup = Get-Content $store -Raw

try {
    # 1) 寫入一組刻意「非預設」的值
    $obj = $backup | ConvertFrom-Json
    $obj.language = "ko"
    $obj.canvas.width = 2048
    $obj.updates.channel = "none"
    $obj.updates.autoCheck = $false
    $imageProvider = $obj.providers | Where-Object { $_.enabled -and $_.capabilities.imageGenerate } | Select-Object -First 1
    if (-not $imageProvider) { throw "找不到已啟用且支援 imageGenerate 的 provider，無法執行持久化測試" }
    $expectedImageProvider = $imageProvider.id
    $obj.activeImageProvider = $expectedImageProvider
    $marker = "PERSIST-TEST-" + (Get-Date -Format "HHmmss")
    $obj.updates.lastCheckedAt = $marker

    # 刻意用「無 BOM」的 UTF-8 寫入 —— PowerShell 5 的 Set-Content -Encoding UTF8
    # 會加 BOM，而 BOM 會讓 JSON.parse 拋錯、觸發退回預設值，那會把這支測試
    # 變成在測 BOM 而不是在測持久化。BOM 本身另有 Go 單元測試涵蓋。
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($store, ($obj | ConvertTo-Json -Depth 10), $utf8NoBom)
    Write-Host ">>> 已寫入測試值 (language=ko, width=2048, channel=none, marker=$marker)"

    # 2) 啟動真實 EXE，讓它完整跑一輪載入流程
    Write-Host ">>> 啟動 AiCad.exe 並等待前端讀取設定"
    $proc = Start-Process -FilePath $exe -PassThru
    Start-Sleep -Seconds 8
    if ($proc.HasExited) { throw "程序意外結束，ExitCode=$($proc.ExitCode)" }
    Write-Host "    程序存活 (PID $($proc.Id))"

    # 3) 關閉
    Stop-Process -Id $proc.Id -Force
    Start-Sleep -Seconds 2
    Write-Host ">>> 已關閉"

    # 4) 讀回並逐項比對
    $after = Get-Content $store -Raw | ConvertFrom-Json
    $checks = @(
        @{ n = "language";            got = $after.language;            want = "ko" }
        @{ n = "canvas.width";        got = $after.canvas.width;        want = 2048 }
        @{ n = "updates.channel";     got = $after.updates.channel;     want = "none" }
        @{ n = "updates.autoCheck";   got = $after.updates.autoCheck;   want = $false }
        @{ n = "activeImageProvider"; got = $after.activeImageProvider; want = $expectedImageProvider }
        @{ n = "updates.lastCheckedAt"; got = $after.updates.lastCheckedAt; want = $marker }
    )
    $fail = 0
    foreach ($c in $checks) {
        if ("$($c.got)" -eq "$($c.want)") {
            Write-Host ("  OK   {0,-22} = {1}" -f $c.n, $c.got)
        } else {
            Write-Host ("  FAIL {0,-22} 預期 {1} / 實得 {2}" -f $c.n, $c.want, $c.got)
            $fail++
        }
    }

    if ($fail -eq 0) {
        Write-Host "`n結果：設定在關閉並重新啟動後完整保留（$($checks.Count)/$($checks.Count) 項通過）"
    } else {
        Write-Host "`n結果：$fail 項被重置  <-- 失敗"
    }
}
finally {
    $utf8NoBomRestore = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($store, $backup, $utf8NoBomRestore)
    Write-Host ">>> 已還原原始設定檔"
}
