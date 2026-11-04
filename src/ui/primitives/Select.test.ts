import { describe, expect, it } from 'vitest';
import { calculateSelectPlacement } from './Select';

describe('calculateSelectPlacement', () => {
  const frame = { left: 100, top: 50, right: 900, bottom: 650 };

  it('keeps a downward menu inside the application frame', () => {
    const result = calculateSelectPlacement({
      trigger: { left: 760, top: 100, right: 960, bottom: 132, width: 200 },
      frame,
    });
    expect(result.drop).toBe('down');
    expect(result.left).toBeGreaterThanOrEqual(108);
    expect(result.left + result.width).toBeLessThanOrEqual(892);
    expect(result.top + result.maxHeight).toBeLessThanOrEqual(642);
  });

  it('opens upward and limits height when there is more room above', () => {
    const result = calculateSelectPlacement({
      trigger: { left: 200, top: 570, right: 500, bottom: 606, width: 300 },
      frame,
    });
    expect(result.drop).toBe('up');
    expect(result.maxHeight).toBeLessThanOrEqual(512);
    expect(result.top - result.maxHeight).toBeGreaterThanOrEqual(58);
  });

  it('never exceeds a narrow frame', () => {
    const result = calculateSelectPlacement({
      trigger: { left: 0, top: 80, right: 600, bottom: 112, width: 600 },
      frame: { left: 20, top: 20, right: 260, bottom: 180 },
    });
    expect(result.width).toBe(224);
    expect(result.left).toBe(28);
    expect(result.left + result.width).toBe(252);
  });
});
