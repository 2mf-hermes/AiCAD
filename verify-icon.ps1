# =============================================================================
#  Icon 與版本資源驗證：確認 EXE 真的帶了圖示與版本資訊
#  （第 5 點「exe 等小圖都要顯示」的客觀證據）
# =============================================================================

Set-Location -Path $PSScriptRoot
$exe = Join-Path $PSScriptRoot "dist-exe\AiCad.exe"
if (-not (Test-Path $exe)) { throw "找不到 $exe" }

Add-Type -AssemblyName System.Drawing

# 1) Shell 取得的關聯圖示 —— 這是檔案總管顯示小圖時走的同一條路
$ico = [System.Drawing.Icon]::ExtractAssociatedIcon($exe)
if ($null -eq $ico) {
    Write-Host "圖示            : 無  <-- 失敗"
} else {
    Write-Host "圖示            : 有 ($($ico.Width)x$($ico.Height))"
}

# 2) 列出 RT_GROUP_ICON 內含的所有尺寸。小尺寸要清晰就必須真的有 16/24/32 這幾張，
#    否則 Windows 會拿大圖縮小，結果就是模糊。
$code = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public class IconProbe {
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern IntPtr LoadLibraryEx(string f, IntPtr h, uint flags);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool EnumResourceNames(IntPtr h, IntPtr type, EnumResNameProc cb, IntPtr p);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern IntPtr FindResource(IntPtr h, IntPtr name, IntPtr type);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern IntPtr LoadResource(IntPtr h, IntPtr res);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern IntPtr LockResource(IntPtr data);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern uint SizeofResource(IntPtr h, IntPtr res);

    delegate bool EnumResNameProc(IntPtr h, IntPtr type, IntPtr name, IntPtr p);

    const uint LOAD_LIBRARY_AS_DATAFILE = 0x00000002;
    static readonly IntPtr RT_ICON = (IntPtr)3;
    static readonly IntPtr RT_GROUP_ICON = (IntPtr)14;

    public static string Probe(string path) {
        IntPtr h = LoadLibraryEx(path, IntPtr.Zero, LOAD_LIBRARY_AS_DATAFILE);
        if (h == IntPtr.Zero) return "無法載入模組";

        var groups = new List<IntPtr>();
        EnumResourceNames(h, RT_GROUP_ICON, (a,b,name,c) => { groups.Add(name); return true; }, IntPtr.Zero);
        if (groups.Count == 0) return "沒有 RT_GROUP_ICON";

        var sizes = new List<string>();
        IntPtr res = FindResource(h, groups[0], RT_GROUP_ICON);
        IntPtr data = LockResource(LoadResource(h, res));
        int count = Marshal.ReadInt16(data, 4);
        for (int i = 0; i < count; i++) {
            int off = 6 + i * 14;
            int w = Marshal.ReadByte(data, off);
            int ht = Marshal.ReadByte(data, off + 1);
            int bpp = Marshal.ReadInt16(data, off + 6);
            sizes.Add(string.Format("{0}x{1}@{2}", w == 0 ? 256 : w, ht == 0 ? 256 : ht, bpp));
        }

        int iconCount = 0;
        EnumResourceNames(h, RT_ICON, (a,b,name,c) => { iconCount++; return true; }, IntPtr.Zero);
        return string.Format("群組 {0} 個 / 影像 {1} 張 / 尺寸: {2}", groups.Count, iconCount, string.Join(", ", sizes.ToArray()));
    }
}
'@
Add-Type -TypeDefinition $code -ReferencedAssemblies System.Drawing | Out-Null
Write-Host "圖示資源        : $([IconProbe]::Probe($exe))"

# 3) 版本資訊（檔案屬性頁與工作管理員顯示的欄位）
$vi = (Get-Item $exe).VersionInfo
Write-Host "產品名稱        : '$($vi.ProductName)'"
Write-Host "檔案說明        : '$($vi.FileDescription)'"
Write-Host "檔案版本        : '$($vi.FileVersion)'"
Write-Host "公司            : '$($vi.CompanyName)'"
