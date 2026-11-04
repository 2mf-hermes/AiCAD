#!/usr/bin/env python3
# ============================================================================
# 圖示可辨識度檢查
# ----------------------------------------------------------------------------
# 因為無法在此環境直接目視小圖，改用量化指標代替目視：
#
#   accent_ratio  accent 藍佔背板面積的比例。太低（<4%）代表線稿在小尺寸被
#                 抗鋸齒抹掉，圖示會退化成一塊素色方塊。
#   min_line_a    線稿像素的最大 alpha。若明顯低於 255，代表線寬不足 1px。
#   contrast      線稿平均亮度與背板亮度的差。差距太小在小尺寸看不出來。
#
# 判定門檻是經驗值，用意是「回歸測試」：日後調整 PROFILES 若讓某個尺寸退化，
# 這支腳本會直接指出是哪一個尺寸。
# ============================================================================

from __future__ import annotations

import os
import sys
from PIL import Image

ACCENT = (0x4C, 0x8D, 0xFF)
SIZES = [256, 128, 64, 48, 32, 24, 16]


def luma(px):
    return 0.2126 * px[0] + 0.7152 * px[1] + 0.0722 * px[2]


def is_accentish(px):
    """判斷像素是否屬於 accent 線稿：藍通道明顯高於紅通道即算。"""
    if px[3] < 40:
        return False
    return px[2] > px[0] + 40 and px[2] > 110


def main() -> int:
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    winres = os.path.join(root, "winres")
    failures = []

    print(f"{'尺寸':>6}  {'accent 佔比':>11}  {'線稿 alpha':>10}  {'對比':>6}  判定")
    for s in SIZES:
        p = os.path.join(winres, f"icon-{s}.png")
        img = Image.open(p).convert("RGBA")
        px = list(img.getdata())

        opaque = [q for q in px if q[3] > 40]
        accent = [q for q in px if is_accentish(q)]
        if not opaque:
            failures.append(f"{s}px 全透明")
            continue

        ratio = len(accent) / len(opaque)
        max_a = max((q[3] for q in accent), default=0)
        plate = [q for q in opaque if not is_accentish(q)]
        contrast = (
            (sum(luma(q) for q in accent) / len(accent))
            - (sum(luma(q) for q in plate) / len(plate))
            if accent and plate
            else 0.0
        )

        bad = []
        if ratio < 0.04:
            bad.append("線稿過細")
        if max_a < 200:
            bad.append("alpha 不足")
        if contrast < 40:
            bad.append("對比不足")
        verdict = "OK" if not bad else "，".join(bad)
        if bad:
            failures.append(f"{s}px：{verdict}")

        print(f"{s:>6}  {ratio*100:>10.1f}%  {max_a:>10}  {contrast:>6.0f}  {verdict}")

    ico = os.path.join(winres, "icon.ico")
    with Image.open(ico) as im:
        got = sorted({sz[0] for sz in im.info.get("sizes", set())}, reverse=True)
    print(f"\nICO 內含尺寸：{got}")
    missing = [s for s in SIZES if s not in got]
    if missing:
        failures.append(f"ICO 缺少尺寸 {missing}")

    if failures:
        print("\n未通過：")
        for f in failures:
            print("  - " + f)
        return 1
    print("\n全部通過。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
