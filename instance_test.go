//go:build windows

/* ============================================================================
   單一實例：具名 mutex 的交接測試
   ----------------------------------------------------------------------------
   為什麼要有這一支：使用者回報「更新後點重新啟動，只有關閉、沒有重啟」。

   成因不是啟動指令寫錯，而是實例鎖的交接順序：舊行程改名→就位→啟動新檔，
   但舊行程**還握著** `Global\AiCad.SingleInstance.0`，新行程的 CreateMutexW
   因此得到 ERROR_ALREADY_EXISTS，main() 立刻 return，使用者只看到視窗消失。

   這裡釘住三件事：

     1. 同名 mutex 被持有時，第二個行程必須拿不到（不能多開）。
     2. 舊行程讓鎖之後，接手者必須**立刻**取得（這就是重啟成功的條件）。
     3. 更新接手時容許短暫重試：舊行程晚一點才收尾也能接上；
        而一般雙擊啟動（window = 0）仍然立刻放棄，不拖慢使用者。
   ============================================================================ */

package main

import (
	"fmt"
	"os"
	"testing"
	"time"
)

// 測試用名字帶 pid：同機同時跑多個測試也不會互相干擾。
func testMutexName(tag string) string {
	return fmt.Sprintf(`Global\AiCad.Test.%s.%d`, tag, os.Getpid())
}

func TestNamedMutexExcludesSecondHolder(t *testing.T) {
	name := testMutexName("Excl")
	first := createMutex(name)
	if first == 0 {
		t.Fatal("第一次建立具名 mutex 應該成功")
	}
	defer closeHandle(first)

	if second := createMutex(name); second != 0 {
		closeHandle(second)
		t.Fatal("同名 mutex 仍被持有時，第二次建立必須失敗 —— 否則就會多開")
	}
}

func TestReleaseLetsNextInstanceTakeOver(t *testing.T) {
	name := testMutexName("Handoff")
	old := createMutex(name)
	if old == 0 {
		t.Fatal("舊行程應先取得實例鎖")
	}

	// 舊行程還握著鎖 → 接手者必須拿不到（不是「晚一點就拿得到」）。
	if h := waitForMutex(name, 300*time.Millisecond); h != 0 {
		closeHandle(h)
		t.Fatal("舊行程還握著鎖時，接手者不該取得")
	}

	start := time.Now()
	closeHandle(old) // 對應 installUpdate 裡的 releaseSingleInstance()
	h := waitForMutex(name, 2*time.Second)
	if h == 0 {
		t.Fatal("舊行程讓鎖後，新行程必須接手得成 —— 拿不到就是「只關閉、沒重啟」")
	}
	defer closeHandle(h)
	if elapsed := time.Since(start); elapsed > time.Second {
		t.Fatalf("讓鎖後應立刻接手，不該等這麼久: %v", elapsed)
	}
}

func TestHandoffRetryAbsorbsLateRelease(t *testing.T) {
	name := testMutexName("Retry")
	old := createMutex(name)
	if old == 0 {
		t.Fatal("舊行程應先取得實例鎖")
	}
	go func() {
		time.Sleep(250 * time.Millisecond)
		closeHandle(old)
	}()

	start := time.Now()
	h := waitForMutex(name, 3*time.Second)
	if h == 0 {
		t.Fatal("舊行程稍後才讓鎖時，重試窗內應該接得上")
	}
	defer closeHandle(h)
	if elapsed := time.Since(start); elapsed < 200*time.Millisecond {
		t.Fatalf("應該等到舊行程釋放才取得，實際等了 %v", elapsed)
	}
}

func TestNoWaitWindowFailsFast(t *testing.T) {
	name := testMutexName("Fast")
	old := createMutex(name)
	if old == 0 {
		t.Fatal("取得實例鎖失敗")
	}
	defer closeHandle(old)

	start := time.Now()
	if h := waitForMutex(name, 0); h != 0 {
		closeHandle(h)
		t.Fatal("window 為 0 時不該取得")
	}
	if elapsed := time.Since(start); elapsed > 200*time.Millisecond {
		t.Fatalf("window 為 0 時應立刻放棄，實際耗時 %v", elapsed)
	}
}
