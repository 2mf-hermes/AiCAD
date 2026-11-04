//go:build windows

/* ============================================================================
   Ai Cad — Windows 宿主程式 (WebView2 Host)
   ----------------------------------------------------------------------------
   這個檔案是「單一 EXE」的核心。它做四件事：

   1. 用 go:embed 把 Vite 建置出來的 web/ 目錄整包吃進二進位檔。
      執行期不解壓縮、不落地、不留暫存檔 —— 這是「免安裝」的字面意義。

   2. 在 127.0.0.1 的隨機埠開一個極小的 HTTP 伺服器，從記憶體中的
      embed.FS 供應前端資產。為什麼不用 file:// ？因為 file:// 下
      fetch、Web Crypto、以及部分 CSS 特性會受限；走 loopback HTTP
      能拿到完整的現代瀏覽器能力，代價只有一個埠。

   3. 提供 /bridge/http 原生出口。瀏覽器 fetch 受 CORS 限制，而
      OpenAI / Anthropic 等端點都不發 CORS 標頭。由 Go 代發請求可以
      徹底繞過 CORS，也讓逾時與代理設定有單一控制點。

   4. 建立 WebView2 視窗。WebView2 Runtime 由 Windows Update 維護、
      系統已內建，所以我們不必像 Electron 一樣自帶一顆 Chromium。

   綁定選擇：使用 jchv/go-webview2（純 Go，透過 winloader 動態載入
   WebView2Loader）而非官方 webview/webview_go。原因是後者走 cgo，
   編譯時需要 Windows SDK 的 EventToken.h 等標頭；本機的 TDM-GCC 沒有
   這些檔案，實測直接編譯失敗。純 Go 綁定可用 CGO_ENABLED=0 編譯，
   建置環境更乾淨，產物也仍是單一靜態 EXE。

   安全設計（重要）：
   - 伺服器只綁 127.0.0.1，不對外網開放。
   - 埠號隨機（由 OS 指派），每次啟動不同。
   - /bridge/http 要求 X-AiCad-Token 標頭，token 是每次啟動隨機產生的
     32 bytes，只透過 w.Init() 注入到頁面裡。沒有這個 token 的請求
     一律 403 —— 這是為了防止機器上的其他程式或瀏覽器分頁把這個
     端點當成 SSRF 跳板。
   ========================================================================== */

package main

import (
	"bytes"
	"crypto/rand"
	"crypto/subtle"
	"embed"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"mime/multipart"
	"net"
	"net/http"
	"net/textproto"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"

	webview2 "github.com/jchv/go-webview2"
)

//go:embed all:web
var embedded embed.FS

const (
	appTitle  = "Ai Cad"
	winWidth  = 1440
	winHeight = 900
	minWidth  = 1120
	minHeight = 680

	/* ---- 代發請求的時間預算 ----------------------------------------------
	   這裡刻意「不」在 http.Client 上設 Timeout。

	   原本的寫法是 client := &http.Client{Timeout: 10 * time.Minute}。
	   client.Timeout 涵蓋連線 + 送出 + 讀完整個 body，而且是 handler 建立時
	   就固定的單例值 —— 前端把逾時秒數調到 30 分鐘也永遠先撞上這 10 分鐘，
	   使用者的體感就是「調高超時上限完全沒有效果」。

	   正確的分層是：
	     - 連線 / TLS / 標頭這些「應該很快」的階段各給短而固定的上限，
	       避免無限掛在 dial 上；
	     - 「等模型算完」這段由前端傳來的 timeoutMs 經 context 控制，
	       因為只有前端知道使用者選的是雲端還是本地 SD。
	   --------------------------------------------------------------------- */

	// 連線階段上限。握不到手就是網路或位址問題，不必等下去。
	bridgeDialTimeout = 20 * time.Second
	bridgeTLSTimeout  = 20 * time.Second
	// 前端沒給 timeoutMs 時的預設值。
	bridgeDefaultTimeout = 120 * time.Second
	// 上限。給到 60 分鐘是為了本地 SD 的高步數大圖；仍設上限，
	// 避免一個壞掉的請求永久佔住連線與記憶體。
	bridgeMaxTimeout = 60 * time.Minute

	// 回應內容上限 64 MB —— base64 圖片會很大，但也不該無上限。
	maxBodyBytes = 64 << 20
)

