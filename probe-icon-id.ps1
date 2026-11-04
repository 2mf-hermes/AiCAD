# =============================================================================
#  列出 EXE 內 RT_GROUP_ICON 的「資源 ID」
#  ---------------------------------------------------------------------------
#  為什麼需要這支：go-webview2 在 IconId == 0 時會載入 IDI_APPLICATION（32512，
#  Windows 內建的通用視窗圖示），而不是我們嵌進 EXE 的圖示 —— 這正是「檔案
#  總管看得到圖示、但視窗左上角是通用圖示」的成因。要修就得把真正的資源 ID
#  傳給 IconId，所以先把 ID 查出來。
# =============================================================================

Set-Location -Path $PSScriptRoot
$exe = Join-Path $PSScriptRoot "dist-exe\AiCad.exe"
if (-not (Test-Path $exe)) { throw "找不到 $exe" }

$code = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public class IconIds {
    [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
    static extern IntPtr LoadLibraryEx(string f, IntPtr h, uint flags);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool EnumResourceNames(IntPtr h, IntPtr type, EnumResNameProc cb, IntPtr p);

    delegate bool EnumResNameProc(IntPtr h, IntPtr type, IntPtr name, IntPtr p);

    const uint LOAD_LIBRARY_AS_DATAFILE = 0x00000002;
    static readonly IntPtr RT_ICON = (IntPtr)3;
    static readonly IntPtr RT_GROUP_ICON = (IntPtr)14;

    static string Describe(IntPtr name) {
        // 高位為 0 代表這是整數 ID；否則是字串名稱的指標。
        long v = name.ToInt64();
        if (v >> 16 == 0) return "#" + v.ToString();
        return "\"" + Marshal.PtrToStringUni(name) + "\"";
    }

    public static string List(string path) {
        IntPtr h = LoadLibraryEx(path, IntPtr.Zero, LOAD_LIBRARY_AS_DATAFILE);
        if (h == IntPtr.Zero) return "無法載入模組";

        var groups = new List<string>();
        EnumResourceNames(h, RT_GROUP_ICON, (a,b,name,c) => { groups.Add(Describe(name)); return true; }, IntPtr.Zero);

        var icons = new List<string>();
        EnumResourceNames(h, RT_ICON, (a,b,name,c) => { icons.Add(Describe(name)); return true; }, IntPtr.Zero);

        return "RT_GROUP_ICON: " + string.Join(", ", groups.ToArray())
             + "\nRT_ICON:       " + string.Join(", ", icons.ToArray());
    }
}
'@
Add-Type -TypeDefinition $code | Out-Null
Write-Host ([IconIds]::List($exe))
