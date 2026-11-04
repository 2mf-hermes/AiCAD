//go:build windows

/* ============================================================================
   宿主端持久化與更新流程的實機測試
   ----------------------------------------------------------------------------
   為什麼要有這一支：使用者的第 2 點（設定不能每次開啟被重置）與第 4 點（更新
   要真的裝起來）都是**跨行程**的行為，光看程式碼看不出對錯。這裡直接把真正的
   handler 掛上 httptest 伺服器，走與前端完全相同的 HTTP 形狀，驗證：

     - 寫入 → （模擬重新啟動）→ 讀回，值必須一模一樣
     - token 閘門對每個端點都生效
     - 更新檢查在 channel=none 時安靜回「已是最新」而非報錯
     - 沒有已驗證檔案時 install 必須拒絕（防止半途安裝）
     - 非白名單來源必須被擋下

   重要：測試會動到真實的 %APPDATA%\AiCad\settings.json。開頭先備份、結束還原，
   不能因為跑測試就把使用者的設定弄掉。
   ========================================================================== */

package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

const testToken = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

func newTestServer(t *testing.T) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.Handle("/bridge/settings/get", requireToken(testToken, http.HandlerFunc(settingsGetHandler)))
	mux.Handle("/bridge/settings/set", requireToken(testToken, http.HandlerFunc(settingsSetHandler)))
	mux.Handle("/bridge/secret/get", requireToken(testToken, http.HandlerFunc(secretGetHandler)))
	mux.Handle("/bridge/secret/set", requireToken(testToken, http.HandlerFunc(secretSetHandler)))
	mux.Handle("/bridge/project/list", requireToken(testToken, http.HandlerFunc(projectListHandler)))
	mux.Handle("/bridge/project/get", requireToken(testToken, http.HandlerFunc(projectGetHandler)))
	mux.Handle("/bridge/project/save", requireToken(testToken, http.HandlerFunc(projectSaveHandler)))
	mux.Handle("/bridge/project/delete", requireToken(testToken, http.HandlerFunc(projectDeleteHandler)))
	mux.Handle("/bridge/update/check", requireToken(testToken, http.HandlerFunc(updateCheckHandler)))
	mux.Handle("/bridge/update/start", requireToken(testToken, http.HandlerFunc(updateStartHandler)))
	mux.Handle("/bridge/update/progress", requireToken(testToken, http.HandlerFunc(updateProgressHandler)))
	mux.Handle("/bridge/update/install", requireToken(testToken, http.HandlerFunc(updateInstallHandler)))
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

func call(t *testing.T, srv *httptest.Server, path, body string, withToken bool) (int, storeReply) {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, srv.URL+path, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	if withToken {
		req.Header.Set("X-AiCad-Token", testToken)
	}
	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var reply storeReply
	if res.StatusCode == http.StatusOK {
		if err := json.NewDecoder(res.Body).Decode(&reply); err != nil {
			t.Fatalf("%s 回應不是合法 JSON: %v", path, err)
		}
	}
	return res.StatusCode, reply
}

// 備份使用者真實的設定檔，測試結束後還原。
func protectRealSettings(t *testing.T) {
	t.Helper()
	path, err := storePath(settingsFile)
	if err != nil {
		t.Fatalf("無法定位設定目錄: %v", err)
	}
	original, readErr := os.ReadFile(path)
	t.Cleanup(func() {
		if readErr == nil {
			_ = os.WriteFile(path, original, 0o600)
		} else {
			_ = os.Remove(path)
		}
	})
}

/* --------------------------------------------------------------------------- */

