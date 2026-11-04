param([Parameter(Mandatory=$true)][int]$ProcessId)

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class AiCadIconProbe {
    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")]
    public static extern IntPtr GetClassLongPtr(IntPtr hWnd, int nIndex);
}
"@

$p = Get-Process -Id $ProcessId -ErrorAction Stop
$p.Refresh()
$hwnd = $p.MainWindowHandle
if ($hwnd -eq [IntPtr]::Zero) { throw "Ai Cad main window was not found" }

$WM_GETICON = 0x007F
$ICON_SMALL = [IntPtr]0
$ICON_BIG = [IntPtr]1
$GCLP_HICON = -14
$GCLP_HICONSM = -34
$small = [AiCadIconProbe]::SendMessage($hwnd, $WM_GETICON, $ICON_SMALL, [IntPtr]0)
$big = [AiCadIconProbe]::SendMessage($hwnd, $WM_GETICON, $ICON_BIG, [IntPtr]0)
$classSmall = [AiCadIconProbe]::GetClassLongPtr($hwnd, $GCLP_HICONSM)
$classBig = [AiCadIconProbe]::GetClassLongPtr($hwnd, $GCLP_HICON)

[pscustomobject]@{
    ProcessId = $ProcessId
    WindowHandle = $hwnd
    SmallIconHandle = $small
    BigIconHandle = $big
    ClassSmallIconHandle = $classSmall
    ClassBigIconHandle = $classBig
    Passed = ($small -ne [IntPtr]::Zero -and $big -ne [IntPtr]::Zero -and $classSmall -ne [IntPtr]::Zero -and $classBig -ne [IntPtr]::Zero)
} | Format-List

if ($small -eq [IntPtr]::Zero -or $big -eq [IntPtr]::Zero -or $classSmall -eq [IntPtr]::Zero -or $classBig -eq [IntPtr]::Zero) { exit 1 }
