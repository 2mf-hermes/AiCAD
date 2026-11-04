//go:build windows

/* ============================================================================
   GitHub Release 更新來源的迴歸測試

   官方更新來源改成 GitHub Release 之後，這裡釘住三件事：

     1. 頻道語意不變：stable 只認一般版本，beta 才看得到預發佈；草稿一律略過。
     2. 校驗碼不可少：優先取 asset 自帶的 sha256 digest，其次讀發佈時附上的
        SHA256SUMS.txt；兩者都沒有就拒絕更新，而不是放行未驗證的檔案。
     3. 主機白名單仍然把關：release 附件指向白名單外的網域時，即使格式正確也要擋下。

   最後兩支是純函式的邊界：沒有 EXE 附件、版本不比目前新、非 JSON 回應，
   以及 sha256sum 檔案的解析。
   ========================================================================== */

package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const testSum = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

func releaseSource() updateSource {
	return updateSource{Kind: "remote", Label: defaultFeedURL, URL: defaultFeedURL, Release: true}
}

// releaseJSON 造一份假的 release 清單：太舊的一般版本、較新的一般版本、
// 較新的預發佈版本、以及一個不該出現的草稿。
func releaseJSON(t *testing.T) string {
	t.Helper()
	body := []map[string]any{
		{"tag_name": "v0.1.0", "name": "0.1.0", "assets": []map[string]any{
			{"name": "AiCad.exe", "browser_download_url": "https://github.com/2mf-hermes/AiCAD/releases/download/v0.1.0/AiCad.exe", "size": 10},
		}},
		{"tag_name": "v" + newerVersion, "name": "AiCad " + newerVersion, "body": "修正更新來源",
			"assets": []map[string]any{
				{"name": "AiCad.exe", "browser_download_url": "https://github.com/2mf-hermes/AiCAD/releases/download/v" + newerVersion + "/AiCad.exe", "size": 7206400, "digest": "sha256:" + testSum},
			}},
		{"tag_name": "v999.0.0", "name": "beta", "prerelease": true, "assets": []map[string]any{
			{"name": "AiCad.exe", "browser_download_url": "https://github.com/2mf-hermes/AiCAD/releases/download/v999.0.0/AiCad.exe", "size": 1, "digest": "sha256:" + strings.Repeat("b", 64)},
		}},
		{"tag_name": "v888.0.0", "name": "draft", "draft": true, "assets": []map[string]any{
			{"name": "AiCad.exe", "browser_download_url": "https://github.com/2mf-hermes/AiCAD/releases/download/v888.0.0/AiCad.exe", "size": 1},
		}},
	}
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

// stable 略過預發佈與草稿；beta 看得到預發佈版本。
func TestReleaseChannelSelection(t *testing.T) {
	info, err := updateInfoFromReleases(releaseSource(), []byte(releaseJSON(t)), "stable")
	if err != nil {
		t.Fatalf("stable 應解析成功，實得 %v", err)
	}
	if info.Version != newerVersion {
		t.Errorf("stable 應挑到 %s，實得 %q", newerVersion, info.Version)
	}
	if !strings.Contains(info.URL, "v"+newerVersion+"/AiCad.exe") {
		t.Errorf("下載位址不符: %q", info.URL)
	}
	if !strings.Contains(info.Notes, "修正更新來源") {
		t.Errorf("說明應帶出 release 內容，實得 %q", info.Notes)
	}
	if info.SHA256 != testSum {
		t.Errorf("校驗碼應取自 asset digest，實得 %q", info.SHA256)
	}
	if info.Size != 7206400 {
		t.Errorf("大小應帶出，實得 %d", info.Size)
	}

	beta, err := updateInfoFromReleases(releaseSource(), []byte(releaseJSON(t)), "beta")
	if err != nil {
		t.Fatalf("beta 應解析成功，實得 %v", err)
	}
	if beta.Version != "999.0.0" {
		t.Errorf("beta 應挑到預發佈版本，實得 %q", beta.Version)
	}
}

// 沒有 asset digest 時，退回讀發佈時附上的 SHA256SUMS.txt。
func TestReleaseChecksumSidecar(t *testing.T) {
	var hits int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		if !strings.HasSuffix(r.URL.Path, checksumAssetName) {
			t.Errorf("不應抓取 %s", r.URL.Path)
		}
		_, _ = w.Write([]byte(testSum + "  AiCad.exe\n" + strings.Repeat("f", 64) + "  other.zip\n"))
	}))
	defer srv.Close()

	assets := []map[string]any{
		{"name": "AiCad.exe", "browser_download_url": "https://github.com/2mf-hermes/AiCAD/releases/download/v" + newerVersion + "/AiCad.exe", "size": 12},
		{"name": checksumAssetName, "browser_download_url": srv.URL + "/" + checksumAssetName},
	}
	raw, err := json.Marshal([]map[string]any{{"tag_name": "v" + newerVersion, "assets": assets}})
	if err != nil {
		t.Fatal(err)
	}

	src := releaseSource()
	src.AnyLocal = true // 測試伺服器在 localhost，等同開發環境
	info, err := updateInfoFromReleases(src, raw, "stable")
	if err != nil {
		t.Fatalf("應解析成功，實得 %v", err)
	}
	if info.SHA256 != testSum {
		t.Errorf("校驗碼應取自 SHA256SUMS.txt，實得 %q", info.SHA256)
	}
	if hits != 1 {
		t.Errorf("應只抓一次校驗碼檔，實得 %d", hits)
	}
}