// 這是第 2 點的核心證明：設定寫進去，重新讀出來還在。
// 兩次 GET 之間沒有任何共享記憶體狀態 —— 值只可能來自檔案系統。
func TestSettingsSurviveRestart(t *testing.T) {
	protectRealSettings(t)
	srv := newTestServer(t)

	payload := `{"locale":"ja","updates":{"autoCheck":false,"channel":"none","lastCheckedAt":"2026-08-31T09:00:00Z"},"canvas":{"grid":true}}`
	body, _ := json.Marshal(storeRequest{Data: payload})

	if code, reply := call(t, srv, "/bridge/settings/set", string(body), true); code != 200 || !reply.OK {
		t.Fatalf("寫入失敗: HTTP %d, %+v", code, reply)
	}

	// 模擬「關閉 App 再開啟」：新的 handler 呼叫、無任何快取。
	code, reply := call(t, srv, "/bridge/settings/get", `{}`, true)
	if code != 200 || !reply.OK {
		t.Fatalf("讀取失敗: HTTP %d, %+v", code, reply)
	}
	if reply.Data != payload {
		t.Fatalf("設定沒有被完整保存\n寫入: %s\n讀回: %s", payload, reply.Data)
	}

	// 附帶確認 locale 真的落在檔案裡（第 1 點的語言設定會走這條路）。
	var parsed map[string]any
	if err := json.Unmarshal([]byte(reply.Data), &parsed); err != nil {
		t.Fatalf("讀回的內容不是合法 JSON: %v", err)
	}
	if parsed["locale"] != "ja" {
		t.Fatalf("locale 應為 ja，實得 %v", parsed["locale"])
	}
}

// BOM 回歸測試：使用者用記事本或 PowerShell 改過 settings.json 之後，檔案開頭
// 會多三個 byte。JSON.parse 遇到 BOM 直接拋錯，前端就退回預設值並寫回 ——
// 對使用者而言就是「設定又被重置了」。宿主必須在讀取時吃掉 BOM。
func TestSettingsTolerateUTF8BOM(t *testing.T) {
	protectRealSettings(t)
	srv := newTestServer(t)

	path, err := storePath(settingsFile)
	if err != nil {
		t.Fatalf("無法定位設定檔: %v", err)
	}
	payload := `{"language":"ko","theme":"dark"}`
	withBOM := append([]byte{0xEF, 0xBB, 0xBF}, []byte(payload)...)
	if err := os.WriteFile(path, withBOM, 0o600); err != nil {
		t.Fatalf("無法寫入帶 BOM 的測試檔: %v", err)
	}

	_, reply := call(t, srv, "/bridge/settings/get", `{}`, true)
	if !reply.OK {
		t.Fatalf("讀取失敗: %+v", reply)
	}
	if reply.Data != payload {
		t.Fatalf("BOM 未被去除\n預期: %s\n實得: %q", payload, reply.Data)
	}
	// 最終證明：回傳的內容前端解析得動。
	var parsed map[string]any
	if err := json.Unmarshal([]byte(reply.Data), &parsed); err != nil {
		t.Fatalf("帶 BOM 的設定讀回後仍無法解析: %v", err)
	}
	if parsed["language"] != "ko" {
		t.Fatalf("language 應為 ko，實得 %v", parsed["language"])
	}
}

// 壞掉的 JSON 不能寫進檔案，否則下次啟動會讀到損毀的設定 —— 那正是
// 「設定被重置」的另一種成因。
func TestSettingsRejectInvalidJSON(t *testing.T) {
	protectRealSettings(t)
	srv := newTestServer(t)

	body, _ := json.Marshal(storeRequest{Data: "{not json"})
	_, reply := call(t, srv, "/bridge/settings/set", string(body), true)
	if reply.OK || reply.Error == "" {
		t.Fatalf("應拒絕非法 JSON，實得 %+v", reply)
	}
}

// DPAPI 加密的憑證保管：寫入後讀回應為原文，且落地檔案不得含明文。
func TestSecretRoundTripEncrypted(t *testing.T) {
	srv := newTestServer(t)
	path, err := storePath(secretsFile)
	if err != nil {
		t.Fatalf("無法定位憑證檔: %v", err)
	}
	original, readErr := os.ReadFile(path)
	t.Cleanup(func() {
		if readErr == nil {
			_ = os.WriteFile(path, original, 0o600)
		} else {
			_ = os.Remove(path)
		}
	})

	const ref = "aicad-selftest"
	const secret = "sk-selftest-PLAINTEXT-MARKER-9182"

	body, _ := json.Marshal(secretsRequest{Ref: ref, Value: secret})
	if _, reply := call(t, srv, "/bridge/secret/set", string(body), true); !reply.OK {
		t.Fatalf("寫入憑證失敗: %+v", reply)
	}

	get, _ := json.Marshal(secretsRequest{Ref: ref})
	_, reply := call(t, srv, "/bridge/secret/get", string(get), true)
	if !reply.OK || reply.Data != secret {
		t.Fatalf("憑證讀回不符: %+v", reply)
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("憑證檔應存在: %v", err)
	}
	if strings.Contains(string(raw), "PLAINTEXT-MARKER") {
		t.Fatal("憑證檔含明文 — DPAPI 加密沒有生效")
	}
}

