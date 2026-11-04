//go:build windows

/* ============================================================================
   專案存檔的跨行程回歸測試
   ----------------------------------------------------------------------------
   使用者需求第 5 點是「可以保存，用來下次載入直接繼續修改內容」。這件事跟
   設定持久化一樣，光讀程式碼看不出對錯 —— 必須真的寫到磁碟、再用一次全新的
   handler 呼叫讀回來，才算證明。

   這裡驗證：
     - 存檔 → 列表看得到 → 讀回內容位元級相同
     - 同 ID 再存是覆寫而非增生
     - 刪除後列表與讀取都乾淨消失
     - meta 存在但完整檔不見時，列表不列出開不起來的殘影
     - 非法 ID（路徑跳脫）被擋
     - 壞掉的 JSON 不准落地

   測試只碰自己建立的 aicad-selftest-* 專案，結束時全部清掉，
   不會動到使用者真實的作品。
   ========================================================================== */

package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// 測試用 ID 一律帶這個前綴，清理時才能只掃自己的檔案。
const selftestPrefix = "aicad-selftest-"

func cleanupSelftestProjects(t *testing.T) {
	t.Helper()
	t.Cleanup(func() {
		dir, err := projectsDir()
		if err != nil {
			return
		}
		entries, err := os.ReadDir(dir)
		if err != nil {
			return
		}
		for _, e := range entries {
			if strings.HasPrefix(e.Name(), selftestPrefix) {
				_ = os.Remove(filepath.Join(dir, e.Name()))
			}
		}
	})
}

func listProjects(t *testing.T, reply storeReply) []projectMeta {
	t.Helper()
	if !reply.OK {
		t.Fatalf("列表失敗: %+v", reply)
	}
	var metas []projectMeta
	if err := json.Unmarshal([]byte(reply.Data), &metas); err != nil {
		t.Fatalf("列表內容不是合法 JSON: %v (%s)", err, reply.Data)
	}
	return metas
}

func findMeta(metas []projectMeta, id string) *projectMeta {
	for i := range metas {
		if metas[i].ID == id {
			return &metas[i]
		}
	}
	return nil
}

/* --------------------------------------------------------------------------- */

// 核心證明：存進去的專案，用全新的 handler 呼叫還讀得回來，且內容一模一樣。
func TestProjectSurvivesRestart(t *testing.T) {
	cleanupSelftestProjects(t)
	srv := newTestServer(t)

	id := selftestPrefix + "roundtrip"
	// 刻意包含中文、巢狀結構與長字串，確認宿主只是搬運而不解讀內容。
	data := `{"version":1,"intent":{"kind":"mechanical-part","subject":"軸承座 120mm","measurements":{"外徑":"120 mm"}},` +
		`"history":[{"id":"b1","imageRef":"data:image/png;base64,iVBORw0KGgo=","width":1024,"height":1024}],"masks":[]}`

	body, _ := json.Marshal(projectSaveRequest{
		ID:        id,
		Name:      "軸承座專案",
		UpdatedAt: 1_756_000_000_000,
		Preview:   "data:image/jpeg;base64,/9j/4AAQ",
		Boards:    1,
		Data:      data,
	})
	if code, reply := call(t, srv, "/bridge/project/save", string(body), true); code != 200 || !reply.OK {
		t.Fatalf("存檔失敗: HTTP %d, %+v", code, reply)
	}

	// 模擬「關掉 App 再開啟」：全新的 handler 呼叫、沒有任何共享記憶體狀態。
	_, listReply := call(t, srv, "/bridge/project/list", `{}`, true)
	metas := listProjects(t, listReply)
	m := findMeta(metas, id)
	if m == nil {
		t.Fatalf("列表裡找不到剛存的專案，實得 %d 筆", len(metas))
	}
	if m.Name != "軸承座專案" || m.Boards != 1 || m.UpdatedAt != 1_756_000_000_000 {
		t.Fatalf("專案資訊不符: %+v", *m)
	}
	if m.Preview == "" {
		t.Fatal("縮圖遺失，列表將無法預覽")
	}

	get, _ := json.Marshal(projectRefRequest{ID: id})
	_, reply := call(t, srv, "/bridge/project/get", string(get), true)
	if !reply.OK {
		t.Fatalf("讀取失敗: %+v", reply)
	}
	if reply.Data != data {
		t.Fatalf("專案內容沒有被完整保存\n寫入: %s\n讀回: %s", data, reply.Data)
	}
	// 最終證明：讀回來的東西前端解析得動，而且關鍵欄位還在。
	var parsed struct {
		Intent struct {
			Subject string `json:"subject"`
		} `json:"intent"`
	}
	if err := json.Unmarshal([]byte(reply.Data), &parsed); err != nil {
		t.Fatalf("讀回的內容無法解析: %v", err)
	}
	if parsed.Intent.Subject != "軸承座 120mm" {
		t.Fatalf("意圖欄位遺失，實得 %q", parsed.Intent.Subject)
	}
}

