//go:build windows

/* ============================================================================
   專案存檔 (Project Save / Load)
   ----------------------------------------------------------------------------
   使用者需求：「可以保存，用來下次載入直接繼續修改內容。」

   設計取捨（為什麼不是一個大 JSON 檔）：
   一份專案含歷史版本的圖片（data URL），一張 1024×1024 PNG 經 base64 後就
   接近 2 MB，存個幾版輕鬆破 10 MB。如果所有專案塞在同一個檔案裡，光是要
   在啟動時列出「最近的專案」就得把全部圖片讀進記憶體 —— 專案愈多愈慢，
   而且任何一次寫入失敗都會賠掉全部作品。

   所以採「一專案兩檔」：
     projects\<id>.json        完整內容（意圖、歷史、遮罩、圖片）
     projects\<id>.meta.json   只有名稱、時間、縮圖（列表用）

   列表只掃 *.meta.json，成本與專案大小無關。也刻意不做中央索引檔：
   索引一旦與實體檔案不同步就得寫修復邏輯，而「掃目錄」本身就永遠是真相。

   ID 由前端產生並經 validRef 檢核（同 secrets 的字元集），避免未來被當成
   檔名時夾帶路徑跳脫。
   ========================================================================== */

package main

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const (
	projectsDirName = "projects"
	projectExt      = ".json"
	projectMetaExt  = ".meta.json"

	// 專案含圖片，上限必須遠高於設定檔的 4 MB。64 MB 與 main.go 的
	// maxBodyBytes 對齊，避免前端能送進來卻在這一層被默默截斷。
	maxProjectBytes = 64 << 20

	// 縮圖直接內嵌在 meta 裡，太大就失去「列表很輕」的意義。
	// 320px 寬的 JPEG data URL 約 20–40 KB，256 KB 是寬鬆上限。
	maxPreviewBytes = 256 << 10
)

/* ---------------------------------------------------------------------------
   路徑
   --------------------------------------------------------------------------- */

func projectsDir() (string, error) {
	base, err := storeDir()
	if err != nil {
		return "", err
	}
	p := filepath.Join(base, projectsDirName)
	if err := os.MkdirAll(p, 0o700); err != nil {
		return "", err
	}
	return p, nil
}

func projectPaths(id string) (full string, meta string, err error) {
	dir, err := projectsDir()
	if err != nil {
		return "", "", err
	}
	return filepath.Join(dir, id+projectExt), filepath.Join(dir, id+projectMetaExt), nil
}

/* ---------------------------------------------------------------------------
   線上格式
   --------------------------------------------------------------------------- */

type projectMeta struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	UpdatedAt int64  `json:"updatedAt"`
	// 縮圖 data URL，可為空（前端尚未出圖就存檔的情形）
	Preview string `json:"preview,omitempty"`
	// 給列表顯示用的計數，避免前端為了顯示「3 個版本」而載入整份專案
	Boards int `json:"boards"`
}

type projectSaveRequest struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	UpdatedAt int64  `json:"updatedAt"`
	Preview   string `json:"preview"`
	Boards    int    `json:"boards"`
	// 完整內容，前端自行序列化後的 JSON 字串。宿主不解讀其結構 ——
	// schema 演進屬於前端，宿主只負責原封不動搬運（與 settings 同一原則）。
	Data string `json:"data"`
}

type projectRefRequest struct {
	ID string `json:"id"`
}

/* ---------------------------------------------------------------------------
   列表
   --------------------------------------------------------------------------- */

func projectListHandler(w http.ResponseWriter, _ *http.Request) {
	storeMu.Lock()
	defer storeMu.Unlock()

	dir, err := projectsDir()
	if err != nil {
		writeStoreJSON(w, storeReply{Error: "無法定位專案目錄: " + err.Error()})
		return
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		writeStoreJSON(w, storeReply{Error: "讀取專案目錄失敗: " + err.Error()})
		return
	}

	metas := make([]projectMeta, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), projectMetaExt) {
			continue
		}
		raw, err := readIfExistsLimit(filepath.Join(dir, e.Name()), maxPreviewBytes+4<<10)
		if err != nil || len(raw) == 0 {
			continue // 單一檔案壞掉不該讓整個列表開不出來
		}
		var m projectMeta
		if err := json.Unmarshal(raw, &m); err != nil {
			continue
		}
		if !validRef(m.ID) {
			continue
		}
		// meta 存在但完整檔不見了（手動刪檔、同步軟體只搬了一半）：
		// 不要列出來，否則使用者點了只會得到錯誤。
		if _, err := os.Stat(filepath.Join(dir, m.ID+projectExt)); err != nil {
			continue
		}
		metas = append(metas, m)
	}

	// 最近修改排最前面 —— 這是「下次載入直接繼續」最常要的那一筆。
	sort.SliceStable(metas, func(i, j int) bool { return metas[i].UpdatedAt > metas[j].UpdatedAt })

	out, err := json.Marshal(metas)
	if err != nil {
		writeStoreJSON(w, storeReply{Error: "序列化專案清單失敗: " + err.Error()})
		return
	}
	writeStoreJSON(w, storeReply{OK: true, Data: string(out)})
}