// 每個端點都必須要 token。少一個就是機器上其他程式的入口。
func TestAllBridgeEndpointsRequireToken(t *testing.T) {
	srv := newTestServer(t)
	paths := []string{
		"/bridge/settings/get", "/bridge/settings/set",
		"/bridge/secret/get", "/bridge/secret/set",
		"/bridge/update/check", "/bridge/update/start",
		"/bridge/update/progress", "/bridge/update/install",
		"/bridge/project/list", "/bridge/project/get",
		"/bridge/project/save", "/bridge/project/delete",
	}
	for _, p := range paths {
		if code, _ := call(t, srv, p, `{}`, false); code != http.StatusForbidden {
			t.Errorf("%s 未帶 token 應回 403，實得 %d", p, code)
		}
	}
}

// GET 也該被擋 —— 只接受 POST，避免被 <img src> 之類的方式觸發。
func TestBridgeRejectsGet(t *testing.T) {
	srv := newTestServer(t)
	res, err := srv.Client().Get(srv.URL + "/bridge/settings/get")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("GET 應回 405，實得 %d", res.StatusCode)
	}
}

/* --------------------------------------------------------------------------- */

// channel=none 表示使用者主動關閉更新。這時不該回錯誤（UI 會紅字），
// 而該安靜地回「已是最新」。
func TestUpdateCheckChannelNoneIsQuiet(t *testing.T) {
	srv := newTestServer(t)
	_, reply := call(t, srv, "/bridge/update/check", `{"channel":"none"}`, true)
	if !reply.OK || reply.Error != "" || reply.Data != "" {
		t.Fatalf("channel=none 應安靜回 ok 且無資料，實得 %+v", reply)
	}
}

// 沒有經過下載與驗證就按安裝，必須被拒絕。
func TestInstallWithoutStagedFileFails(t *testing.T) {
	srv := newTestServer(t)
	_, reply := call(t, srv, "/bridge/update/install", `{}`, true)
	if reply.OK || reply.Error == "" {
		t.Fatalf("無已驗證檔案時 install 應失敗，實得 %+v", reply)
	}
}

// 更新來源白名單：任意網域不得成為程式碼下載器。
func TestUpdateURLAllowlist(t *testing.T) {
	bad := []string{
		"http://evil.example.com/AiCad.exe", // 非 https
		"https://evil.example.com/AiCad.exe",
		"https://github.com.evil.example.com/AiCad.exe", // 後綴混淆
		"file:///C:/Windows/System32/calc.exe",
	}
	for _, u := range bad {
		if err := checkUpdateURL(u); err == nil {
			t.Errorf("應拒絕 %s", u)
		}
	}
	good := []string{
		"https://api.github.com/repos/2mf-hermes/AiCAD/releases",
		"https://github.com/2mf-hermes/AiCAD/releases/download/v0.2.0/AiCad.exe",
		"https://release-assets.githubusercontent.com/x/AiCad.exe",
		"https://objects.githubusercontent.com/x/AiCad.exe",
		"http://127.0.0.1:9000/manifest.json", // 本機開發
	}
	for _, u := range good {
		if err := checkUpdateURL(u); err != nil {
			t.Errorf("應接受 %s，實得 %v", u, err)
		}
	}
}

// start 端點也要擋掉非法來源，否則進到背景 goroutine 才失敗，UI 會先顯示下載中。
func TestUpdateStartRejectsBadURL(t *testing.T) {
	srv := newTestServer(t)
	_, reply := call(t, srv, "/bridge/update/start",
		`{"version":"9.9.9","url":"https://evil.example.com/x.exe","sha256":"`+strings.Repeat("a", 64)+`"}`, true)
	if reply.OK || reply.Error == "" {
		t.Fatalf("應拒絕非白名單來源，實得 %+v", reply)
	}
}

