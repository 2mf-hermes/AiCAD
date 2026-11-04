//go:build windows

/* ============================================================================
   宿主端持久化 (Persistent Store) — Windows
   ----------------------------------------------------------------------------
   為什麼一定要有這一層：

   前端原本把設定寫在 localStorage。但宿主每次啟動都綁 127.0.0.1 的「隨機
   埠」，而瀏覽器的 localStorage 是以 origin（scheme + host + port）隔離的。
   埠一變，origin 就變，等於每次開啟 Ai Cad 都拿到一份全新的空儲存 ——
   這就是「設定每次開啟都被重置」的真正原因，不是前端邏輯寫錯。

   解法只能往宿主走：由 Go 直接寫檔到使用者的漫遊設定目錄。

     %APPDATA%\AiCad\settings.json   一般設定（明文，可攜、可備份、可手改）
     %APPDATA%\AiCad\secrets.bin     API 金鑰（DPAPI 加密，綁定 Windows 帳戶）

   為什麼分兩個檔：金鑰是付費憑證，與偏好設定的生命週期與風險等級完全不同。
   settings.json 使用者自己看得懂、想手改也行；secrets.bin 則是密文，就算
   整個資料夾被複製到別台機器也解不開 —— DPAPI 的金鑰綁在使用者帳戶上。

   寫入採「寫暫存檔再 rename」的原子替換。理由：若在寫入途中斷電或被強制
   關閉，直接覆寫會留下半截 JSON，下次啟動就是空設定 —— 那等於又回到當初
   要修的那個問題。rename 在同一磁碟區上是原子操作，不會有半截狀態。
   ========================================================================== */

package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"unsafe"
)

const (
	storeDirName  = "AiCad"
	settingsFile  = "settings.json"
	secretsFile   = "secrets.bin"
	maxStoreBytes = 4 << 20 // 4 MB：設定檔正常只有幾 KB，這是防禦性上限
)

// 同一份檔案可能被多個 bridge 請求同時碰到（前端連續存檔）。
// 序列化所有檔案存取，避免交錯寫入。
var storeMu sync.Mutex

/* ---------------------------------------------------------------------------
   路徑
   --------------------------------------------------------------------------- */

// 設定放 Roaming（%APPDATA%）而非 Local：使用者換機器、跟著域帳戶漫遊時
// 偏好設定應該跟著走。WebView2 的快取才該放 Local（見 userDataPath）。
func storeDir() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	p := filepath.Join(base, storeDirName)
	if err := os.MkdirAll(p, 0o700); err != nil {
		return "", err
	}
	return p, nil
}

func storePath(name string) (string, error) {
	dir, err := storeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, name), nil
}

/* ---------------------------------------------------------------------------
   原子寫入
   --------------------------------------------------------------------------- */

func writeAtomic(path string, data []byte) error {
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	// Windows 的 os.Rename 在目標存在時會失敗，必須先移除。
	// 這個窗口很短，且 tmp 已經寫完 —— 最壞情況是舊檔沒了但新檔立刻補上。
	if _, err := os.Stat(path); err == nil {
		if err := os.Remove(path); err != nil {
			_ = os.Remove(tmp)
			return err
		}
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

func readIfExists(path string) ([]byte, error) {
	return readIfExistsLimit(path, maxStoreBytes)
}

// 上限拆成參數：設定檔只有幾 KB，但專案存檔內含圖片 data URL 會到數十 MB，
// 兩者不該共用同一個上限。回傳 nil, nil 代表檔案不存在（首次啟動不是錯誤）。
func readIfExistsLimit(path string, limit int64) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil // 首次啟動：沒有檔案不是錯誤
		}
		return nil, err
	}
	defer f.Close()
	raw, err := io.ReadAll(io.LimitReader(f, limit))
	if err != nil {
		return nil, err
	}
	// 去掉 UTF-8 BOM。這不是吹毛求疵：Windows 的記事本、PowerShell 的
	// Set-Content -Encoding UTF8 都會加 BOM，而 JSON.parse 遇到 BOM 直接拋錯。
	// 前端解析失敗就會退回預設值並寫回 —— 使用者看到的正是「設定被重置」。
	// 一個三 byte 的檢查換掉整類難以察覺的資料遺失，非常划算。
	return bytes.TrimPrefix(raw, []byte{0xEF, 0xBB, 0xBF}), nil
}

