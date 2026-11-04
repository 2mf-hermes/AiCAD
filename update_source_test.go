//go:build windows

/* ============================================================================
   更新來源解析的迴歸測試
   ----------------------------------------------------------------------------
   這支測試對應使用者回報的「更新程序取得位置失敗」。

   病根不是網路斷線，而是程式只認一個寫死的雲端清單位址：那個位址還沒上線、
   被擋、或使用者根本在離線環境時，流程就只能回一句網路錯誤，而「位置」到底
   是哪裡、還能去哪裡找，使用者一概看不到。

   修正後的行為要在這裡被釘住：
     1. 依序嘗試多個來源，第一個成功的勝出，並記下它是誰（UpdateInfo.Source）
     2. 本機清單（EXE 旁、updates\ 子目錄、使用者快取）可以當來源
     3. 清單內可用相對檔名，以清單自己所在目錄為基準
     4. 全部失敗時，錯誤訊息必須列出「試過哪些位置」與各自原因，並給出下一步
     5. 放寬的本機來源不得變成任意檔案下載器 —— 程式目錄外的路徑仍要擋下來

   測試會在使用者快取目錄下建暫存資料夾，結束即刪除。
   ========================================================================== */

package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// 清單一定比目前版本新，否則 fetchUpdateInfo 會回「已是最新」。
const newerVersion = "99.0.0"

func writeManifest(t *testing.T, path string, body map[string]any) {
	t.Helper()
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, raw, 0o644); err != nil {
		t.Fatal(err)
	}
}

// ---------------------------------------------------------------------------
// 解析層
// ---------------------------------------------------------------------------

func TestParseUpdateSourceRemoteRules(t *testing.T) {
	if src, err := parseUpdateSource(" https://github.com/2mf-hermes/AiCAD/releases/download/v0.2.0/AiCad.exe ", "", false); err != nil {
		t.Errorf("https 白名單來源應被接受，實得 %v", err)
	} else if src.Kind != "remote" {
		t.Errorf("應判為 remote，實得 %q", src.Kind)
	} else if src.Release {
		t.Error("一般下載網址不應被當成 release API")
	}

	// 官方來源是 releases API；這條判斷決定回應要用哪種形狀解讀。
	if src, err := parseUpdateSource(defaultFeedURL, "", false); err != nil {
		t.Errorf("預設來源應被接受，實得 %v", err)
	} else if !src.Release {
		t.Errorf("預設來源應標記為 release，實得 %+v", src)
	}

	bad := []string{
		"http://api.github.com/repos/2mf-hermes/AiCAD/releases",
		"https://evil.example.com/AiCad.exe",
		"file:///C:/Windows/System32/calc.exe",
		"",
	}
	for _, spec := range bad {
		if _, err := parseUpdateSource(spec, "", false); err == nil {
			t.Errorf("應拒絕 %q", spec)
		}
	}
}

// 相對路徑是離線發布的關鍵：清單跟 EXE 放一起，裡面只寫檔名。
func TestParseUpdateSourceRelativeUsesBaseDir(t *testing.T) {
	base := appDir()
	if base == "" {
		t.Skip("無法取得執行檔目錄")
	}
	src, err := parseUpdateSource("AiCad-99.0.0.exe", base, false)
	if err != nil {
		t.Fatalf("程式目錄內的相對路徑應被接受，實得 %v", err)
	}
	want := filepath.Join(base, "AiCad-99.0.0.exe")
	if src.Path != want {
		t.Errorf("應解析為 %s，實得 %s", want, src.Path)
	}
	if src.Dir != base {
		t.Errorf("基準目錄應為 %s，實得 %s", base, src.Dir)
	}

	// 沒有基準目錄就無法解析相對路徑 —— 必須報錯而不是猜。
	if _, err := parseUpdateSource("AiCad.exe", "", false); err == nil {
		t.Error("缺少基準目錄時應報錯")
	}
}

