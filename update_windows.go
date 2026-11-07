//go:build windows

/* ============================================================================
   Ai Cad — 自動更新（原生半邊）
   ----------------------------------------------------------------------------
   使用者要的是「按一下就更新完」，不是丟一個下載連結。真正能做到這件事的只有
   原生宿主，所以整條流程的重活都在這裡：

     檢查  GET 更新資訊清單 → 比對版號
     下載  串流寫入暫存目錄，邊寫邊算 SHA-256、邊回報百分比
     驗證  比對雜湊；不符就地刪除，絕不留下半個檔案
     安裝  改名自己 → 就位新檔 → 啟動新檔 → 結束本行程

   為什麼「改名自己」可行：Windows 不允許刪除正在執行的映像檔，但**允許改名**
   （檔案句柄跟著 inode 走，路徑只是目錄項）。所以把執行中的 AiCad.exe 改成
   AiCad.exe.old，原本的路徑就空出來了，新檔案可以放到完全相同的位置 —— 使用者
   的捷徑、工作列釘選、開始功能表全部不會斷。舊檔在下次啟動時清掉。

   這也是為什麼不需要安裝程式、不需要 UAC：整個動作只碰 EXE 自己所在的目錄。
   若該目錄不可寫（例如被放進 Program Files），我們**明確報錯**而不是偷偷要求
   提權 —— 靜默提權對使用者是更糟的行為。

   安全邊界：
   - 更新清單與 EXE 都必須走 https，且**主機名必須在白名單內**。這一層是為了
     防止有人改掉設定檔裡的 feed 位址，把更新流程變成任意程式碼下載器。
   - SHA-256 是強制的。清單沒帶雜湊 → 直接拒絕，不給「跳過驗證」的選項。
   - 下載大小有上限，避免磁碟被塞爆。
   ========================================================================== */

package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

/* ---------------------------------------------------------------------------
   組態
   --------------------------------------------------------------------------- */

const (
	// 官方更新來源＝GitHub Release。
	// 為什麼用 release 而不是自架清單：Ai Cad 以單一 EXE 發佈，GitHub Release 本來就同時
	// 提供版本標籤、說明、附件、下載網址、檔案大小與校驗碼，等於一份現成的更新清單，
	// 而且不必自己維護一台伺服器與 TLS 憑證；發佈流程也簡化成「推一個 tag」。
	repoOwner = "2mf-hermes"
	repoName  = "AiCAD"
	// releasesURL 取得 release 清單（最新在前）。用清單而非 /latest，是為了讓 beta
	// 頻道能在同一支 API 上挑預發佈版本，不必多開一條端點。
	releasesURL = "https://api.github.com/repos/" + repoOwner + "/" + repoName + "/releases"

	defaultFeedURL = releasesURL

	// 校驗碼附件名稱（發佈時一併附上）。找不到時仍可退回 release asset 的 digest 欄位。
	checksumAssetName = "SHA256SUMS.txt"

	// 下載上限。目前 EXE 約 10 MB 量級，256 MB 已是極寬裕的護欄。
	maxUpdateBytes = 256 << 20

	// 下載逾時。放寬到 30 分鐘容納慢速網路，但不是無限。
	updateTimeout = 30 * time.Minute

	// 舊版執行檔的暫留後綴。下次啟動時清除。
	staleSuffix = ".old"
)

// 允許下載更新的主機。刻意寫死在程式碼裡而不是讀設定檔 —— 設定檔是使用者
// 可寫的，若 feed 主機可被設定覆蓋，任何能改寫 settings.json 的程式就能
// 讓 Ai Cad 幫它下載並執行任意 EXE。
var allowedUpdateHosts = map[string]bool{
	// GitHub 是官方更新來源：API 取得 release 資訊，實際檔案由 github.com 或
	// release-assets 子網域送出（GitHub 會 302 到這兩個其中之一）。
	"api.github.com":                       true,
	"github.com":                           true,
	"codeload.github.com":                  true,
	"objects.githubusercontent.com":        true,
	"release-assets.githubusercontent.com": true,
}

/* ---------------------------------------------------------------------------
   更新來源解析
   ----------------------------------------------------------------------------
   為什麼不是「一個寫死的網址」：
   Ai Cad 以單一 EXE 發布，使用者拿到更新的管道可能是官網、內網共享資料夾，
   或一支隨身碟。若只認一個雲端位址，位址還沒上線、對方擋網域、或使用者根本
   在離線環境，整個流程就只能回一句網路錯誤 —— 使用者看到的就是
   「更新程序取得位置失敗」，而且無從下手。所以這裡改成「依序嘗試多個來源」，
   成功的那一個會被記錄下來（UpdateInfo.Source），UI 才能誠實顯示這次是從哪
   拿到的。

   安全性不因為多來源而放鬆：
   - 遠端一律 https，主機名必須在白名單（或其子網域）內。
   - 本機清單只接受程式自己的目錄、它底下的 updates\、自己的快取目錄，或由
     AICAD_UPDATE_FEED 明確指定的位置。設定檔改不到這些路徑，所以「改
     settings.json 就能讓程式下載任意 EXE」這條路仍然封死。
   - 不論來源是網路或本機檔案，SHA-256 一律強制驗證。
   --------------------------------------------------------------------------- */

