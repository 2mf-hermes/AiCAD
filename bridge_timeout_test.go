//go:build windows

/* ============================================================================
   /bridge/http 的時間預算與回應形狀 —— 回歸測試
   ----------------------------------------------------------------------------
   這組測試守的是使用者實際回報的症狀：「AI 有送出，但過很久都沒有結果，
   即便把逾時上限調高也拿不到」。當時的成因是宿主端 http.Client 上有一個
   固定 10 分鐘的 Timeout，比前端傳來的 timeoutMs 更早生效，於是使用者調
   高秒數完全沒有作用；而且逾時後前端只拿到模糊訊息，無法自我診斷。

   因此這裡驗四件事：
     1. 前端傳來的 timeoutMs 真的被採用（短逾時要在該時間附近就返回）；
     2. 逾時是以「可讀錯誤」回覆，而不是把連線掛死讓前端永遠等下去；
     3. responseAs="base64" 能把二進位內容正確編碼（只回 url 的中轉站需要）；
     4. bridgeBudget 的夾值邏輯：0 用預設、超過上限夾到上限。
   ========================================================================== */

package main

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func callBridge(t *testing.T, srv *httptest.Server, payload bridgeRequest) bridgeResponse {
	t.Helper()
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	req, err := http.NewRequest(http.MethodPost, srv.URL+"/bridge/http", strings.NewReader(string(raw)))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-AiCad-Token", testToken)

	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatalf("宿主橋接本身不該失敗: %v", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("預期 200，得到 %d", res.StatusCode)
	}
	var reply bridgeResponse
	if err := json.NewDecoder(res.Body).Decode(&reply); err != nil {
		t.Fatalf("回應不是合法 JSON: %v", err)
	}
	return reply
}

func newBridgeServer(t *testing.T) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/bridge/http", bridgeHandler(testToken))
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

// 慢速上游：模擬「已經收下請求但很久才算完」的出圖端點。
func newSlowUpstream(t *testing.T, delay time.Duration, body string) *httptest.Server {
	t.Helper()
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-time.After(delay):
		case <-r.Context().Done():
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(up.Close)
	return up
}

// 前端給的 timeoutMs 必須真的生效：等待時間要落在該預算附近，
// 而不是被宿主端某個更短（或更長）的隱藏上限接管。
func TestBridgeHonoursFrontendTimeout(t *testing.T) {
	bridge := newBridgeServer(t)
	up := newSlowUpstream(t, 5*time.Second, `{"ok":true}`)

	start := time.Now()
	reply := callBridge(t, bridge, bridgeRequest{
		URL:       up.URL,
		Method:    http.MethodGet,
		TimeoutMs: 600,
	})
	elapsed := time.Since(start)

	if reply.Error == "" {
		t.Fatal("逾時應回報可讀錯誤，而不是看似成功")
	}
	if elapsed > 3*time.Second {
		t.Fatalf("timeoutMs=600ms 卻等了 %v —— 前端的逾時設定沒有生效", elapsed)
	}
}

// 逾時不能讓 HTTP 交易懸空：宿主必須主動寫出一則錯誤，
// 否則前端的 await 永遠不會 settle，畫面就一直卡在「正在繪製」。
func TestBridgeTimeoutRepliesInsteadOfHanging(t *testing.T) {
	bridge := newBridgeServer(t)
	up := newSlowUpstream(t, 10*time.Second, `{"ok":true}`)

	done := make(chan bridgeResponse, 1)
	go func() {
		done <- callBridge(t, bridge, bridgeRequest{
			URL:       up.URL,
			Method:    http.MethodGet,
			TimeoutMs: 500,
		})
	}()

	select {
	case reply := <-done:
		if reply.Error == "" {
			t.Fatal("預期收到逾時錯誤說明")
		}
		if reply.OK {
			t.Fatal("逾時不該回報 ok")
		}
	case <-time.After(6 * time.Second):
		t.Fatal("宿主在逾時後沒有回覆 —— 這正是「送出後永遠拿不到結果」的成因")
	}
}

// 正常情況：預算足夠時要原樣拿到上游內容。
func TestBridgePassesThroughWhenWithinBudget(t *testing.T) {
	bridge := newBridgeServer(t)
	up := newSlowUpstream(t, 100*time.Millisecond, `{"data":[{"b64_json":"AAA"}]}`)

	reply := callBridge(t, bridge, bridgeRequest{
		URL:       up.URL,
		Method:    http.MethodGet,
		TimeoutMs: 10_000,
	})
	if reply.Error != "" {
		t.Fatalf("不該有錯誤: %s", reply.Error)
	}
	if !reply.OK || reply.Status != http.StatusOK {
		t.Fatalf("預期 200/ok，得到 %d/%v", reply.Status, reply.OK)
	}
	if !strings.Contains(reply.Text, "b64_json") {
		t.Fatalf("回應內容遭改動: %s", reply.Text)
	}
}

// responseAs=base64：只回 url 的端點靠這條路把圖抓回來。
// 二進位不能走 text，否則非 UTF-8 位元組會被替換字元毀掉。
func TestBridgeBase64ResponseMode(t *testing.T) {
	binary := []byte{0x89, 0x50, 0x4E, 0x47, 0x00, 0xFF, 0xFE, 0x01}
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(binary)
	}))
	t.Cleanup(up.Close)

	bridge := newBridgeServer(t)
	reply := callBridge(t, bridge, bridgeRequest{
		URL:        up.URL,
		Method:     http.MethodGet,
		TimeoutMs:  5_000,
		ResponseAs: "base64",
	})
	if reply.Error != "" {
		t.Fatalf("不該有錯誤: %s", reply.Error)
	}
	want := base64.StdEncoding.EncodeToString(binary)
	if reply.Text != want {
		t.Fatalf("base64 編碼不符\n got: %q\nwant: %q", reply.Text, want)
	}
}

func TestBridgeBudgetClamping(t *testing.T) {
	cases := []struct {
		name string
		ms   int
		want time.Duration
	}{
		{"零值用預設", 0, bridgeDefaultTimeout},
		{"負值用預設", -1, bridgeDefaultTimeout},
		{"一般值原樣採用", 45_000, 45 * time.Second},
		{"超過上限夾到上限", 999 * 60 * 1000, bridgeMaxTimeout},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := bridgeBudget(c.ms); got != c.want {
				t.Fatalf("bridgeBudget(%d) = %v，預期 %v", c.ms, got, c.want)
			}
		})
	}
}