// 放寬本機來源時，不能順手變成「下載任意路徑」的管道。
func TestParseUpdateSourceRejectsOutsideAppDirs(t *testing.T) {
	outside := filepath.Join(t.TempDir(), "evil.exe")
	if _, err := parseUpdateSource(outside, "", false); err == nil {
		t.Fatalf("程式目錄外的本機來源應被拒絕: %s", outside)
	}
	// 即使偽裝成 file:// 也不行。
	if _, err := parseUpdateSource("file:///"+filepath.ToSlash(strings.TrimPrefix(outside, `\`)), "", false); err == nil {
		t.Error("file:// 形式的程式目錄外來源應被拒絕")
	}
	// 但由啟動環境明確指定時（AICAD_UPDATE_FEED）允許 —— 那等同操作者自己的參數。
	if _, err := parseUpdateSource(outside, "", true); err != nil {
		t.Errorf("明確指定的本機來源應被接受，實得 %v", err)
	}
}

// ---------------------------------------------------------------------------
// 來源清單
// ---------------------------------------------------------------------------

// 明確設了 AICAD_UPDATE_FEED 就只試那一個：覆蓋行為必須可預期。
func TestUpdateSourcesEnvOverrideWinsAlone(t *testing.T) {
	dir := t.TempDir()
	feed := filepath.Join(dir, "update-manifest.json")
	writeManifest(t, feed, map[string]any{})

	t.Setenv("AICAD_UPDATE_FEED", feed)
	sources := updateSources()
	if len(sources) != 1 {
		t.Fatalf("覆蓋時應只有一個來源，實得 %d 個: %+v", len(sources), sources)
	}
	if sources[0].Kind != "local" || sources[0].Path != feed {
		t.Fatalf("應指向覆蓋位置，實得 %+v", sources[0])
	}
	if !sources[0].AnyLocal {
		t.Error("覆蓋來源應允許任意本機路徑")
	}
}

// 沒設定覆蓋時，最後一定要有官方網址這條後路 —— 否則線上使用者永遠收不到更新。
func TestUpdateSourcesFallsBackToOfficialFeed(t *testing.T) {
	t.Setenv("AICAD_UPDATE_FEED", "")
	sources := updateSources()
	if len(sources) == 0 {
		t.Fatal("至少要有一個來源")
	}
	last := sources[len(sources)-1]
	if last.Kind != "remote" || last.URL != defaultFeedURL {
		t.Fatalf("最後一個來源應為官方網址，實得 %+v", last)
	}
}

// ---------------------------------------------------------------------------
// 端到端：清單在 EXE 旁邊
// ---------------------------------------------------------------------------

// 這是修正的核心情境：沒有雲端站台、沒有網路，更新仍然要能被找到。
func TestCheckForUpdateFindsLocalManifestNextToExe(t *testing.T) {
	t.Setenv("AICAD_UPDATE_FEED", "")
	dir := appDir()
	if dir == "" {
		t.Skip("無法取得執行檔目錄")
	}
	exeName := "AiCad-" + newerVersion + ".exe"
	exePath := filepath.Join(dir, exeName)
	if err := os.WriteFile(exePath, []byte("stub"), 0o644); err != nil {
		t.Skipf("執行檔目錄不可寫：%v", err)
	}
	manifest := filepath.Join(dir, "update-manifest.json")
	writeManifest(t, manifest, map[string]any{
		"stable": map[string]any{
			"version": newerVersion,
			// 相對檔名：與清單放在一起。
			"url":    exeName,
			"sha256": strings.Repeat("a", 64),
			"notes":  "離線更新測試",
		},
	})
	t.Cleanup(func() {
		_ = os.Remove(manifest)
		_ = os.Remove(exePath)
	})

	info, err := checkForUpdate("stable")
	if err != nil {
		t.Fatalf("本機清單應被找到，實得錯誤: %v", err)
	}
	if info == nil {
		t.Fatal("應回報有新版本")
	}
	if info.Version != newerVersion {
		t.Errorf("版本應為 %s，實得 %s", newerVersion, info.Version)
	}
	// 相對路徑必須被正規化成絕對位置，前端才可能原樣送回來下載。
	if !filepath.IsAbs(info.URL) {
		t.Errorf("下載位址應被正規化為絕對路徑，實得 %s", info.URL)
	}
	if info.URL != exePath {
		t.Errorf("下載位址應為 %s，實得 %s", exePath, info.URL)
	}
	// 來源要回報給 UI，使用者才知道這次是從哪裡拿到的。
	if info.Source == "" {
		t.Error("應記錄來源位置")
	}

	// 有了基準目錄，下載端要能把同一個位址解回來。
	base, anyLocal := updater.checkContext()
	src, err := parseUpdateSource(info.URL, base, anyLocal)
	if err != nil {
		t.Fatalf("下載前解析應成功，實得 %v", err)
	}
	if src.Path != exePath {
		t.Errorf("解析結果應為 %s，實得 %s", exePath, src.Path)
	}
}

// 清單有效但沒有新版本 = 「已是最新」，不是錯誤。UI 不該紅字。
func TestCheckForUpdateUpToDateIsNotAnError(t *testing.T) {
	t.Setenv("AICAD_UPDATE_FEED", "")
	dir := appDir()
	if dir == "" {
		t.Skip("無法取得執行檔目錄")
	}
	manifest := filepath.Join(dir, "update-manifest.json")
	writeManifest(t, manifest, map[string]any{
		"stable": map[string]any{
			"version": "0.0.1",
			"url":     "https://dl.aicad.app/AiCad.exe",
			"sha256":  strings.Repeat("b", 64),
		},
	})
	t.Cleanup(func() { _ = os.Remove(manifest) })

	info, err := checkForUpdate("stable")
	if err != nil {
		t.Fatalf("較舊版本不應報錯，實得 %v", err)
	}
	if info != nil {
		t.Fatalf("較舊版本不應回報可更新，實得 %+v", info)
	}
}

// 清單裡指向程式目錄外，必須在「顯示可更新」之前就被擋下。
func TestCheckForUpdateRejectsManifestEscapingAppDir(t *testing.T) {
	t.Setenv("AICAD_UPDATE_FEED", "")
	dir := appDir()
	if dir == "" {
		t.Skip("無法取得執行檔目錄")
	}
	manifest := filepath.Join(dir, "update-manifest.json")
	writeManifest(t, manifest, map[string]any{
		"stable": map[string]any{
			"version": newerVersion,
			"url":     filepath.Join(t.TempDir(), "evil.exe"),
			"sha256":  strings.Repeat("c", 64),
		},
	})
	t.Cleanup(func() { _ = os.Remove(manifest) })

	if _, err := checkForUpdate("stable"); err == nil {
		t.Fatal("清單指向程式目錄外時應失敗")
	}
}

// ---------------------------------------------------------------------------
// 失敗時的可診斷性 —— 這就是原本「取得位置失敗」的體驗問題
// ---------------------------------------------------------------------------

func TestCheckForUpdateFailureExplainsWhereItLooked(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "not-there", "update-manifest.json")
	t.Setenv("AICAD_UPDATE_FEED", missing)

	info, err := checkForUpdate("stable")
	if err == nil {
		t.Fatalf("來源不存在時應失敗，實得 %+v", info)
	}
	msg := err.Error()

	// 必須說出「試過哪裡」。
	if !strings.Contains(msg, missing) {
		t.Errorf("訊息應包含嘗試過的來源位置，實得: %s", msg)
	}
	// 必須說出「為什麼不行」。
	if !strings.Contains(msg, "原因") {
		t.Errorf("訊息應包含個別來源的失敗原因，實得: %s", msg)
	}
	// 必須給下一步，否則使用者只知道失敗。
	if !strings.Contains(msg, "AICAD_UPDATE_FEED") || !strings.Contains(msg, "update-manifest.json") {
		t.Errorf("訊息應給出可行動的下一步，實得: %s", msg)
	}
	// 這句是使用者回報的原始症狀；修正後不該再是唯一訊息。
	if strings.TrimSpace(msg) == "取得位置失敗" {
		t.Error("不該只回一句無法行動的錯誤")
	}
}

// start 之前的把關：非法來源要立刻拒絕，不能進了背景 goroutine 才失敗
// （否則 UI 會先顯示「下載中」再翻臉）。
func TestDownloadSourceForRejectsBadInfo(t *testing.T) {
	updater.setCheckContext("", false)
	_, err := downloadSourceFor(updateInfo{Version: newerVersion, URL: "https://evil.example.com/x.exe"})
	if err == nil {
		t.Error("非白名單來源應被拒絕")
	}

	_, err = downloadSourceFor(updateInfo{Version: newerVersion, URL: filepath.Join(t.TempDir(), "x.exe")})
	if err == nil {
		t.Error("程式目錄外的本機來源應被拒絕")
	}

	// 由 AICAD_UPDATE_FEED 指定的來源（已記錄為寬容）應可通過。
	dir := t.TempDir()
	feed := filepath.Join(dir, "AiCad-99.0.0.exe")
	updater.setCheckContext(dir, true)
	src, err := downloadSourceFor(updateInfo{Version: newerVersion, URL: feed})
	if err != nil {
		t.Fatalf("明確指定的本機來源應被接受，實得 %v", err)
	}
	if src.Kind != "local" || src.Path != feed {
		t.Errorf("解析結果不符: %+v", src)
	}
	updater.setCheckContext("", false)
}

// 前端契約：來源欄位要出現在序列化結果中（source），否則 UI 顯示不出來。
func TestUpdateInfoSerializesSourceForFrontend(t *testing.T) {
	raw, err := json.Marshal(updateInfo{Version: "1.0.0", URL: "https://dl.aicad.app/x.exe", Source: "C:\\AiCad\\update-manifest.json"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), `"source"`) {
		t.Errorf("序列化結果應含 source 欄位，實得 %s", raw)
	}
}