// updateSource 是一個「可以拿到更新」的位置。Kind 決定走檔案系統還是 HTTP。
type updateSource struct {
	Kind  string // "local" | "remote"
	Label string // 給使用者看的一行描述，同時是正規化後的位址
	Path  string // Kind == local：清單或 EXE 的實際路徑
	URL   string // Kind == remote：https 網址
	// Dir 是這個來源所在目錄；清單內的相對下載路徑以此為基準。
	Dir string
	// AnyLocal：來源由 AICAD_UPDATE_FEED 明確指定。啟動環境是操作者自己給的
	// （等同命令列參數），所以允許任意本機路徑；設定檔碰不到它。
	AnyLocal bool
	// Err 保留解析失敗的原因，讓上層能一次回報「試過哪裡、為什麼不行」。
	Err error
	// Release：這個來源回應的是 GitHub Release 清單，而不是既有的 update-manifest.json
	// 形狀。兩種來源共用同一條「取得資訊 → 下載 → 驗證 → 安裝」的路，只有讀取與
	// 版本挑選不同，所以在來源上標記一次即可。
	Release bool
}

// appDir 回傳執行檔所在目錄（解析過符號連結）。
func appDir() string {
	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	return filepath.Dir(exe)
}

// updateManifestPaths 是本機更新清單的固定搜尋位置。
// 放在 EXE 旁邊是為了「整包複製到內網共享或隨身碟就能更新」這個實際場景。
func updateManifestPaths() []string {
	var out []string
	if dir := appDir(); dir != "" {
		out = append(out, filepath.Join(dir, "update-manifest.json"))
		out = append(out, filepath.Join(dir, "updates", "update-manifest.json"))
	}
	if cache, err := os.UserCacheDir(); err == nil {
		out = append(out, filepath.Join(cache, "AiCad", "update-manifest.json"))
	}
	return out
}

// localUpdateRoots 是本機來源允許的根目錄。
func localUpdateRoots() []string {
	var roots []string
	if dir := appDir(); dir != "" {
		roots = append(roots, dir, filepath.Join(dir, "updates"))
	}
	if cache, err := os.UserCacheDir(); err == nil {
		roots = append(roots, filepath.Join(cache, "AiCad"))
	}
	return roots
}

func pathWithin(root, p string) bool {
	if root == "" {
		return false
	}
	rel, err := filepath.Rel(root, p)
	if err != nil {
		return false
	}
	return rel == "." || (rel != ".." && !strings.HasPrefix(rel, ".."+string(os.PathSeparator)))
}

func localUpdateAllowed(p string) bool {
	for _, root := range localUpdateRoots() {
		if pathWithin(root, p) {
			return true
		}
	}
	return false
}

func isRemoteSpec(s string) bool {
	lowered := strings.ToLower(strings.TrimSpace(s))
	return strings.HasPrefix(lowered, "http://") || strings.HasPrefix(lowered, "https://")
}

// isReleaseAPI 判斷一個網址是不是 GitHub releases API（官方來源就是這一個）。
// 這條判斷只用來決定「回應要當 release 陣列還是 update-manifest.json 解讀」，
// 安全性仍然由 checkUpdateURL 的主機白名單負責，不靠這裡把關。
func isReleaseAPI(s string) bool {
	u, err := url.Parse(strings.TrimSpace(s))
	if err != nil {
		return false
	}
	return strings.EqualFold(u.Hostname(), "api.github.com") &&
		strings.Contains(strings.ToLower(u.Path), "/releases")
}

// parseUpdateSource 把一行來源描述轉成 updateSource。
// baseDir 供相對路徑使用 —— 清單裡寫 "AiCad-0.2.0.exe" 就代表「跟清單放一起」，
// 這是離線發布最省事的寫法，也是先前完全缺失的行為。
func parseUpdateSource(spec, baseDir string, anyLocal bool) (updateSource, error) {
	s := strings.TrimSpace(spec)
	if s == "" {
		return updateSource{}, errors.New("更新來源為空")
	}
	if isRemoteSpec(s) {
		// 指向 GitHub 的 releases API 就代表「這是 release 來源」，不必額外設定：
		// 正式路徑與 AICAD_UPDATE_FEED 覆蓋共用同一條判斷。
		src := updateSource{Kind: "remote", Label: s, URL: s, Release: isReleaseAPI(s)}
		if err := checkUpdateURL(s); err != nil {
			return src, err
		}
		return src, nil
	}

	local := s
	if strings.HasPrefix(strings.ToLower(s), "file://") {
		u, err := url.Parse(s)
		if err != nil {
			return updateSource{}, fmt.Errorf("本機來源格式錯誤: %w", err)
		}
		local = filepath.FromSlash(u.Path)
	}
	if strings.TrimSpace(local) == "" {
		return updateSource{}, errors.New("本機來源沒有檔案路徑")
	}
	if !filepath.IsAbs(local) {
		if baseDir == "" {
			return updateSource{}, fmt.Errorf("相對路徑 %q 缺少基準目錄", local)
		}
		local = filepath.Join(baseDir, local)
	}
	local = filepath.Clean(local)
	src := updateSource{
		Kind: "local", Label: local, Path: local,
		Dir: filepath.Dir(local), AnyLocal: anyLocal,
	}
	if !anyLocal && !localUpdateAllowed(local) {
		return src, fmt.Errorf("本機更新檔必須放在程式目錄內: %s", local)
	}
	return src, nil
}

