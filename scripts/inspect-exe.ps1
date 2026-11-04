$ErrorActionPreference = 'Stop'
$path = (Resolve-Path (Join-Path $PSScriptRoot '..\dist-exe\AiCad.exe')).Path
$file = Get-Item $path
Add-Type -AssemblyName System.Drawing
$icon = [System.Drawing.Icon]::ExtractAssociatedIcon($path)
[pscustomobject]@{
  Path = $file.FullName
  Length = $file.Length
  LengthMB = [math]::Round($file.Length / 1MB, 2)
  LastWriteTime = $file.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss zzz')
  FileVersion = $file.VersionInfo.FileVersion
  ProductVersion = $file.VersionInfo.ProductVersion
  SHA256 = (Get-FileHash $path -Algorithm SHA256).Hash
  Icon = if ($icon) { "$($icon.Width)x$($icon.Height)" } else { 'missing' }
} | Format-List
