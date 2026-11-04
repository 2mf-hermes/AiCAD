$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
$process = Start-Process -FilePath '.\dist-exe\AiCad.exe' -PassThru
try {
    for ($index = 0; $index -lt 40 -and $process.MainWindowHandle -eq 0; $index++) {
        Start-Sleep -Milliseconds 250
        $process.Refresh()
    }
    if ($process.MainWindowHandle -eq 0) { throw 'AiCad main window did not appear' }
    powershell -ExecutionPolicy Bypass -File '.\scripts\verify-window-icon.ps1' -ProcessId $process.Id
    if ($LASTEXITCODE -ne 0) { throw 'Runtime window icon verification failed' }
} finally {
    if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force }
}