// updateSources 依序回傳要嘗試的來源。
// 明確設了 AICAD_UPDATE_FEED 就只試那一個 —— 覆蓋時行為必須可預期。
func updateSources() []updateSource {
	if v := strings.TrimSpace(os.Getenv("AICAD_UPDATE_FEED")); v != "" {
		src, err := parseUpdateSource(v, appDir(), true)
		if err != nil {
			src.Err = err
		}
		return []updateSource{src}
	}

	var out []updateSource
	for _, p := range updateManifestPaths() {
		if info, err := os.Stat(p); err == nil && !info.IsDir() {
			out = append(out, updateSource{Kind: "local", Label: p, Path: p, Dir: filepath.Dir(p)})
		}
	}
	// 最後的後路：官方 GitHub Release。標記 Release 讓 fetchUpdateInfo 知道
	// 回應是 release 陣列而不是 update-manifest.json。
	out = append(out, updateSource{Kind: "remote", Label: defaultFeedURL, URL: defaultFeedURL, Release: true})
	return out
}

/* ---------------------------------------------------------------------------
   資料形狀
   前端 src/core/update.ts 的 UpdateInfo / UpdateProgress 對應物。欄位名一致，
   讓 JSON 可以直接對接，不需要中間轉換層。
   --------------------------------------------------------------------------- */

type updateInfo struct {
	Version string `json:"version"`
	Notes   string `json:"notes"`
	URL     string `json:"url"`
	SHA256  string `json:"sha256"`
	Size    int64  `json:"size"`
	// Source 是這次資訊實際上從哪裡取得。先前 UI 看不到程式去哪裡找過更新，
	// 失敗時使用者只能猜；成功時也該知道是官方站台還是本機清單提供的。
	// 由後端填，清單本身不需要（也不該）提供這個欄位。
	Source string `json:"source,omitempty"`
}

type updateProgress struct {
	Percent int    `json:"percent"`
	Done    bool   `json:"done"`
	Error   string `json:"error"`
}

// 更新清單格式。以頻道為鍵，日後要加 beta 頻道不必改程式。
//
//	{ "stable": { "version": "0.2.0", "notes": "...", "url": "https://...", "sha256": "...", "size": 0 } }
type updateManifest map[string]updateInfo

/* ---------------------------------------------------------------------------
   GitHub Release 形狀（只宣告用得到的欄位）
   ---------------------------------------------------------------------------
   刻意用最小結構而不是整包 API 型別：欄位越少，GitHub 日後加東西也影響不到我們，
   而我們要的就這幾個 —— 版本、說明、是否預發佈、附件與其校驗碼。
   --------------------------------------------------------------------------- */

type releaseAsset struct {
	Name   string `json:"name"`
	URL    string `json:"browser_download_url"`
	Size   int64  `json:"size"`
	Digest string `json:"digest"` // 例：sha256:abc...
}

type releaseInfo struct {
	TagName    string         `json:"tag_name"`
	Name       string         `json:"name"`
	Body       string         `json:"body"`
	Prerelease bool           `json:"prerelease"`
	Draft      bool           `json:"draft"`
	Assets     []releaseAsset `json:"assets"`
}

// releaseInstaller 從 release 附件裡挑出 Windows 執行檔。
// 優先 AiCad.exe；其次任何 .exe；都沒有就代表這個 release 沒有可安裝的東西。
func releaseInstaller(r releaseInfo) (releaseAsset, bool) {
	var fallback *releaseAsset
	for i := range r.Assets {
		a := r.Assets[i]
		if !strings.HasSuffix(strings.ToLower(a.Name), ".exe") {
			continue
		}
		if strings.EqualFold(a.Name, "AiCad.exe") {
			return a, true
		}
		if fallback == nil {
			fallback = &r.Assets[i]
		}
	}
	if fallback != nil {
		return *fallback, true
	}
	return releaseAsset{}, false
}

// releaseChecksumAsset 找發佈時附上的校驗碼檔。
func releaseChecksumAsset(r releaseInfo) (releaseAsset, bool) {
	for _, a := range r.Assets {
		if strings.EqualFold(a.Name, checksumAssetName) || strings.EqualFold(a.Name, "SHA256SUMS") {
			return a, true
		}
	}
	return releaseAsset{}, false
}

// checksumFor 從 SHA256SUMS 內容挑出指定檔案的雜湊。
// 接受 sha256sum 的標準格式（"<hex>  <檔名>"，檔名可帶 * 或 ./），大小寫不拘。
func checksumFor(sums, fileName string) string {
	want := strings.ToLower(filepath.Base(fileName))
	for _, line := range strings.Split(sums, "\n") {
		fields := strings.Fields(strings.TrimSpace(line))
		if len(fields) < 2 || len(fields[0]) != 64 {
			continue
		}
		name := filepath.Base(strings.TrimPrefix(fields[1], "*"))
		if strings.ToLower(name) == want {
			return strings.ToLower(fields[0])
		}
	}
	return ""
}

