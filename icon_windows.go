//go:build windows

/* ============================================================================
   視窗圖示 (Windows)
   ----------------------------------------------------------------------------
   要修的症狀：EXE 在檔案總管有正確圖示，但「執行後視窗左上角與工作列」
   顯示的是 Windows 通用應用程式圖示。

   根因（讀 go-webview2 原始碼確認）：CreateWithOptions 在 IconId == 0 時，
   走的是 LoadImageW(hinstance, 32512, ...)，32512 就是 IDI_APPLICATION，
   （hinstance 為 NULL 時）＝系統內建圖示。舊版 syso 沒有 32512 群組，
   視窗因此掛不到我們的圖示 —— 資源一直在（verify-icon.ps1 通過），
   只是從來沒有人把它掛到視窗上；「驗證了資源就宣稱完成」曾是盲點。

   現況：rsrc_windows_amd64.syso 改由 goversioninfo 從 winres/versioninfo.json
   重新產生（build.ps1 內建此步驟）。該工具依設計把「視窗標題列」用的
   圖示群組固定嵌在 IDI_APPLICATION = 32512（-application-icon 參數的
   存在目的），LoadImageW(hinstance, 32512) 拿到的就是我們的圖示。

   兩道保險：
     1. 建立視窗時傳 IconId = appIconResourceID，讓視窗類別（WNDCLASSEX 的
        HIcon / HIconSm）一開始就正確。
     2. 視窗建立後再以 WM_SETICON 明確指定大小相符的兩張圖：
        ICON_BIG（工作列／Alt+Tab，SM_CXICON）與 ICON_SMALL（標題列，
        SM_CXSMICON）。理由是類別圖示只有一個尺寸，Windows 會替你縮放，
        小圖會糊；LoadImageW 指定實際像素才會挑到 .ico 裡對應的那一張。

   注意 LR_SHARED：只有在請求「預設尺寸」時才該用。這裡明確指定 cx/cy，
   因此用 LR_DEFAULTCOLOR(0)，避免共享快取回傳尺寸不符的 handle。
   ========================================================================== */

package main

import (
	"syscall"
	"unsafe"
)

// RT_GROUP_ICON 的整數 ID。goversioninfo（build.ps1 會用 winres/versioninfo.json
// 重新產生 syso）把「視窗標題列」用的圖示群組固定嵌在 IDI_APPLICATION = 32512，
// 這是該工具保證、穩定的 ID；舊版 syso 則把唯一群組放在 #1。
// 視窗類別（CreateWithOptions 的 IconId）與 WM_SETICON 兩條路徑都讀這個 ID。
const appIconResourceID = 32512

var (
	kernel32               = syscall.NewLazyDLL("kernel32.dll")
	procGetModuleHandleW   = kernel32.NewProc("GetModuleHandleW")
	procLoadImageW         = user32.NewProc("LoadImageW")
	procSendMessageW       = user32.NewProc("SendMessageW")
	procGetSystemMetricsFn = user32.NewProc("GetSystemMetrics")
)

const (
	imageIcon = 1

	wmSetIcon  = 0x0080
	iconSmall  = 0
	iconBig    = 1
	lrDefColor = 0x0000

	smCXIcon   = 11
	smCYIcon   = 12
	smCXSMIcon = 49
	smCYSMIcon = 50
)

func systemMetric(index int) int {
	v, _, _ := procGetSystemMetricsFn.Call(uintptr(index))
	return int(v)
}

// 從自身模組載入指定像素尺寸的應用程式圖示。回傳 0 代表載入失敗。
func loadAppIcon(cx, cy int) uintptr {
	hinst, _, _ := procGetModuleHandleW.Call(0)
	h, _, _ := procLoadImageW.Call(
		hinst,
		uintptr(appIconResourceID),
		imageIcon,
		uintptr(cx),
		uintptr(cy),
		lrDefColor,
	)
	return h
}

// 把大小兩張圖示掛到視窗上。hwnd 由 webview.Window() 取得。
// 失敗時安靜略過 —— 圖示不對頂多是外觀問題，不該讓 App 起不來。
func applyWindowIcon(hwnd unsafe.Pointer) {
	if hwnd == nil {
		return
	}
	h := uintptr(hwnd)

	if big := loadAppIcon(systemMetric(smCXIcon), systemMetric(smCYIcon)); big != 0 {
		procSendMessageW.Call(h, wmSetIcon, iconBig, big)
	}
	if small := loadAppIcon(systemMetric(smCXSMIcon), systemMetric(smCYSMIcon)); small != 0 {
		procSendMessageW.Call(h, wmSetIcon, iconSmall, small)
	}
}
