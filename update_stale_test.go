package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

/* 更新接手時，舊執行檔（AiCad.exe.old）的映像還被前一輪行程映射著，當下一定刪不掉。
  使用者看到的症狀是「更新重開後舊檔還在，要再關掉重開一次才消失」，
  所以這裡把「等解鎖」這個行為直接測出來，而不是只測「刪不掉就算了」。

  在 Windows 上，Go 的 os.Open 不共享 FILE_SHARE_DELETE，因此開著 handle
  就等同檔案仍在使用中 —— 正好可以複製真實的鎖定情境。 */

func TestRemoveWhenUnlockedWaitsForHandleRelease(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "AiCad.exe.old")
	if err := os.WriteFile(path, []byte("old-build"), 0o644); err != nil {
		t.Fatalf("準備測試檔失敗: %v", err)
	}
	held, err := os.Open(path)
	if err != nil {
		t.Fatalf("開啟測試檔失敗: %v", err)
	}
	// 模擬「前一輪行程數百毫秒後退場」：稍後才放掉 handle。
	go func() {
		time.Sleep(300 * time.Millisecond)
		held.Close()
	}()

	if !removeWhenUnlocked(path, 10*time.Second) {
		t.Fatal("解鎖後仍未刪除舊執行檔，使用者會看到殘留檔案")
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("舊執行檔仍存在: %v", err)
	}
}

func TestRemoveWhenUnlockedGivesUpWithinWindow(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "AiCad.exe.old")
	if err := os.WriteFile(path, []byte("old-build"), 0o644); err != nil {
		t.Fatalf("準備測試檔失敗: %v", err)
	}
	held, err := os.Open(path)
	if err != nil {
		t.Fatalf("開啟測試檔失敗: %v", err)
	}
	defer held.Close()

	start := time.Now()
	if removeWhenUnlocked(path, 200*time.Millisecond) {
		t.Fatal("檔案仍被鎖住卻回報刪除成功")
	}
	if elapsed := time.Since(start); elapsed > 5*time.Second {
		t.Fatalf("重試視窗沒有收斂，耗時 %v", elapsed)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("放棄時不該動到檔案: %v", err)
	}
}

func TestRemoveStaleExecutableIgnoresMissingFile(t *testing.T) {
	// 沒有殘留時必須立刻返回：啟動路徑上不該留下任何等待。
	done := make(chan struct{})
	go func() {
		removeStaleExecutable(filepath.Join(t.TempDir(), "AiCad.exe.old"))
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("沒有殘留檔案時仍在等待")
	}
}