// digestSHA256 取出 asset 自帶的 sha256 digest（較新的 GitHub 才有）。
func digestSHA256(a releaseAsset) string {
	const prefix = "sha256:"
	d := strings.TrimSpace(a.Digest)
	if !strings.HasPrefix(strings.ToLower(d), prefix) {
		return ""
	}
	return strings.ToLower(strings.TrimSpace(d[len(prefix):]))
}

/* ---------------------------------------------------------------------------
   下載狀態
   ----------------------------------------------------------------------------
   單一使用者、單一視窗，所以「同時只允許一個下載」是合理且更安全的簡化：
   避免兩份下載同時寫同一個暫存檔。
   --------------------------------------------------------------------------- */

type updateState struct {
	mu       sync.Mutex
	running  bool
	progress updateProgress
	// 驗證通過的檔案落點；install 只信任這個欄位。
	stagedPath string
	stagedVer  string
	// 這輪是從哪個目錄的更新清單來的。清單裡的相對下載路徑以它為基準，
	// 所以 start 時要把同一個基準（與同一個寬容度）帶回來。
	checkDir      string
	checkAnyLocal bool
}

var updater updateState

func (s *updateState) snapshot() updateProgress {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.progress
}

func (s *updateState) begin() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.running {
		return errors.New("已有更新正在下載")
	}
	s.running = true
	s.progress = updateProgress{}
	s.stagedPath = ""
	s.stagedVer = ""
	return nil
}

func (s *updateState) setPercent(p int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.progress.Percent = p
}

func (s *updateState) finish(path, ver string, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.running = false
	if err != nil {
		s.progress = updateProgress{Error: err.Error()}
		return
	}
	s.stagedPath = path
	s.stagedVer = ver
	s.progress = updateProgress{Percent: 100, Done: true}
}

func (s *updateState) staged() (string, string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.stagedPath, s.stagedVer
}

func (s *updateState) setCheckContext(dir string, anyLocal bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.checkDir = dir
	s.checkAnyLocal = anyLocal
}

func (s *updateState) checkContext() (string, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.checkDir, s.checkAnyLocal
}

/* ---------------------------------------------------------------------------
   位址檢查
   --------------------------------------------------------------------------- */

func checkUpdateURL(raw string) error {
	u, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("更新位址格式錯誤: %w", err)
	}
	// 允許以 http 取得 localhost 清單（開發用），其餘一律要 https。
	host := u.Hostname()
	local := host == "127.0.0.1" || host == "localhost" || host == "::1"
	if u.Scheme != "https" && !(u.Scheme == "http" && local) {
		return errors.New("更新來源必須使用 https")
	}
	if local {
		return nil
	}
	if allowedUpdateHosts[host] {
		return nil
	}
	// 允許子網域（例如 release-assets.githubusercontent.com），但必須落在白名單網域之下。
	for h := range allowedUpdateHosts {
		if strings.HasSuffix(host, "."+h) {
			return nil
		}
	}
	return fmt.Errorf("更新來源主機不在允許清單內: %s", host)
}

/* ---------------------------------------------------------------------------
   取得更新資訊
   ---------------------------------------------------------------------------- */

const (
	// 清單本身很小；1 MiB 已經是極寬裕的護欄。
	maxManifestBytes = 1 << 20
	// 清單查詢逾時。下載 EXE 另有 updateTimeout，兩件事的合理等待時間不同。
	manifestFetchTimeout = 30 * time.Second
)

// readManifest 取得清單原始位元組。本機檔案與網路共用同一條回傳路徑，
// 上層不必為兩種來源各寫一次錯誤處理。
func readManifest(src updateSource) ([]byte, error) {
	return readTextSource(src, maxManifestBytes, "更新清單")
}

// readTextSource 讀一個小型文字資源（清單、校驗碼檔）。
// limit 是硬性上限：這條路徑永遠不會把整份回應讀進記憶體。
func readTextSource(src updateSource, limit int64, what string) ([]byte, error) {
	if src.Err != nil {
		return nil, src.Err
	}
	if src.Kind == "local" {
		f, err := os.Open(src.Path)
		if err != nil {
			return nil, fmt.Errorf("讀不到%s: %w", what, err)
		}
		defer f.Close()
		data, err := io.ReadAll(io.LimitReader(f, limit+1))
		if err != nil {
			return nil, fmt.Errorf("讀取%s失敗: %w", what, err)
		}
		if int64(len(data)) > limit {
			return nil, fmt.Errorf("%s過大，已中止", what)
		}
		return data, nil
	}

	if err := checkUpdateURL(src.URL); err != nil {
		return nil, err
	}
	client := &http.Client{Timeout: manifestFetchTimeout, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 10 {
			return errors.New("too many redirects")
		}
		return checkUpdateURL(req.URL.String())
	}}
	res, err := client.Get(src.URL)
	if err != nil {
		return nil, errors.New(humanNetError(err))
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, fmt.Errorf("取得%s失敗（HTTP %d）", what, res.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, limit+1))
	if err != nil {
		return nil, errors.New(humanNetError(err))
	}
	if int64(len(data)) > limit {
		return nil, fmt.Errorf("%s過大，已中止", what)
	}
	return data, nil
}

