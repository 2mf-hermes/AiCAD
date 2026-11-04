/* 產生齒輪圖示的 SVG path —— 手算 8 齒外框容易歪，交給腳本算精確座標。
   規格對齊 icons.tsx：20×20 網格、中心 (10,10)、1.5px 線寬留邊。 */

const CX = 10;
const CY = 10;
const TEETH = 8;
const R_OUT = 8.1; // 齒頂
const R_ROOT = 6.2; // 齒根
const TOOTH_HALF = 9; // 齒頂半角（度）
const FLANK_HALF = 16.5; // 齒根半角（度）

const fmt = (n) => {
  const v = Math.round(n * 100) / 100;
  return String(v);
};
const pt = (deg, r) => {
  const a = (deg * Math.PI) / 180;
  return `${fmt(CX + r * Math.cos(a))} ${fmt(CY + r * Math.sin(a))}`;
};

const step = 360 / TEETH;
const parts = [];
for (let i = 0; i < TEETH; i++) {
  const a = i * step - 90; // 從正上方起繪，讓齒對稱於垂直軸
  parts.push(pt(a - FLANK_HALF, R_ROOT));
  parts.push(pt(a - TOOTH_HALF, R_OUT));
  parts.push(pt(a + TOOTH_HALF, R_OUT));
  parts.push(pt(a + FLANK_HALF, R_ROOT));
}

const d = 'M' + parts.join('L') + 'Z';
console.log(d);
console.log('length:', d.length);