/* ---------------------------------------------------------------------------
   讀取
   --------------------------------------------------------------------------- */

func projectGetHandler(w http.ResponseWriter, r *http.Request) {
	var req projectRefRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil {
		writeStoreJSON(w, storeReply{Error: "請求格式錯誤: " + err.Error()})
		return
	}
	if !validRef(req.ID) {
		writeStoreJSON(w, storeReply{Error: "專案代號不合法"})
		return
	}

	storeMu.Lock()
	defer storeMu.Unlock()

	full, _, err := projectPaths(req.ID)
	if err != nil {
		writeStoreJSON(w, storeReply{Error: "無法定位專案目錄: " + err.Error()})
		return
	}
	raw, err := readIfExistsLimit(full, maxProjectBytes)
	if err != nil {
		writeStoreJSON(w, storeReply{Error: "讀取專案失敗: " + err.Error()})
		return
	}
	if len(raw) == 0 {
		writeStoreJSON(w, storeReply{Error: "找不到這個專案，可能已被刪除"})
		return
	}
	writeStoreJSON(w, storeReply{OK: true, Data: string(raw)})
}

/* ---------------------------------------------------------------------------
   寫入
   --------------------------------------------------------------------------- */

func projectSaveHandler(w http.ResponseWriter, r *http.Request) {
	var req projectSaveRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, maxProjectBytes)).Decode(&req); err != nil {
		writeStoreJSON(w, storeReply{Error: "請求格式錯誤: " + err.Error()})
		return
	}
	if !validRef(req.ID) {
		writeStoreJSON(w, storeReply{Error: "專案代號不合法"})
		return
	}
	// 與設定檔同一道防線：寧可現在失敗，也不要下次載入才發現檔案壞掉。
	if !json.Valid([]byte(req.Data)) {
		writeStoreJSON(w, storeReply{Error: "專案內容不是合法 JSON，已拒絕寫入"})
		return
	}
	if len(req.Data) > maxProjectBytes {
		writeStoreJSON(w, storeReply{Error: "專案內容過大（超過 64 MB），請先刪除部分歷史版本"})
		return
	}

	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = "未命名專案"
	}
	if len([]rune(name)) > 80 {
		name = string([]rune(name)[:80])
	}
	preview := req.Preview
	if len(preview) > maxPreviewBytes {
		preview = "" // 寧可沒縮圖，也不要讓列表變慢
	}

	storeMu.Lock()
	defer storeMu.Unlock()

	full, metaPath, err := projectPaths(req.ID)
	if err != nil {
		writeStoreJSON(w, storeReply{Error: "無法定位專案目錄: " + err.Error()})
		return
	}

	// 先寫完整檔，成功了才寫 meta。順序很重要：列表以 meta 為憑，
	// 若反過來先寫 meta，中途失敗就會列出一個開不起來的專案。
	if err := writeAtomic(full, []byte(req.Data)); err != nil {
		writeStoreJSON(w, storeReply{Error: "寫入專案失敗: " + err.Error()})
		return
	}

	meta := projectMeta{
		ID:        req.ID,
		Name:      name,
		UpdatedAt: req.UpdatedAt,
		Preview:   preview,
		Boards:    req.Boards,
	}
	metaRaw, err := json.Marshal(meta)
	if err != nil {
		writeStoreJSON(w, storeReply{Error: "序列化專案資訊失敗: " + err.Error()})
		return
	}
	if err := writeAtomic(metaPath, metaRaw); err != nil {
		writeStoreJSON(w, storeReply{Error: "寫入專案資訊失敗: " + err.Error()})
		return
	}
	writeStoreJSON(w, storeReply{OK: true, Data: string(metaRaw)})
}

/* ---------------------------------------------------------------------------
   刪除
   --------------------------------------------------------------------------- */

func projectDeleteHandler(w http.ResponseWriter, r *http.Request) {
	var req projectRefRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil {
		writeStoreJSON(w, storeReply{Error: "請求格式錯誤: " + err.Error()})
		return
	}
	if !validRef(req.ID) {
		writeStoreJSON(w, storeReply{Error: "專案代號不合法"})
		return
	}

	storeMu.Lock()
	defer storeMu.Unlock()

	full, metaPath, err := projectPaths(req.ID)
	if err != nil {
		writeStoreJSON(w, storeReply{Error: "無法定位專案目錄: " + err.Error()})
		return
	}
	// 先移除 meta：即使第二步失敗，專案也已從列表消失，不會出現
	// 「刪不掉的殘影」。孤兒完整檔會在下次以同 ID 儲存時被覆寫。
	if err := os.Remove(metaPath); err != nil && !os.IsNotExist(err) {
		writeStoreJSON(w, storeReply{Error: "刪除專案資訊失敗: " + err.Error()})
		return
	}
	if err := os.Remove(full); err != nil && !os.IsNotExist(err) {
		writeStoreJSON(w, storeReply{Error: "刪除專案失敗: " + err.Error()})
		return
	}
	writeStoreJSON(w, storeReply{OK: true})
}
