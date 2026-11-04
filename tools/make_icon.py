#!/usr/bin/env python3
# ============================================================================
# Ai Cad 應用程式圖示產生器
# ----------------------------------------------------------------------------
# 為什麼是腳本而不是一張手繪圖檔：
#
#   1. 圖示要在 256 / 128 / 64 / 48 / 32 / 24 / 16 七種尺寸都清楚。單張大圖
#      直接縮小到 16px 一定糊成一團 —— 線寬被縮到小於 1 像素，抗鋸齒會把它
#      抹成淺灰。正確做法是每個尺寸「分別繪製」，小尺寸主動簡化構圖。
#   2. 幾何由程式定義，之後要調線寬、圓角、配色只要改常數，不必重畫。
#   3. 完全原創：只有矩形、直線、圓角，沒有引用任何既有商標或素材。
#
# 設計語彙（與 tokens.css 一致，刻意不用漸層與陰影）：
#   - 深墨底圓角方形背板（#1B1D21），加一圈極淡描邊撐出邊界
#   - accent 藍（#4C8DFF）線稿：量測框 + 對角線 + 節點手柄
#     這是 CAD 的「選取／量測」語彙，一眼就知道是製圖工具而非通用 AI App
#   - 16 / 24px 版本捨棄節點手柄，只留框與對角線，換取可辨識度
#
# 產出：
#   winres/icon.png          1024×1024，go-winres 的來源
#   winres/icon-<n>.png      各尺寸預覽（供文件與驗證用）
#   winres/icon.ico          多尺寸 ICO（Windows 檔案總管與工作列用）
#   public/favicon.ico       前端頁籤用，與 EXE 圖示同一份設計
# ============================================================================

from __future__ import annotations

import os
from PIL import Image, ImageDraw

# --- 設計常數 --------------------------------------------------------------

PLATE = (0x1B, 0x1D, 0x21, 0xFF)       # 背板：深墨，與應用程式視窗底色同族
EDGE = (0xFF, 0xFF, 0xFF, 0x1F)        # 背板描邊：極淡白，只為在深色底上撐出輪廓
ACCENT = (0x4C, 0x8D, 0xFF, 0xFF)      # 線稿：accent 藍
NODE = (0xE8, 0xEC, 0xF2, 0xFF)        # 節點手柄：近白，作為視覺重音

SS = 8                                  # 超取樣倍率；先畫大再縮，得到乾淨的抗鋸齒邊緣

# 各尺寸的構圖參數（比例值，乘以邊長後使用）
#   plate_r  背板圓角半徑
#   inset    量測框距背板邊緣的內縮
#   stroke   線寬
#   nodes    是否畫節點手柄
PROFILES = {
    256: dict(plate_r=0.215, inset=0.235, stroke=0.052, nodes=True),
    128: dict(plate_r=0.215, inset=0.235, stroke=0.055, nodes=True),
    64: dict(plate_r=0.210, inset=0.230, stroke=0.062, nodes=True),
    48: dict(plate_r=0.205, inset=0.225, stroke=0.070, nodes=True),
    32: dict(plate_r=0.200, inset=0.215, stroke=0.085, nodes=False),
    24: dict(plate_r=0.195, inset=0.205, stroke=0.100, nodes=False),
    16: dict(plate_r=0.190, inset=0.190, stroke=0.125, nodes=False),
}

ICO_SIZES = [256, 128, 64, 48, 32, 24, 16]


def draw_icon(size: int, profile: dict) -> Image.Image:
    """畫出單一尺寸的圖示。內部以 size*SS 作業，最後才縮回目標尺寸。"""
    n = size * SS
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    plate_r = profile["plate_r"] * n
    inset = profile["inset"] * n
    stroke = max(profile["stroke"] * n, SS)  # 縮小後至少 1px，否則線會消失

    # 背板。留 2% 邊界，讓圖示在工作列不會貼死邊。
    pad = n * 0.02
    d.rounded_rectangle(
        [pad, pad, n - pad - 1, n - pad - 1],
        radius=plate_r,
        fill=PLATE,
        outline=EDGE,
        width=max(int(stroke * 0.35), SS // 2),
    )

    # 量測框：CAD 的選取框。圓角刻意很小（3% 邊長），與背板的大圓角形成對比，
    # 讀起來才像「圖面上的框」而不是另一塊背板。
    box = [inset, inset, n - inset, n - inset]
    d.rounded_rectangle(box, radius=n * 0.03, outline=ACCENT, width=int(stroke))

    # 對角線：從左下到右上。方向與工程圖的量測輔助線一致，也讓構圖不對稱、
    # 在小尺寸下比純方框更容易辨識。
    d.line([box[0], box[3], box[2], box[1]], fill=ACCENT, width=int(stroke))

    if profile["nodes"]:
        # 節點手柄：實心小方塊，落在對角線兩端與中點。
        h = stroke * 1.55
        for cx, cy in (
            (box[0], box[3]),
            (box[2], box[1]),
            ((box[0] + box[2]) / 2, (box[1] + box[3]) / 2),
        ):
            d.rectangle([cx - h, cy - h, cx + h, cy + h], fill=NODE)

    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    winres = os.path.join(root, "winres")
    public = os.path.join(root, "public")
    os.makedirs(winres, exist_ok=True)
    os.makedirs(public, exist_ok=True)

    # go-winres 的主來源。用 1024 是為了讓它自行縮放時也有足夠餘裕，
    # 但我們同時提供手工最佳化的 ICO，Windows 會優先使用 ICO 內的對應尺寸。
    master = draw_icon(1024, PROFILES[256])
    master.save(os.path.join(winres, "icon.png"))

    frames = []
    for s in ICO_SIZES:
        im = draw_icon(s, PROFILES[s])
        im.save(os.path.join(winres, f"icon-{s}.png"))
        frames.append(im)

    ico_path = os.path.join(winres, "icon.ico")
    # Pillow 的 ICO 儲存會自行從最大張縮圖，所以改用 append_images 明確帶入
    # 每一張手工最佳化的尺寸。
    frames[0].save(
        ico_path,
        format="ICO",
        sizes=[(s, s) for s in ICO_SIZES],
        append_images=frames[1:],
    )

    # 前端頁籤圖示：WebView2 視窗本身不顯示 favicon，但開發時用瀏覽器跑會用到，
    # 保持同一份設計避免兩處視覺不一致。
    frames[0].save(
        os.path.join(public, "favicon.ico"),
        format="ICO",
        sizes=[(s, s) for s in (48, 32, 16)],
        append_images=frames[1:],
    )

    print("圖示已產生：")
    print("  " + os.path.join(winres, "icon.png") + "  (1024x1024 主來源)")
    print("  " + ico_path + f"  ({len(ICO_SIZES)} 種尺寸)")
    print("  " + os.path.join(public, "favicon.ico"))


if __name__ == "__main__":
    main()