// fetchUpdateInfo 讀一個來源的清單並挑出頻道。
// 回傳 (nil, nil) 代表清單有效、但沒有比目前更新的版本 —— 這是「已是最新」，
// 不是錯誤，呼叫端不該把它當失敗顯示。
func fetchUpdateInfo(src updateSource, channel string) (*updateInfo, error) {
	data, err := readManifest(src)
	if err != nil {
		return nil, err
	}
	if src.Release {
		return updateInfoFromReleases(src, data, channel)
	}

	var manifest updateManifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		return nil, fmt.Errorf("更新清單格式錯誤: %w", err)
	}

	info, ok := manifest[channel]
	if !ok || strings.TrimSpace(info.Version) == "" {
		return nil, nil
	}
	if !isNewerVersion(info.Version, appVersion()) {
		return nil, nil
	}

	// 下載位址可以是相對路徑，以清單自己所在的位置為基準。
	// 先擋掉不合法來源，別讓 UI 顯示一個按下去才失敗的按鈕。
	resolved, err := parseUpdateSource(info.URL, src.Dir, src.AnyLocal)
	if err != nil {
		return nil, fmt.Errorf("更新資訊的下載位址無效: %w", err)
	}
	if resolved.Kind == "local" {
		st, statErr := os.Stat(resolved.Path)
		if statErr != nil || st.IsDir() {
			return nil, fmt.Errorf("更新檔不存在: %s", resolved.Path)
		}
	}
	// 回傳正規化後的位址：前端拿到的就是可以直接重送給 start 的絕對位置。
	info.URL = resolved.Label
	return &info, nil
}

// updateInfoFromReleases 把 GitHub Release 清單翻譯成內部既有的 updateInfo 形狀。
//
// 挑選規則：略過 draft 與沒有可安裝 EXE 的 release；stable 頻道只認非預發佈版本，
// beta 頻道兩者都認。接著必須真的比目前版本新，否則回 (nil, nil) 代表「已是最新」。
//
// 校驗碼的來源有兩個，優先順序是「asset 自帶 digest」→「發佈時附上的 SHA256SUMS.txt」。
// 兩者都沒有就不給出下載位址 —— 沒有校驗碼的更新無法被驗證，寧可回報失敗，
// 也不讓「跳過驗證」這條路存在（與 downloadUpdate 的硬性檢查一致）。
func updateInfoFromReleases(src updateSource, data []byte, channel string) (*updateInfo, error) {
	var releases []releaseInfo
	if err := json.Unmarshal(data, &releases); err != nil {
		var single releaseInfo
		if singleErr := json.Unmarshal(data, &single); singleErr != nil || single.TagName == "" {
			return nil, fmt.Errorf("GitHub Release 回應格式錯誤: %w", err)
		}
		releases = []releaseInfo{single}
	}

	allowPre := channel != "stable"
	var (
		pick    *releaseInfo
		pickExe releaseAsset
	)
	for i := range releases {
		r := releases[i]
		if r.Draft || (r.Prerelease && !allowPre) {
			continue
		}
		exe, ok := releaseInstaller(r)
		if !ok || strings.TrimSpace(r.TagName) == "" {
			continue
		}
		// 清單由 GitHub 依發佈時間排序，但版本號不一定遞增；一律挑版本最高的。
		if pick == nil || isNewerVersion(r.TagName, pick.TagName) {
			pick, pickExe = &releases[i], exe
		}
	}
	if pick == nil {
		return nil, errors.New("找不到任何包含 AiCad.exe 的發佈版本")
	}
	if !isNewerVersion(pick.TagName, appVersion()) {
		return nil, nil
	}

	sum := digestSHA256(pickExe)
	if sum == "" {
		if sumsAsset, ok := releaseChecksumAsset(*pick); ok {
			body, err := readTextSource(updateSource{
				Kind: "remote", Label: sumsAsset.URL, URL: sumsAsset.URL, AnyLocal: src.AnyLocal,
			}, maxManifestBytes, "校驗碼檔")
			if err != nil {
				return nil, fmt.Errorf("讀不到校驗碼檔: %w", err)
			}
			sum = checksumFor(string(body), pickExe.Name)
		}
	}
	decodedSum, sumErr := hex.DecodeString(sum)
	if sumErr != nil || len(decodedSum) != sha256.Size {
		return nil, fmt.Errorf("發佈版本 %s 沒有提供 %s 的 SHA-256，已拒絕自動更新", pick.TagName, pickExe.Name)
	}

	if _, err := parseUpdateSource(pickExe.URL, src.Dir, src.AnyLocal); err != nil {
		return nil, err
	}
	notes := strings.TrimSpace(pick.Name)
	if body := strings.TrimSpace(pick.Body); body != "" {
		if notes != "" && !strings.Contains(body, notes) {
			notes = notes + "\n\n" + body
		} else {
			notes = body
		}
	}
	return &updateInfo{
		Version: strings.TrimPrefix(strings.TrimPrefix(pick.TagName, "v"), "V"),
		Notes:   notes,
		URL:     pickExe.URL,
		SHA256:  sum,
		Size:    pickExe.Size,
	}, nil
}

