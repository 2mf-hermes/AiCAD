//go:build windows

/* ============================================================================
   宿主輔助函式 (Windows)
   ----------------------------------------------------------------------------
   分成獨立檔案的理由：main.go 應該只讀得到「這個 App 做什麼」，
   平台細節（Win32 MessageBox、版本字串）不該混在流程裡。
   ========================================================================== */

package main

import (
	"context"
	"syscall"
	"time"
	"unsafe"
)

// 建置時可用 -ldflags "-X main.version=1.2.3" 覆寫
var version = "0.3.5.1"

func appVersion() string { return version }

func contextWithTimeout(parent context.Context, d time.Duration) (context.Context, func()) {
	return context.WithTimeout(parent, d)
}

var (
	user32                = syscall.NewLazyDLL("user32.dll")
	procMsgBoxW           = user32.NewProc("MessageBoxW")
	procSetWindowLongPtrW = user32.NewProc("SetWindowLongPtrW")
	procCallWindowProcW   = user32.NewProc("CallWindowProcW")
	procDestroyWindow     = user32.NewProc("DestroyWindow")
)

const (
	mbOK          = 0x00000000
	mbIconError   = 0x00000010
	mbSetForeword = 0x00010000
	gwlpWndProc   = -4
	wmClose       = 0x0010
)

type closeInterceptor struct {
	hwnd       uintptr
	oldWndProc uintptr
	callback   uintptr
	allowClose bool
	onClose    func()
}

func installCloseInterceptor(hwnd unsafe.Pointer, onClose func()) *closeInterceptor {
	c := &closeInterceptor{hwnd: uintptr(hwnd), onClose: onClose}
	c.callback = syscall.NewCallback(func(hwnd, msg, wp, lp uintptr) uintptr {
		if msg == wmClose {
			if c.allowClose {
				procDestroyWindow.Call(hwnd)
				return 0
			}
			if c.onClose != nil {
				c.onClose()
			}
			return 0
		}
		ret, _, _ := procCallWindowProcW.Call(c.oldWndProc, hwnd, msg, wp, lp)
		return ret
	})
	old, _, _ := procSetWindowLongPtrW.Call(c.hwnd, ^uintptr(3), c.callback)
	c.oldWndProc = old
	return c
}

func (c *closeInterceptor) closeNow() {
	if c == nil || c.hwnd == 0 {
		return
	}
	c.allowClose = true
	procDestroyWindow.Call(c.hwnd)
}

// 已編譯為 -H windowsgui，沒有主控台可印訊息，啟動期錯誤必須用對話框呈現，
// 否則使用者雙擊後只會看到「什麼都沒發生」。
func showMessageBox(title, text string) {
	t, err := syscall.UTF16PtrFromString(title)
	if err != nil {
		return
	}
	b, err := syscall.UTF16PtrFromString(text)
	if err != nil {
		return
	}
	procMsgBoxW.Call(
		0,
		uintptr(unsafe.Pointer(b)),
		uintptr(unsafe.Pointer(t)),
		uintptr(mbOK|mbIconError|mbSetForeword),
	)
}
