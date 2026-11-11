//go:build windows

/* ============================================================================
   Ai Cad — 更新流程的「對外說法」
   ----------------------------------------------------------------------------
   使用者要的是「有沒有更新、能不能更新」；下載來源（網址、主機、本機路徑）
   屬於內部資訊，不該出現在任何提示裡。先前 checkForUpdate 會把「試過哪些位置」
   與「各自的原因」整份列出來，等於把來源攤在畫面上。

   這裡集中處理兩件事：
     1. mentionsUpdateSource —— 判斷一段訊息是否提到來源。
     2. friendlyUpdateError —— 把內部錯誤換成一句使用者看得懂、且不含來源的話。

   只改措辭：https 白名單、SHA-256 強制驗證、大小上限等檢查一律不變。
   需要逐項原因時設 AICAD_UPDATE_DEBUG=1。
   ========================================================================== */

package main

import (
	"errors"
	"os"
	"strings"
)

// errUpdateUnreachable 是全體更新來源都取不到時的對外說法。
var errUpdateUnreachable = errors.New("更新失敗，請檢查網路連線後再試一次")

// updateDebugEnabled 決定是否把逐項失敗原因帶出來（預設關閉）。
func updateDebugEnabled() bool {
	return strings.TrimSpace(os.Getenv("AICAD_UPDATE_DEBUG")) == "1"
}

// mentionsUpdateSource 判斷文字裡是否藏了來源資訊。
func mentionsUpdateSource(text string) bool {
	lower := strings.ToLower(text)
	if strings.Contains(lower, "://") || strings.Contains(lower, "www.") || strings.Contains(lower, "github") {
		return true
	}
	for _, tld := range []string{
		".com", ".net", ".org", ".io", ".ai", ".dev", ".app", ".cloud",
		".run", ".sh", ".tw", ".cn", ".jp", ".kr", ".hk", ".sg", ".local", ".internal",
	} {
		if strings.Contains(lower, tld) {
			return true
		}
	}
	if strings.Contains(lower, "localhost") || strings.Contains(lower, "127.0.0.1") {
		return true
	}
	for _, path := range []string{"/v1", "/v2", "/v1beta", "/sdapi", "/images", "/releases", "/tag/"} {
		if strings.Contains(lower, path) {
			return true
		}
	}
	// Windows 路徑，例如 C:\Temp\updates
	if len(text) >= 2 && text[1] == ':' && (text[0] >= 'A' && text[0] <= 'Z' || text[0] >= 'a' && text[0] <= 'z') {
		return true
	}
	return false
}

// friendlyUpdateError 把內部錯誤換成一句可以給使用者看的話。
//
// 判斷順序：先看是否洩漏來源（洩漏就整句換掉，不留殘句），再看幾個需要
// 更精確說明的已知情況（雜湊不符、寫入失敗、下載失敗），其餘原樣保留 ——
// 內部錯誤本身通常是簡短的中文，已經可以讀。
func friendlyUpdateError(err error) string {
	if err == nil {
		return ""
	}
	text := strings.TrimSpace(err.Error())
	if text == "" || mentionsUpdateSource(text) {
		return "更新失敗，請檢查網路連線後再試一次"
	}
	lower := strings.ToLower(text)
	switch {
	case strings.Contains(text, "SHA-256") || strings.Contains(lower, "checksum") || strings.Contains(lower, "sha256"):
		return "更新檔驗證失敗，已保留目前版本；請稍後重新下載"
	case strings.Contains(text, "過大") || strings.Contains(text, "大小"):
		return "更新檔大小異常，已取消這次更新"
	case strings.Contains(text, "寫入") || strings.Contains(text, "權限") || strings.Contains(text, "拒絕存取"):
		return "無法寫入更新檔，請確認程式所在資料夾可寫入，或以系統管理員身分執行"
	case strings.Contains(text, "下載"):
		return "更新下載失敗，請檢查網路連線後再試一次"
	case strings.Contains(text, "安裝"):
		return "更新安裝失敗，請重新啟動程式後再試一次"
	// 只要字面提到「來源、網址、位址、路徑、URL」，一律換掉 —— 使用者不需要知道程式去哪裡找。
	case strings.Contains(text, "來源") || strings.Contains(text, "網址") || strings.Contains(text, "位址") ||
		strings.Contains(text, "路徑") || strings.Contains(lower, "url"):
		return errUpdateUnreachable.Error()
	}
	if len(text) > 160 {
		runes := []rune(text)
		if len(runes) > 80 {
			return string(runes[:80]) + "…"
		}
	}
	return text
}