// checkForUpdate 依序嘗試所有來源，第一個成功的勝出。
//
// 全部失敗時，把「試過哪些位置」與「各自的原因」一起回報。先前只回一句網路
// 錯誤，使用者只知道「取得位置失敗」卻不知道程式去哪裡找過 —— 這正是要修掉的
// 體驗問題。訊息最後附上可行動的下一步。
func checkForUpdate(channel string) (*updateInfo, error) {
	sources := updateSources()
	tried := make([]string, 0, len(sources))
	problems := make([]string, 0, len(sources))

	for _, src := range sources {
		tried = append(tried, src.Label)
		info, err := fetchUpdateInfo(src, channel)
		if err != nil {
			problems = append(problems, "・"+src.Label+"："+err.Error())
			continue
		}
		// 記下基準目錄，start 才能解析清單裡的相對路徑。
		updater.setCheckContext(src.Dir, src.AnyLocal)
		if info == nil {
			return nil, nil
		}
		info.Source = src.Label
		return info, nil
	}

	updater.setCheckContext("", false)
	return nil, fmt.Errorf(
		"無法取得更新來源位置。已嘗試：\n%s\n原因：\n%s\n\n"+
			"可行做法：確認可連上 GitHub（預設來源）；或在 AiCad.exe 旁邊放一份 update-manifest.json（"+
			"亦可放 updates 子目錄），清單內的 url 可寫相對檔名；或以環境變數 AICAD_UPDATE_FEED 指定清單位置。",
		strings.Join(tried, "、"), strings.Join(problems, "\n"),
	)
}

/* ---------------------------------------------------------------------------
   版本比較
   ----------------------------------------------------------------------------
   與前端 update.ts 的 compareVersions 同一套規則：只認 major.minor.patch
   加選用的預發佈標記，且有預發佈標記者較舊。兩邊必須一致，否則會出現
   「UI 說有新版、宿主說沒有」的荒謬狀況。
   --------------------------------------------------------------------------- */

func parseVersion(v string) ([3]int, string) {
	v = strings.TrimPrefix(strings.TrimPrefix(strings.TrimSpace(v), "v"), "V")
	core, pre := v, ""
	if i := strings.IndexByte(v, '-'); i >= 0 {
		core, pre = v[:i], v[i+1:]
	}
	var nums [3]int
	for i, part := range strings.SplitN(core, ".", 3) {
		if i > 2 {
			break
		}
		n, err := strconv.Atoi(strings.TrimSpace(part))
		if err != nil {
			n = 0
		}
		nums[i] = n
	}
	return nums, pre
}

func compareVersions(a, b string) int {
	na, pa := parseVersion(a)
	nb, pb := parseVersion(b)
	for i := 0; i < 3; i++ {
		if na[i] != nb[i] {
			if na[i] > nb[i] {
				return 1
			}
			return -1
		}
	}
	switch {
	case pa != "" && pb == "":
		return -1
	case pa == "" && pb != "":
		return 1
	case pa == pb:
		return 0
	case pa > pb:
		return 1
	}
	return -1
}

func isNewerVersion(candidate, current string) bool {
	return compareVersions(candidate, current) > 0
}

/* ---------------------------------------------------------------------------
   暫存目錄
   ----------------------------------------------------------------------------
   刻意放 LocalAppData 而非 EXE 旁邊：下載中的檔案不該汙染安裝位置，
   而且 LocalAppData 一定可寫。
   --------------------------------------------------------------------------- */

func updateStageDir() (string, error) {
	base, err := os.UserCacheDir()
	if err != nil {
		return "", err
	}
	p := filepath.Join(base, "AiCad", "update")
	if err := os.MkdirAll(p, 0o755); err != nil {
		return "", err
	}
	return p, nil
}

/* ---------------------------------------------------------------------------
   啟動時清理
   ----------------------------------------------------------------------------
   上一輪更新留下的 AiCad.exe.old 在當時無法刪除（映像仍在執行）。現在跑的是
   新版，舊檔已無句柄，可以清掉。順手清掉暫存目錄裡的下載殘骸。
   失敗一律忽略：這是整理工作，不該影響啟動。
   --------------------------------------------------------------------------- */

func cleanupAfterUpdate() {
	if exe, err := os.Executable(); err == nil {
		_ = os.Remove(exe + staleSuffix)
	}
	dir, err := updateStageDir()
	if err != nil {
		return
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		info, err := e.Info()
		// 只清超過一天的殘骸，避免誤刪正在進行中的下載。
		if err == nil && time.Since(info.ModTime()) > 24*time.Hour {
			_ = os.Remove(filepath.Join(dir, e.Name()))
		}
	}
}

/* ---------------------------------------------------------------------------
   下載 + 驗證
   --------------------------------------------------------------------------- */