/* ---------------------------------------------------------------------------
   DPAPI — Windows 資料保護 API
   ----------------------------------------------------------------------------
   CryptProtectData / CryptUnprotectData 以「當前使用者」為金鑰加密資料。
   密文只能在同一台機器的同一個 Windows 帳戶下解開，不需要我們自己管理任何
   金鑰 —— 自己實作金鑰保管幾乎必然做錯，能交給 OS 就交給 OS。

   注意 CGO_ENABLED=0：這裡走 syscall.NewLazyDLL 動態呼叫，不需要 cgo，
   所以「單一靜態 EXE、建置環境只要 Go」這個前提不變。
   --------------------------------------------------------------------------- */

var (
	crypt32                = syscall.NewLazyDLL("crypt32.dll")
	kernel32DLL            = syscall.NewLazyDLL("kernel32.dll")
	procCryptProtectData   = crypt32.NewProc("CryptProtectData")
	procCryptUnprotectData = crypt32.NewProc("CryptUnprotectData")
	procLocalFree          = kernel32DLL.NewProc("LocalFree")
)

// CRYPTOAPI_BLOB
type dataBlob struct {
	cbData uint32
	pbData *byte
}

func newBlob(b []byte) dataBlob {
	if len(b) == 0 {
		return dataBlob{}
	}
	return dataBlob{cbData: uint32(len(b)), pbData: &b[0]}
}

// 把 DPAPI 配置的記憶體複製成 Go slice 後立刻 LocalFree，避免洩漏。
func (b *dataBlob) bytesAndFree() []byte {
	if b.pbData == nil || b.cbData == 0 {
		return nil
	}
	out := make([]byte, b.cbData)
	copy(out, unsafe.Slice(b.pbData, b.cbData))
	_, _, _ = procLocalFree.Call(uintptr(unsafe.Pointer(b.pbData)))
	b.pbData = nil
	return out
}

const cryptprotectUIForbidden = 0x1 // 絕不彈出 UI：這是背景操作

func dpapiProtect(plain []byte) ([]byte, error) {
	if len(plain) == 0 {
		return nil, nil
	}
	in := newBlob(plain)
	var out dataBlob
	r, _, err := procCryptProtectData.Call(
		uintptr(unsafe.Pointer(&in)),
		0, 0, 0, 0,
		uintptr(cryptprotectUIForbidden),
		uintptr(unsafe.Pointer(&out)),
	)
	if r == 0 {
		return nil, err
	}
	return out.bytesAndFree(), nil
}

func dpapiUnprotect(cipher []byte) ([]byte, error) {
	if len(cipher) == 0 {
		return nil, nil
	}
	in := newBlob(cipher)
	var out dataBlob
	r, _, err := procCryptUnprotectData.Call(
		uintptr(unsafe.Pointer(&in)),
		0, 0, 0, 0,
		uintptr(cryptprotectUIForbidden),
		uintptr(unsafe.Pointer(&out)),
	)
	if r == 0 {
		return nil, err
	}
	return out.bytesAndFree(), nil
}

/* ---------------------------------------------------------------------------
   一般設定：讀 / 寫
   宿主刻意不理解 JSON 的內容結構 —— schema 演進是前端的事，宿主只搬運字串。
   這樣以後加設定欄位不必動 Go 程式碼，也不必重新編譯 EXE 才能相容。
   --------------------------------------------------------------------------- */

type storeReply struct {
	OK    bool   `json:"ok"`
	Data  string `json:"data,omitempty"`
	Error string `json:"error,omitempty"`
}

type storeRequest struct {
	Data string `json:"data"`
}

func settingsGetHandler(w http.ResponseWriter, _ *http.Request) {
	storeMu.Lock()
	defer storeMu.Unlock()

	path, err := storePath(settingsFile)
	if err != nil {
		writeStoreJSON(w, storeReply{Error: "無法定位設定目錄: " + err.Error()})
		return
	}
	raw, err := readIfExists(path)
	if err != nil {
		writeStoreJSON(w, storeReply{Error: "讀取設定失敗: " + err.Error()})
		return
	}
	writeStoreJSON(w, storeReply{OK: true, Data: string(raw)})
}

