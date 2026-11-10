import { describe, expect, it } from 'vitest';
import { compareVersions, isNewer } from './update';

/*
 * 版本比較是更新提示的唯一判斷依據，且必須與 Go 端的 compareVersions
 * （update_windows.go / bridge_test.go）逐條一致 —— 兩邊不一致就會出現
 * 「UI 說有新版、宿主說沒有」。這裡把四段版號（0.3.5.1）也納入。
 */
describe('compareVersions', () => {
  it.each<[string, string, number]>([
    ['0.3.5.1', '0.3.5', 1],
    ['0.3.5', '0.3.5.1', -1],
    ['0.3.5.1', '0.3.5.1', 0],
    ['0.3.10.2', '0.3.9.9', 1],
    ['1.0.0', '0.9.9', 1],
    ['0.2.0', '0.2.0-rc1', 1],
    ['0.2.0-rc1', '0.2.0', -1],
    ['v0.3.0', '0.2.9', 1],
    ['0.10.0', '0.9.0', 1],
    ['0.3.5.0', '0.3.5', 0],
  ])('compareVersions(%s, %s) = %i', (a, b, want) => {
    expect(compareVersions(a, b)).toBe(want);
  });

  it('把四段版號視為比三段更新', () => {
    expect(isNewer('0.3.5.1', '0.3.5')).toBe(true);
    expect(isNewer('0.3.5', '0.3.5.1')).toBe(false);
  });

  it('容忍缺失或非數字的段落而不拋錯', () => {
    expect(compareVersions('0.3', '0.3.0')).toBe(0);
    expect(compareVersions('0.3.x', '0.3.0')).toBe(0);
  });
});