func downloadUpdate(info updateInfo) (string, error) {
	want := strings.ToLower(strings.TrimSpace(info.SHA256))
	if len(want) != 64 {
		// 不給「跳過驗證」的後門。沒有雜湊就不是可安裝的更新。
		return "", errors.New("更新資訊缺少有效的 SHA-256，已中止")
	}

	src, err := downloadSourceFor(info)
	if err != nil {
		return "", err
	}

	dir, err := updateStageDir()
	if err != nil {
		return "", fmt.Errorf("無法建立暫存目錄: %w", err)
	}
	dest := filepath.Join(dir, fmt.Sprintf("AiCad-%s.exe", sanitizeVersion(info.Version)))

	// 本機來源：直接從檔案系統取，同樣要過 SHA-256。這條路讓離線與內網更新
	// 不必先架一台 HTTP 伺服器。
	if src.Kind == "local" {
		f, err := os.Open(src.Path)
		if err != nil {
			return "", fmt.Errorf("讀不到更新檔: %w", err)
		}
		defer f.Close()
		st, err := f.Stat()
		if err != nil {
			return "", fmt.Errorf("讀不到更新檔資訊: %w", err)
		}
		return stageUpdate(dir, dest, want, f, st.Size())
	}

	client := &http.Client{Timeout: updateTimeout}
	res, err := client.Get(src.URL)
	if err != nil {
		return "", errors.New(humanNetError(err))
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return "", fmt.Errorf("下載失敗（HTTP %d）", res.StatusCode)
	}

	total := res.ContentLength
	if total <= 0 {
		total = info.Size
	}
	return stageUpdate(dir, dest, want, res.Body, total)
}

// downloadSourceFor 依 check 階段記下的基準目錄解析下載位址。
// 清單允許寫相對檔名，所以 start 一定要沿用同一份基準，否則相對路徑會解析到
// 錯誤的地方（或直接失敗）。
func downloadSourceFor(info updateInfo) (updateSource, error) {
	baseDir, anyLocal := updater.checkContext()
	return parseUpdateSource(info.URL, baseDir, anyLocal)
}

// 驗證通過才給正式檔名 —— install 看到的檔案因此一定是驗過的。
// 任何失敗路徑都不留半個檔案。
func stageUpdate(dir, dest, want string, body io.Reader, total int64) (string, error) {
	if total > maxUpdateBytes {
		return "", errors.New("更新檔超過允許大小，已中止")
	}

	f, err := os.CreateTemp(dir, "download-*.part")
	if err != nil {
		return "", fmt.Errorf("無法建立暫存檔: %w", err)
	}
	tmpName := f.Name()
	// 任何失敗路徑都不留半個檔案。
	cleanup := func() {
		f.Close()
		_ = os.Remove(tmpName)
	}

	h := sha256.New()
	var written int64
	buf := make([]byte, 256<<10)
	for {
		n, readErr := body.Read(buf)
		if n > 0 {
			written += int64(n)
			if written > maxUpdateBytes {
				cleanup()
				return "", errors.New("更新檔超過允許大小，已中止")
			}
			if _, err := f.Write(buf[:n]); err != nil {
				cleanup()
				return "", fmt.Errorf("寫入暫存檔失敗: %w", err)
			}
			h.Write(buf[:n])
			if total > 0 {
				// 上限 99：100 只在雜湊驗證通過後才給，
				// 否則使用者會看到 100% 然後跳出失敗，觀感很差。
				p := int(written * 99 / total)
				if p > 99 {
					p = 99
				}
				updater.setPercent(p)
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			cleanup()
			return "", errors.New(humanNetError(readErr))
		}
	}

	if err := f.Sync(); err != nil {
		cleanup()
		return "", fmt.Errorf("落盤失敗: %w", err)
	}
	if err := f.Close(); err != nil {
		_ = os.Remove(tmpName)
		return "", fmt.Errorf("關閉暫存檔失敗: %w", err)
	}

	got := hex.EncodeToString(h.Sum(nil))
	if got != want {
		_ = os.Remove(tmpName)
		return "", fmt.Errorf("SHA-256 驗證不符，已刪除下載檔（預期 %s…，實得 %s…）", want[:12], got[:12])
	}

	// 驗證通過才給正式檔名。這樣 install 看到的檔案一定是驗過的。
	_ = os.Remove(dest)
	if err := os.Rename(tmpName, dest); err != nil {
		_ = os.Remove(tmpName)
		return "", fmt.Errorf("無法就位更新檔: %w", err)
	}
	return dest, nil
}

// 版號會進到檔名，先過濾掉路徑分隔符與其他危險字元。
func sanitizeVersion(v string) string {
	var b strings.Builder
	for _, r := range v {
		switch {
		case r >= '0' && r <= '9', r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r == '.', r == '-', r == '_':
			b.WriteRune(r)
		default:
			b.WriteRune('_')
		}
	}
	s := b.String()
	if s == "" {
		return "new"
	}
	if len(s) > 40 {
		return s[:40]
	}
	return s
}

/* ---------------------------------------------------------------------------
   安裝：改名自己 → 就位 → 重啟
   --------------------------------------------------------------------------- */

func installUpdate() error {
	staged, ver := updater.staged()
	if staged == "" {
		return errors.New("尚無已驗證的更新檔，請先下載")
	}
	if _, err := os.Stat(staged); err != nil {
		return fmt.Errorf("更新檔已不存在，請重新下載: %w", err)
	}

	exe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("無法取得執行檔路徑: %w", err)
	}
	exe, err = filepath.EvalSymlinks(exe)
	if err != nil {
		return fmt.Errorf("無法解析執行檔路徑: %w", err)
	}
	dir := filepath.Dir(exe)

	// 先確認目錄可寫，而不是走到一半才失敗。若不可寫（Program Files 等），
	// 明確告知使用者，不偷偷提權。
	probe, err := os.CreateTemp(dir, ".aicad-write-probe-*")
	if err != nil {
		return fmt.Errorf("安裝位置不可寫入：%s\n請把 AiCad.exe 移到使用者目錄（例如桌面或文件），或以管理員身分執行後再更新", dir)
	}
	probeName := probe.Name()
	probe.Close()
	_ = os.Remove(probeName)

	old := exe + staleSuffix
	_ = os.Remove(old) // 上一輪殘留
	// Windows 允許改名正在執行的映像檔，這是整個自我更新的關鍵。
	if err := os.Rename(exe, old); err != nil {
		return fmt.Errorf("無法暫存舊版本: %w", err)
	}

	// 從這裡開始若失敗必須把舊檔改回來，否則使用者會失去可執行檔。
	restore := func() {
		_ = os.Remove(exe)
		_ = os.Rename(old, exe)
	}

	if err := copyFile(staged, exe); err != nil {
		restore()
		return fmt.Errorf("無法寫入新版本: %w", err)
	}

	// 先讓出實例鎖，再啟動新版本：新行程的 main() 會重新建立同名 mutex，
	// 若舊行程還握著它，新行程會直接結束（使用者只看到「關閉但沒重啟」）。
	// 環境變數則告訴新行程「這是一次接手」，讓它在必要時多等一會兒。
	releaseSingleInstance()

	cmd := exec.Command(exe)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), updateHandoffEnv+"=1")
	if err := cmd.Start(); err != nil {
		acquireSingleInstance() // 新版本起不來，把實例鎖拿回來，避免過程中多開
		restore()
		return fmt.Errorf("新版本啟動失敗，已還原舊版本: %w", err)
	}
	// 不 Wait：讓子行程脫離，本行程立刻退場好釋放視窗與埠。
	_ = os.Remove(staged)
	_ = ver

	// 給新行程一點時間把視窗開起來，避免畫面全黑一瞬間。
	go func() {
		time.Sleep(400 * time.Millisecond)
		os.Exit(0)
	}()
	return nil
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o755)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	if err := out.Sync(); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}