func settingsSetHandler(w http.ResponseWriter, r *http.Request) {
	var req storeRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, maxStoreBytes)).Decode(&req); err != nil {
		writeStoreJSON(w, storeReply{Error: "請求格式錯誤: " + err.Error()})
		return
	}
	// 拒絕存入不是合法 JSON 的內容：寧可現在失敗，也不要下次啟動才發現檔案壞掉。
	if !json.Valid([]byte(req.Data)) {
		writeStoreJSON(w, storeReply{Error: "設定內容不是合法 JSON，已拒絕寫入"})
		return
	}

	storeMu.Lock()
	defer storeMu.Unlock()

	path, err := storePath(settingsFile)
	if err != nil {
		writeStoreJSON(w, storeReply{Error: "無法定位設定目錄: " + err.Error()})
		return
	}
	if err := writeAtomic(path, []byte(req.Data)); err != nil {
		writeStoreJSON(w, storeReply{Error: "寫入設定失敗: " + err.Error()})
		return
	}
	writeStoreJSON(w, storeReply{OK: true})
}

/* ---------------------------------------------------------------------------
   憑證：整張表一起加密
   ----------------------------------------------------------------------------
   為什麼不是一個金鑰一個檔：DPAPI 每次加密都有固定開銷與獨立密文標頭，
   而且多檔案要處理各檔案間的一致性。整張 map 序列化後一次加密最單純，
   金鑰數量本來也只有個位數。
   --------------------------------------------------------------------------- */

type secretsRequest struct {
	Ref   string `json:"ref"`
	Value string `json:"value"`
}

func loadSecrets() (map[string]string, error) {
	path, err := storePath(secretsFile)
	if err != nil {
		return nil, err
	}
	cipher, err := readIfExists(path)
	if err != nil {
		return nil, err
	}
	if len(cipher) == 0 {
		return map[string]string{}, nil
	}
	plain, err := dpapiUnprotect(cipher)
	if err != nil {
		// 解不開通常代表檔案是別的 Windows 帳戶加密的，或已損毀。
		// 這種情況回空表而非報錯：使用者重新輸入金鑰就能繼續用，
		// 若在這裡硬失敗，整個設定面板都會打不開。
		return map[string]string{}, nil
	}
	out := map[string]string{}
	if err := json.Unmarshal(plain, &out); err != nil {
		return map[string]string{}, nil
	}
	return out, nil
}

func saveSecrets(m map[string]string) error {
	plain, err := json.Marshal(m)
	if err != nil {
		return err
	}
	cipher, err := dpapiProtect(plain)
	if err != nil {
		return err
	}
	path, err := storePath(secretsFile)
	if err != nil {
		return err
	}
	return writeAtomic(path, cipher)
}

func secretGetHandler(w http.ResponseWriter, r *http.Request) {
	var req secretsRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, maxStoreBytes)).Decode(&req); err != nil {
		writeStoreJSON(w, storeReply{Error: "請求格式錯誤: " + err.Error()})
		return
	}
	if !validRef(req.Ref) {
		writeStoreJSON(w, storeReply{Error: "憑證代號不合法"})
		return
	}

	storeMu.Lock()
	defer storeMu.Unlock()

	m, err := loadSecrets()
	if err != nil {
		writeStoreJSON(w, storeReply{Error: "讀取憑證失敗: " + err.Error()})
		return
	}
	writeStoreJSON(w, storeReply{OK: true, Data: m[req.Ref]})
}

func secretSetHandler(w http.ResponseWriter, r *http.Request) {
	var req secretsRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, maxStoreBytes)).Decode(&req); err != nil {
		writeStoreJSON(w, storeReply{Error: "請求格式錯誤: " + err.Error()})
		return
	}
	if !validRef(req.Ref) {
		writeStoreJSON(w, storeReply{Error: "憑證代號不合法"})
		return
	}

	storeMu.Lock()
	defer storeMu.Unlock()

	m, err := loadSecrets()
	if err != nil {
		writeStoreJSON(w, storeReply{Error: "讀取憑證失敗: " + err.Error()})
		return
	}
	if req.Value == "" {
		delete(m, req.Ref)
	} else {
		m[req.Ref] = req.Value
	}
	if err := saveSecrets(m); err != nil {
		writeStoreJSON(w, storeReply{Error: "寫入憑證失敗: " + err.Error()})
		return
	}
	writeStoreJSON(w, storeReply{OK: true})
}

// 憑證代號由前端組成（例：aicad.secret.openai）。限制字元集是為了它未來
// 若被當成檔名或註冊表鍵使用時不會夾帶路徑跳脫。
func validRef(ref string) bool {
	if ref == "" || len(ref) > 128 {
		return false
	}
	for _, c := range ref {
		ok := (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
			(c >= '0' && c <= '9') || c == '.' || c == '-' || c == '_'
		if !ok {
			return false
		}
	}
	return !strings.Contains(ref, "..")
}

func writeStoreJSON(w http.ResponseWriter, v storeReply) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(v)
}