func main() {
	if !acquireSingleInstance() {
		return
	}

	// 上一輪自我更新留下的舊執行檔（AiCad.exe.old）現在可以清了 —— 那個映像
	// 已不在執行中。放在最前面，趁使用者還沒開始操作時做完。
	cleanupAfterUpdate()

	assets, err := fs.Sub(embedded, "web")
	if err != nil {
		fatal("內嵌資產損毀", err)
	}

	token, err := newToken()
	if err != nil {
		fatal("無法產生工作階段憑證", err)
	}

	// 綁 :0 讓 OS 指派一個空閒埠，避免固定埠衝突。
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		fatal("無法啟動本機資產伺服器", err)
	}
	origin := fmt.Sprintf("http://127.0.0.1:%d", ln.Addr().(*net.TCPAddr).Port)

	mux := http.NewServeMux()
	mux.Handle("/", noStore(http.FileServer(http.FS(assets))))
	mux.HandleFunc("/bridge/http", bridgeHandler(token))

	// 持久化出口。與 /bridge/http 共用同一道 token 閘門：這些端點能讀寫使用者
	// 的設定與（經 DPAPI 解密後的）API 金鑰，權限等級不比代發請求低。
	mux.Handle("/bridge/settings/get", requireToken(token, http.HandlerFunc(settingsGetHandler)))
	mux.Handle("/bridge/settings/set", requireToken(token, http.HandlerFunc(settingsSetHandler)))
	mux.Handle("/bridge/secret/get", requireToken(token, http.HandlerFunc(secretGetHandler)))
	mux.Handle("/bridge/secret/set", requireToken(token, http.HandlerFunc(secretSetHandler)))

	// 專案存檔出口。與設定同一個 token 閘門：這些端點能列舉、讀取、覆寫、
	// 刪除使用者的作品，權限等級不比設定低。
	mux.Handle("/bridge/project/list", requireToken(token, http.HandlerFunc(projectListHandler)))
	mux.Handle("/bridge/project/get", requireToken(token, http.HandlerFunc(projectGetHandler)))
	mux.Handle("/bridge/project/save", requireToken(token, http.HandlerFunc(projectSaveHandler)))
	mux.Handle("/bridge/project/delete", requireToken(token, http.HandlerFunc(projectDeleteHandler)))

	// 更新出口。四個階段各一個端點，對應前端 update.ts 的 UpdateBackend 介面。
	// install 會替換執行檔並重啟，權限等級最高，同樣走 token 閘門。
	mux.Handle("/bridge/update/check", requireToken(token, http.HandlerFunc(updateCheckHandler)))
	mux.Handle("/bridge/update/start", requireToken(token, http.HandlerFunc(updateStartHandler)))
	mux.Handle("/bridge/update/progress", requireToken(token, http.HandlerFunc(updateProgressHandler)))
	mux.Handle("/bridge/update/install", requireToken(token, http.HandlerFunc(updateInstallHandler)))

	srv := &http.Server{
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}
	go func() {
		if err := srv.Serve(ln); err != nil && err != http.ErrServerClosed {
			log.Println("資產伺服器結束:", err)
		}
	}()

	w := webview2.NewWithOptions(webview2.WebViewOptions{
		Debug:     false,
		AutoFocus: true,
		// 明確指定使用者資料夾。不指定時 WebView2 會嘗試寫在 EXE 旁邊，
		// 若 EXE 放在唯讀位置（Program Files、隨身碟）會直接啟動失敗。
		DataPath: userDataPath(),
		WindowOptions: webview2.WindowOptions{
			Title:  appTitle,
			Width:  winWidth,
			Height: winHeight,
			Center: true,
			// 不指定時 go-webview2 會載入 IDI_APPLICATION（Windows 通用圖示），
			// 於是視窗左上角與工作列都拿不到我們嵌進 EXE 的圖示。
			IconId: appIconResourceID,
		},
	})
	if w == nil {
		fatal("無法建立視窗", fmt.Errorf("WebView2 Runtime 初始化失敗，請安裝 Microsoft Edge WebView2 Runtime"))
	}
	defer w.Destroy()

	w.SetTitle(appTitle)
	w.SetSize(winWidth, winHeight, webview2.HintNone)
	w.SetSize(minWidth, minHeight, webview2.HintMin)

	// 視窗類別的圖示只有單一尺寸，標題列的小圖會被縮放而變糊。
	// 這裡再用 WM_SETICON 指定「大／小」兩張實際尺寸的圖示。
	applyWindowIcon(w.Window())

	closeGuard := installCloseInterceptor(w.Window(), func() {
		w.Eval(`window.__AICAD_REQUEST_CLOSE__?.()`)
	})
	if err := w.Bind("__AICAD_HOST_CLOSE_NOW__", func() {
		closeGuard.closeNow()
	}); err != nil {
		fatal("無法建立關閉橋接", err)
	}

	// 在任何頁面腳本執行前注入宿主資訊。前端據此判斷「我跑在桌面宿主裡」，
	// 並把 transport 切換到原生出口。
	w.Init(fmt.Sprintf(`window.__AICAD_HOST__ = Object.freeze({
  platform: "windows",
  version: %q,
  origin: %q,
  bridgeUrl: %q,
  token: %q
});`, appVersion(), origin, origin+"/bridge/http", token))

	w.Navigate(origin + "/index.html")
	w.Run()
}