/* ---------------------------------------------------------------------------
   HTTP handlers
   ----------------------------------------------------------------------------
   回應形狀沿用 storeReply { ok, data, error }，data 內是 JSON 字串。這樣前端
   host.ts 的 callStore 可以原封不動重用，不必為更新再開一套呼叫慣例。
   --------------------------------------------------------------------------- */

type updateCheckRequest struct {
	Channel string `json:"channel"`
}

func updateCheckHandler(w http.ResponseWriter, r *http.Request) {
	var req updateCheckRequest
	// 空 body 視為預設頻道，不當成錯誤。
	_ = json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&req)

	channel := strings.TrimSpace(req.Channel)
	if channel == "" {
		channel = "stable"
	}
	if channel == "none" {
		// 使用者關掉更新頻道。回傳「已是最新」而不是錯誤 —— UI 不該因此紅字。
		writeStoreJSON(w, storeReply{OK: true})
		return
	}

	info, err := checkForUpdate(channel)
	if err != nil {
		writeStoreJSON(w, storeReply{Error: err.Error()})
		return
	}
	if info == nil {
		// 清單有效但沒有更新的版本。UI 該顯示「已是最新」，不是紅字。
		writeStoreJSON(w, storeReply{OK: true})
		return
	}

	raw, err := json.Marshal(info)
	if err != nil {
		writeStoreJSON(w, storeReply{Error: "更新資訊序列化失敗: " + err.Error()})
		return
	}
	writeStoreJSON(w, storeReply{OK: true, Data: string(raw)})
}

func updateStartHandler(w http.ResponseWriter, r *http.Request) {
	var info updateInfo
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&info); err != nil {
		writeStoreJSON(w, storeReply{Error: "請求格式錯誤: " + err.Error()})
		return
	}
	// 用與 check 相同的基準解析一次：非法來源在這裡就被擋下，不會進到背景
	// goroutine 才失敗（那樣 UI 會先顯示「下載中」再翻臉）。
	if _, err := downloadSourceFor(info); err != nil {
		writeStoreJSON(w, storeReply{Error: err.Error()})
		return
	}
	if err := updater.begin(); err != nil {
		writeStoreJSON(w, storeReply{Error: err.Error()})
		return
	}
	// 立刻回應，下載在背景跑；進度由 /bridge/update/progress 輪詢。
	go func() {
		path, err := downloadUpdate(info)
		updater.finish(path, info.Version, err)
	}()
	writeStoreJSON(w, storeReply{OK: true})
}

func updateProgressHandler(w http.ResponseWriter, _ *http.Request) {
	raw, err := json.Marshal(updater.snapshot())
	if err != nil {
		writeStoreJSON(w, storeReply{Error: "進度序列化失敗: " + err.Error()})
		return
	}
	writeStoreJSON(w, storeReply{OK: true, Data: string(raw)})
}

func updateInstallHandler(w http.ResponseWriter, _ *http.Request) {
	if err := installUpdate(); err != nil {
		writeStoreJSON(w, storeReply{Error: err.Error()})
		return
	}
	writeStoreJSON(w, storeReply{OK: true})
}
