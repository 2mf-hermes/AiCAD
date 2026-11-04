# =============================================================================
#  啟動驗證：確認 AiCad.exe 能雙擊執行、視窗建立成功、資產伺服器正常供應
# =============================================================================

$ErrorActionPreference = "Continue"
Set-Location -Path $PSScriptRoot

$exe = Join-Path $PSScriptRoot "dist-exe\AiCad.exe"
if (-not (Test-Path $exe)) { throw "找不到 $exe" }

Write-Host ">>> 啟動 $exe"
$proc = Start-Process -FilePath $exe -PassThru
Start-Sleep -Seconds 6

$alive = -not $proc.HasExited
Write-Host "程序存活      : $alive  (PID $($proc.Id))"

if ($alive) {
    $p = Get-Process -Id $proc.Id
    Write-Host "主視窗標題    : '$($p.MainWindowTitle)'"
    Write-Host "記憶體 (MB)   : $([math]::Round($p.WorkingSet64 / 1MB, 1))"

    # 找出這個程序監聽的 loopback 埠，直接打資產伺服器確認 embed 供應正常
    $conns = Get-NetTCPConnection -State Listen -OwningProcess $proc.Id -ErrorAction SilentlyContinue
    foreach ($c in $conns) {
        Write-Host "監聽          : $($c.LocalAddress):$($c.LocalPort)"
        try {
            $r = Invoke-WebRequest -Uri "http://127.0.0.1:$($c.LocalPort)/index.html" -UseBasicParsing -TimeoutSec 5
            Write-Host "  /index.html : HTTP $($r.StatusCode), $($r.RawContentLength) bytes"
            if ($r.Content -match 'src="([^"]*index-[^"]*\.js)"') {
                $js = $Matches[1] -replace '^\./',''
                $r2 = Invoke-WebRequest -Uri "http://127.0.0.1:$($c.LocalPort)/$js" -UseBasicParsing -TimeoutSec 5
                Write-Host "  $js : HTTP $($r2.StatusCode), $($r2.RawContentLength) bytes"
            }
            # 未帶 token 應被拒（403）
            try {
                Invoke-WebRequest -Uri "http://127.0.0.1:$($c.LocalPort)/bridge/http" -Method POST -Body '{}' -UseBasicParsing -TimeoutSec 5 | Out-Null
                Write-Host "  bridge 無 token : 未被拒絕  <-- 安全問題"
            } catch {
                Write-Host "  bridge 無 token : 已拒絕 ($($_.Exception.Response.StatusCode.value__))"
            }
        } catch {
            Write-Host "  請求失敗      : $($_.Exception.Message)"
        }
    }

    Write-Host ">>> 關閉程序"
    Stop-Process -Id $proc.Id -Force
} else {
    Write-Host "結束代碼      : $($proc.ExitCode)  <-- 啟動失敗"
}