/* ---------------------------------------------------------------------------
   原生 HTTP 出口
   前端把 { url, method, headers, body } 丟進來，Go 代發，原樣回傳
   { status, ok, text }。刻意不解析回應內容 —— 語意解讀留在前端 adapter，
   宿主只負責搬運。
   --------------------------------------------------------------------------- */

type bridgeRequest struct {
	URL       string            `json:"url"`
	Method    string            `json:"method"`
	Headers   map[string]string `json:"headers"`
	Body      string            `json:"body"`
	Multipart []multipartPart   `json:"multipart"`
	TimeoutMs int               `json:"timeoutMs"`
	// "text"（預設）或 "base64"。部分聚合／中轉端點的出圖只回 URL 而不回
	// base64，前端拿到 URL 之後必須再抓一次二進位內容；WebView 端做這件事
	// 又會撞到 CORS 與二進位轉碼，所以由宿主直接回 base64。
	ResponseAs string `json:"responseAs"`
}

type multipartPart struct {
	Name        string `json:"name"`
	Value       string `json:"value,omitempty"`
	Filename    string `json:"filename,omitempty"`
	ContentType string `json:"contentType,omitempty"`
	Base64      string `json:"base64,omitempty"`
}

type bridgeResponse struct {
	Status int    `json:"status"`
	OK     bool   `json:"ok"`
	Text   string `json:"text"`
	Error  string `json:"error,omitempty"`
}