// 缺少校驗碼時必須拒絕更新。
func TestReleaseWithoutChecksumIsRejected(t *testing.T) {
	raw, err := json.Marshal([]map[string]any{{"tag_name": "v" + newerVersion, "assets": []map[string]any{
		{"name": "AiCad.exe", "browser_download_url": "https://github.com/2mf-hermes/AiCAD/releases/download/v" + newerVersion + "/AiCad.exe"},
	}}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := updateInfoFromReleases(releaseSource(), raw, "stable"); err == nil {
		t.Error("缺少校驗碼時應拒絕")
	}
}

// release 附件指向白名單外主機時，即使有校驗碼也要擋下。
func TestReleaseAssetOutsideAllowlistIsRejected(t *testing.T) {
	raw, err := json.Marshal([]map[string]any{{"tag_name": "v" + newerVersion, "assets": []map[string]any{
		{"name": "AiCad.exe", "browser_download_url": "https://evil.example.com/AiCad.exe", "digest": "sha256:" + testSum},
	}}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := updateInfoFromReleases(releaseSource(), raw, "stable"); err == nil {
		t.Error("非白名單主機應被拒絕")
	}
}

// 沒有 EXE 附件＝失敗；版本不比目前新＝已最新；非 JSON＝格式錯誤。
func TestReleaseNoInstallerAndUpToDate(t *testing.T) {
	noExe, err := json.Marshal([]map[string]any{{"tag_name": "v" + newerVersion, "assets": []map[string]any{
		{"name": "AiCad.zip", "browser_download_url": "https://github.com/2mf-hermes/AiCAD/releases/download/v" + newerVersion + "/AiCad.zip"},
	}}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := updateInfoFromReleases(releaseSource(), noExe, "stable"); err == nil {
		t.Error("沒有 EXE 附件時應回報失敗")
	}

	old, err := json.Marshal([]map[string]any{{"tag_name": "v0.0.1", "assets": []map[string]any{
		{"name": "AiCad.exe", "browser_download_url": "https://github.com/2mf-hermes/AiCAD/releases/download/v0.0.1/AiCad.exe", "digest": "sha256:" + testSum},
	}}})
	if err != nil {
		t.Fatal(err)
	}
	info, err := updateInfoFromReleases(releaseSource(), old, "stable")
	if err != nil || info != nil {
		t.Errorf("舊版本應回報已最新（nil, nil），實得 %+v / %v", info, err)
	}

	if _, err := updateInfoFromReleases(releaseSource(), []byte("<html>not json</html>"), "stable"); err == nil {
		t.Error("非 JSON 回應應回報格式錯誤")
	}
}

// checksumFor 要讀得懂 sha256sum 的標準格式（註解、空行、`*` 與路徑都要能處理）。
func TestChecksumForParsesSumFile(t *testing.T) {
	sums := "# comment\n\n" + testSum + " *./AiCad.exe\n" + strings.Repeat("a", 63) + "  bad.exe\n"
	if got := checksumFor(sums, "AiCad.exe"); got != testSum {
		t.Errorf("應取出 %s，實得 %q", testSum, got)
	}
	if got := checksumFor(sums, "missing.exe"); got != "" {
		t.Errorf("找不到時應回空字串，實得 %q", got)
	}
}

// isReleaseAPI 決定回應要用哪種形狀解讀：只有 GitHub releases API 才算。
func TestIsReleaseAPI(t *testing.T) {
	yes := []string{
		defaultFeedURL,
		"https://api.github.com/repos/2mf-hermes/AiCAD/releases/latest",
	}
	for _, u := range yes {
		if !isReleaseAPI(u) {
			t.Errorf("%s 應判為 release API", u)
		}
	}
	no := []string{
		"https://github.com/2mf-hermes/AiCAD/releases/download/v0.2.0/AiCad.exe",
		"https://example.com/releases",
		"https://api.github.com/repos/2mf-hermes/AiCAD",
		"not a url",
	}
	for _, u := range no {
		if isReleaseAPI(u) {
			t.Errorf("%s 不應判為 release API", u)
		}
	}
}