// 同一個 ID 重複儲存是「覆寫」，不能每次存都多一筆 —— 否則列表很快就爆掉。
func TestProjectSaveOverwritesSameID(t *testing.T) {
	cleanupSelftestProjects(t)
	srv := newTestServer(t)

	id := selftestPrefix + "overwrite"
	save := func(name, data string, updatedAt int64) {
		body, _ := json.Marshal(projectSaveRequest{
			ID: id, Name: name, UpdatedAt: updatedAt, Boards: 1, Data: data,
		})
		if _, reply := call(t, srv, "/bridge/project/save", string(body), true); !reply.OK {
			t.Fatalf("存檔失敗: %+v", reply)
		}
	}

	save("第一版", `{"v":1}`, 1000)
	save("第二版", `{"v":2}`, 2000)

	_, listReply := call(t, srv, "/bridge/project/list", `{}`, true)
	metas := listProjects(t, listReply)
	count := 0
	for _, m := range metas {
		if m.ID == id {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("同一 ID 應只有一筆，實得 %d 筆", count)
	}
	if m := findMeta(metas, id); m == nil || m.Name != "第二版" {
		t.Fatalf("覆寫後應為第二版: %+v", m)
	}

	get, _ := json.Marshal(projectRefRequest{ID: id})
	_, reply := call(t, srv, "/bridge/project/get", string(get), true)
	if reply.Data != `{"v":2}` {
		t.Fatalf("內容未被覆寫，實得 %s", reply.Data)
	}
}

// 列表順序：最近修改的排最前面，因為那是「下次開啟直接繼續」最常要的一筆。
func TestProjectListSortedByRecency(t *testing.T) {
	cleanupSelftestProjects(t)
	srv := newTestServer(t)

	save := func(id string, updatedAt int64) {
		body, _ := json.Marshal(projectSaveRequest{
			ID: selftestPrefix + id, Name: id, UpdatedAt: updatedAt, Boards: 1, Data: `{"v":1}`,
		})
		if _, reply := call(t, srv, "/bridge/project/save", string(body), true); !reply.OK {
			t.Fatalf("存檔失敗: %+v", reply)
		}
	}
	save("old", 1_000)
	save("new", 9_000)
	save("mid", 5_000)

	_, listReply := call(t, srv, "/bridge/project/list", `{}`, true)
	metas := listProjects(t, listReply)

	var order []string
	for _, m := range metas {
		if strings.HasPrefix(m.ID, selftestPrefix) {
			order = append(order, strings.TrimPrefix(m.ID, selftestPrefix))
		}
	}
	want := []string{"new", "mid", "old"}
	if len(order) != len(want) {
		t.Fatalf("應有 3 筆測試專案，實得 %v", order)
	}
	for i := range want {
		if order[i] != want[i] {
			t.Fatalf("排序錯誤，預期 %v，實得 %v", want, order)
		}
	}
}

// 刪除要真的乾淨：列表消失、讀取回明確錯誤，兩個檔案都不留。
func TestProjectDeleteRemovesBothFiles(t *testing.T) {
	cleanupSelftestProjects(t)
	srv := newTestServer(t)

	id := selftestPrefix + "delete"
	body, _ := json.Marshal(projectSaveRequest{
		ID: id, Name: "待刪除", UpdatedAt: 1000, Boards: 1, Data: `{"v":1}`,
	})
	if _, reply := call(t, srv, "/bridge/project/save", string(body), true); !reply.OK {
		t.Fatalf("存檔失敗: %+v", reply)
	}

	ref, _ := json.Marshal(projectRefRequest{ID: id})
	if _, reply := call(t, srv, "/bridge/project/delete", string(ref), true); !reply.OK {
		t.Fatalf("刪除失敗: %+v", reply)
	}

	_, listReply := call(t, srv, "/bridge/project/list", `{}`, true)
	if m := findMeta(listProjects(t, listReply), id); m != nil {
		t.Fatal("刪除後列表仍看得到")
	}
	if _, reply := call(t, srv, "/bridge/project/get", string(ref), true); reply.OK {
		t.Fatal("刪除後仍讀得到內容")
	}

	full, meta, err := projectPaths(id)
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{full, meta} {
		if _, err := os.Stat(p); err == nil {
			t.Fatalf("檔案未被移除: %s", p)
		}
	}

	// 刪掉不存在的專案不該報錯 —— 使用者連點兩次刪除按鈕是很正常的事。
	if _, reply := call(t, srv, "/bridge/project/delete", string(ref), true); !reply.OK {
		t.Fatalf("重複刪除應為無害操作: %+v", reply)
	}
}

// 只剩 meta、完整檔不見（手動刪檔、雲端同步只搬了一半）：
// 列表不該列出來，否則使用者點了只會拿到錯誤。
func TestProjectListSkipsOrphanMeta(t *testing.T) {
	cleanupSelftestProjects(t)
	srv := newTestServer(t)

	id := selftestPrefix + "orphan"
	body, _ := json.Marshal(projectSaveRequest{
		ID: id, Name: "孤兒", UpdatedAt: 1000, Boards: 1, Data: `{"v":1}`,
	})
	if _, reply := call(t, srv, "/bridge/project/save", string(body), true); !reply.OK {
		t.Fatalf("存檔失敗: %+v", reply)
	}

	full, _, err := projectPaths(id)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(full); err != nil {
		t.Fatalf("無法移除完整檔: %v", err)
	}

	_, listReply := call(t, srv, "/bridge/project/list", `{}`, true)
	if m := findMeta(listProjects(t, listReply), id); m != nil {
		t.Fatal("完整檔已不存在，列表不應列出這個專案")
	}
}

// ID 直接被拿去組檔名，路徑跳脫必須在進入檔案系統前就被擋掉。
func TestProjectRejectsUnsafeID(t *testing.T) {
	srv := newTestServer(t)
	bad := []string{
		`..\..\settings`,
		"../../settings",
		"has space",
		"",
		"a/b",
		"c:\\windows\\system32\\x",
	}
	for _, id := range bad {
		save, _ := json.Marshal(projectSaveRequest{ID: id, Name: "x", Data: `{}`})
		if _, reply := call(t, srv, "/bridge/project/save", string(save), true); reply.OK {
			t.Errorf("存檔應拒絕不合法 ID %q", id)
		}
		ref, _ := json.Marshal(projectRefRequest{ID: id})
		if _, reply := call(t, srv, "/bridge/project/get", string(ref), true); reply.OK {
			t.Errorf("讀取應拒絕不合法 ID %q", id)
		}
		if _, reply := call(t, srv, "/bridge/project/delete", string(ref), true); reply.OK {
			t.Errorf("刪除應拒絕不合法 ID %q", id)
		}
	}
}

// 壞掉的 JSON 不准落地：寧可現在失敗，也不要下次載入才發現作品開不起來。
func TestProjectRejectsInvalidJSON(t *testing.T) {
	cleanupSelftestProjects(t)
	srv := newTestServer(t)

	id := selftestPrefix + "badjson"
	body, _ := json.Marshal(projectSaveRequest{ID: id, Name: "壞檔", Data: "{not json"})
	if _, reply := call(t, srv, "/bridge/project/save", string(body), true); reply.OK || reply.Error == "" {
		t.Fatalf("應拒絕非法 JSON，實得 %+v", reply)
	}

	full, _, err := projectPaths(id)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(full); err == nil {
		t.Fatal("非法 JSON 竟然落地了")
	}
}

// 讀取不存在的專案要回可讀錯誤，不能回 ok 帶空字串 ——
// 否則前端會把空內容當成「一個空專案」載入，把使用者的畫面清空。
func TestProjectGetMissingReportsError(t *testing.T) {
	srv := newTestServer(t)
	ref, _ := json.Marshal(projectRefRequest{ID: selftestPrefix + "never-existed"})
	_, reply := call(t, srv, "/bridge/project/get", string(ref), true)
	if reply.OK {
		t.Fatalf("不存在的專案應回錯誤，實得 %+v", reply)
	}
	if reply.Error == "" {
		t.Fatal("錯誤訊息不得為空")
	}
}

// 名稱是使用者自由輸入：空白要有預設值，過長要截斷，避免列表被單一筆撐爛。
func TestProjectNameNormalized(t *testing.T) {
	cleanupSelftestProjects(t)
	srv := newTestServer(t)

	blank := selftestPrefix + "blankname"
	body, _ := json.Marshal(projectSaveRequest{ID: blank, Name: "   ", UpdatedAt: 1, Data: `{}`})
	if _, reply := call(t, srv, "/bridge/project/save", string(body), true); !reply.OK {
		t.Fatalf("存檔失敗: %+v", reply)
	}

	long := selftestPrefix + "longname"
	body, _ = json.Marshal(projectSaveRequest{
		ID: long, Name: strings.Repeat("長", 200), UpdatedAt: 2, Data: `{}`,
	})
	if _, reply := call(t, srv, "/bridge/project/save", string(body), true); !reply.OK {
		t.Fatalf("存檔失敗: %+v", reply)
	}

	_, listReply := call(t, srv, "/bridge/project/list", `{}`, true)
	metas := listProjects(t, listReply)

	if m := findMeta(metas, blank); m == nil || m.Name != "未命名專案" {
		t.Fatalf("空白名稱應有預設值: %+v", m)
	}
	if m := findMeta(metas, long); m == nil || len([]rune(m.Name)) != 80 {
		t.Fatalf("過長名稱應截斷為 80 字: %+v", m)
	}
}