func bridgeHandler(token string) http.HandlerFunc {
	// 逐階段設限、但「等模型算完」不設限 —— 那一段交給 per-request context。
	client := &http.Client{
		Transport: &http.Transport{
			Proxy: http.ProxyFromEnvironment,
			DialContext: (&net.Dialer{
				Timeout:   bridgeDialTimeout,
				KeepAlive: 30 * time.Second,
			}).DialContext,
			TLSHandshakeTimeout: bridgeTLSTimeout,
			// ResponseHeaderTimeout 刻意不設：長時間出圖的端點在算完之前
			// 不會送出任何標頭，設了就等於又造一道假的逾時牆。
			ExpectContinueTimeout: 5 * time.Second,
			MaxIdleConnsPerHost:   4,
			ForceAttemptHTTP2:     true,
		},
	}

	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")

		if r.Method != http.MethodPost {
			http.Error(w, "只接受 POST", http.StatusMethodNotAllowed)
			return
		}
		// 固定時間比較，避免 timing side channel。
		got := r.Header.Get("X-AiCad-Token")
		if subtle.ConstantTimeCompare([]byte(got), []byte(token)) != 1 {
			http.Error(w, "憑證不符", http.StatusForbidden)
			return
		}

		var req bridgeRequest
		if err := json.NewDecoder(io.LimitReader(r.Body, maxBodyBytes)).Decode(&req); err != nil {
			writeJSON(w, bridgeResponse{Error: "請求格式錯誤: " + err.Error()})
			return
		}
		if !strings.HasPrefix(req.URL, "http://") && !strings.HasPrefix(req.URL, "https://") {
			writeJSON(w, bridgeResponse{Error: "只允許 http/https 位址"})
			return
		}

		method := strings.ToUpper(req.Method)
		if method != http.MethodGet && method != http.MethodPost {
			writeJSON(w, bridgeResponse{Error: "只允許 GET/POST"})
			return
		}

		var body io.Reader
		contentType := ""
		if req.Body != "" && len(req.Multipart) > 0 {
			writeJSON(w, bridgeResponse{Error: "request 不得同時包含 JSON 與 multipart"})
			return
		}
		if len(req.Multipart) > 0 {
			var err error
			body, contentType, err = buildMultipartBody(req.Multipart)
			if err != nil {
				writeJSON(w, bridgeResponse{Error: "multipart 建立失敗: " + err.Error()})
				return
			}
		} else if req.Body != "" {
			body = strings.NewReader(req.Body)
		}

		// 時間預算一律由前端決定，宿主只負責夾在合理範圍內。
		// 這裡不再有任何比 budget 更短的隱藏上限 —— 那正是「調高逾時
		// 也拿不到結果」的成因。
		ctx, cancel := contextWithTimeout(r.Context(), bridgeBudget(req.TimeoutMs))
		defer cancel()

		outbound, err := http.NewRequestWithContext(ctx, method, req.URL, body)
		if err != nil {
			writeJSON(w, bridgeResponse{Error: "無法建立請求: " + err.Error()})
			return
		}
		for k, v := range req.Headers {
			outbound.Header.Set(k, v)
		}
		if contentType != "" {
			outbound.Header.Set("Content-Type", contentType)
		}

		res, err := client.Do(outbound)
		if err != nil {
			writeJSON(w, bridgeResponse{Error: humanNetError(err)})
			return
		}
		defer res.Body.Close()

		raw, err := io.ReadAll(io.LimitReader(res.Body, maxBodyBytes))
		if err != nil {
			writeJSON(w, bridgeResponse{Error: "讀取回應失敗: " + err.Error()})
			return
		}

		text := string(raw)
		if strings.EqualFold(req.ResponseAs, "base64") {
			text = base64.StdEncoding.EncodeToString(raw)
		}

		writeJSON(w, bridgeResponse{
			Status: res.StatusCode,
			OK:     res.StatusCode >= 200 && res.StatusCode < 300,
			Text:   text,
		})
	}
}

func buildMultipartBody(parts []multipartPart) (io.Reader, string, error) {
	if len(parts) == 0 || len(parts) > 32 {
		return nil, "", fmt.Errorf("parts 數量超出限制")
	}
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	for _, part := range parts {
		if part.Name == "" || len(part.Name) > 128 {
			return nil, "", fmt.Errorf("multipart 欄位名稱無效")
		}
		if part.Filename == "" {
			if len(part.Value) > 1<<20 {
				return nil, "", fmt.Errorf("文字欄位過大")
			}
			if err := writer.WriteField(part.Name, part.Value); err != nil {
				return nil, "", err
			}
			continue
		}
		if len(part.Base64) > 48<<20 {
			return nil, "", fmt.Errorf("檔案欄位過大")
		}
		data, err := base64.StdEncoding.DecodeString(part.Base64)
		if err != nil || len(data) > 32<<20 {
			return nil, "", fmt.Errorf("檔案 base64 無效或過大")
		}
		contentType := part.ContentType
		if contentType == "" {
			contentType = "application/octet-stream"
		}
		header := make(textproto.MIMEHeader)
		header.Set("Content-Disposition", fmt.Sprintf(`form-data; name="%s"; filename="%s"`, part.Name, filepath.Base(part.Filename)))
		header.Set("Content-Type", contentType)
		fileWriter, err := writer.CreatePart(header)
		if err != nil {
			return nil, "", err
		}
		if _, err := fileWriter.Write(data); err != nil {
			return nil, "", err
		}
	}
	if err := writer.Close(); err != nil {
		return nil, "", err
	}
	return bytes.NewReader(buf.Bytes()), writer.FormDataContentType(), nil
}