// 缺 SHA-256 的更新不可下載 —— 不提供「跳過驗證」的路徑。
func TestDownloadRequiresHash(t *testing.T) {
	_, err := downloadUpdate(updateInfo{
		Version: "9.9.9",
		URL:     "https://github.com/2mf-hermes/AiCAD/releases/download/v9.9.9/AiCad.exe",
		SHA256:  "",
	})
	if err == nil || !strings.Contains(err.Error(), "SHA-256") {
		t.Fatalf("應因缺少雜湊而拒絕，實得 %v", err)
	}
}

// 版本比較必須與前端 update.ts 的規則一致，否則會出現
// 「UI 說有新版、宿主說沒有」的矛盾。
func TestVersionComparisonMatchesFrontend(t *testing.T) {
	cases := []struct {
		a, b string
		want int
	}{
		{"0.2.0", "0.1.0", 1},
		{"0.1.0", "0.1.0", 0},
		{"0.1.0", "0.2.0", -1},
		{"1.0.0", "0.9.9", 1},
		{"0.2.0", "0.2.0-rc1", 1}, // 預發佈較舊
		{"0.2.0-rc1", "0.2.0", -1},
		{"v0.3.0", "0.2.9", 1}, // 容忍 v 前綴
		{"0.10.0", "0.9.0", 1}, // 數值比較，非字串比較
	}
	for _, c := range cases {
		if got := compareVersions(c.a, c.b); got != c.want {
			t.Errorf("compareVersions(%q,%q) = %d, 應為 %d", c.a, c.b, got, c.want)
		}
	}
}

func TestBridgeForwardsMultipartImageEdit(t *testing.T) {
	imagePNG := []byte("\x89PNG\r\n\x1a\nimage")
	maskPNG := []byte("\x89PNG\r\n\x1a\nmask")
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/form-data; boundary=") {
			t.Fatalf("Content-Type 不是 multipart: %q", r.Header.Get("Content-Type"))
		}
		if got := r.Header.Get("Authorization"); got != "Bearer test-key" {
			t.Fatalf("Authorization 未保留: %q", got)
		}
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			t.Fatalf("無法解析 multipart: %v", err)
		}
		for key, want := range map[string]string{"prompt": "replace bearing", "model": "gpt-image-1", "size": "1024x1024"} {
			if got := r.FormValue(key); got != want {
				t.Errorf("欄位 %s = %q，預期 %q", key, got, want)
			}
		}
		for field, expected := range map[string][]byte{"image": imagePNG, "mask": maskPNG} {
			file, header, err := r.FormFile(field)
			if err != nil {
				t.Fatalf("缺少 %s: %v", field, err)
			}
			got, _ := io.ReadAll(file)
			_ = file.Close()
			if header.Filename != field+".png" || header.Header.Get("Content-Type") != "image/png" || !bytes.Equal(got, expected) {
				t.Errorf("%s 檔案不符: filename=%q type=%q bytes=%x", field, header.Filename, header.Header.Get("Content-Type"), got)
			}
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"data":[{"b64_json":"edited"}]}`)
	}))
	defer upstream.Close()

	bridge := httptest.NewServer(bridgeHandler(testToken))
	defer bridge.Close()
	payload, _ := json.Marshal(bridgeRequest{
		URL: upstream.URL + "/v1/images/edits", Method: http.MethodPost, TimeoutMs: 5_000,
		Headers: map[string]string{"Authorization": "Bearer test-key"},
		Multipart: []multipartPart{
			{Name: "image", Filename: "image.png", ContentType: "image/png", Base64: base64.StdEncoding.EncodeToString(imagePNG)},
			{Name: "mask", Filename: "mask.png", ContentType: "image/png", Base64: base64.StdEncoding.EncodeToString(maskPNG)},
			{Name: "prompt", Value: "replace bearing"},
			{Name: "model", Value: "gpt-image-1"},
			{Name: "size", Value: "1024x1024"},
		},
	})
	req, _ := http.NewRequest(http.MethodPost, bridge.URL, bytes.NewReader(payload))
	req.Header.Set("X-AiCad-Token", testToken)
	res, err := bridge.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var reply bridgeResponse
	if err := json.NewDecoder(res.Body).Decode(&reply); err != nil {
		t.Fatal(err)
	}
	if !reply.OK || reply.Status != http.StatusOK || !strings.Contains(reply.Text, `"edited"`) {
		t.Fatalf("bridge 回應不符: %+v", reply)
	}
}