// 把前端傳來的逾時毫秒夾到可用範圍。0 或負值代表前端沒給，用預設。
func bridgeBudget(ms int) time.Duration {
	if ms <= 0 {
		return bridgeDefaultTimeout
	}
	d := time.Duration(ms) * time.Millisecond
	if d > bridgeMaxTimeout {
		return bridgeMaxTimeout
	}
	return d
}

/* --------------------------------------------------------------------------- */

// 共用的 token 閘門。抽出來的理由：持久化端點與 /bridge/http 的驗證規則必須
// 完全一致，複製貼上遲早會有一邊漏掉。
func requireToken(token string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if r.Method != http.MethodPost {
			http.Error(w, "只接受 POST", http.StatusMethodNotAllowed)
			return
		}
		got := r.Header.Get("X-AiCad-Token")
		if subtle.ConstantTimeCompare([]byte(got), []byte(token)) != 1 {
			http.Error(w, "憑證不符", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, v bridgeResponse) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(v)
}

// 前端資產每次都從記憶體讀，禁止 WebView 快取舊版 —— 升級後不會看到過期畫面。
func noStore(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		next.ServeHTTP(w, r)
	})
}

func acquireSingleInstance() bool {
	name, _ := syscall.UTF16PtrFromString("Global\\AiCad.SingleInstance.0")
	kernel32 := syscall.NewLazyDLL("kernel32.dll")
	h, _, err := kernel32.NewProc("CreateMutexW").Call(0, 0, uintptr(unsafe.Pointer(name)))
	if h == 0 || err == syscall.Errno(183) { // ERROR_ALREADY_EXISTS
		return false
	}
	return true
}

func newToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// 網路錯誤原文對使用者沒意義，翻成可行動的訊息。
func humanNetError(err error) string {
	s := err.Error()
	switch {
	case strings.Contains(s, "context deadline exceeded"), strings.Contains(s, "Client.Timeout"):
		return "請求逾時 — 若使用本地模型，請把逾時秒數調高"
	case strings.Contains(s, "no such host"):
		return "找不到主機 — 請確認 Base URL 是否拼錯"
	case strings.Contains(s, "connection refused"):
		return "連線被拒 — 目標服務可能沒有啟動（本地模型請先開啟服務）"
	case strings.Contains(s, "certificate"):
		return "TLS 憑證驗證失敗 — 中轉站憑證可能有問題"
	}
	return "連線失敗: " + s
}

func fatal(msg string, err error) {
	// 已是 windowsgui（無主控台），用 MessageBox 才看得到。
	showMessageBox(appTitle, fmt.Sprintf("%s\n\n%v", msg, err))
	log.Fatalf("%s: %v", msg, err)
}

// WebView2 的瀏覽器快取與 IndexedDB 落在使用者 LocalAppData，
// 而非 EXE 所在目錄 —— 保持「EXE 是唯讀單檔」這個性質。
func userDataPath() string {
	base, err := os.UserCacheDir()
	if err != nil {
		return ""
	}
	p := filepath.Join(base, "AiCad", "WebView2")
	if err := os.MkdirAll(p, 0o755); err != nil {
		return ""
	}
	return p
}
