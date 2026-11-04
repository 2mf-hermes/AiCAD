/* ============================================================================
   Icons —— 一律 20×20 網格、1.5px 線寬、圓角端點、currentColor
   自繪而非引入圖示庫：統一線重是「專業感」最直接的來源，
   而混用不同來源的圖示是廉價感最常見的成因。
   ========================================================================== */

interface IconProps {
  size?: number;
  className?: string;
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 20 20',
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true as const,
  focusable: 'false' as const,
});

export const IconGenerate = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M10 2.6v3.1M10 14.3v3.1M2.6 10h3.1M14.3 10h3.1" />
    <path d="M4.8 4.8l2.2 2.2M13 13l2.2 2.2M15.2 4.8L13 7M7 13l-2.2 2.2" />
    <circle cx="10" cy="10" r="2.6" />
  </svg>
);

export const IconMask = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M3 6.2V4.4A1.4 1.4 0 0 1 4.4 3h1.8M13.8 3h1.8A1.4 1.4 0 0 1 17 4.4v1.8M17 13.8v1.8a1.4 1.4 0 0 1-1.4 1.4h-1.8M6.2 17H4.4A1.4 1.4 0 0 1 3 15.6v-1.8" />
    <path d="M7.4 10h5.2M10 7.4v5.2" />
  </svg>
);

export const IconDimension = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M3 13.5h14" />
    <path d="M3 11v5M17 11v5" />
    <path d="M5.4 11.8L3 13.5l2.4 1.7M14.6 11.8L17 13.5l-2.4 1.7" />
    <path d="M5 8.2V4.6h10v3.6" />
  </svg>
);

export const IconLayers = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M10 2.8L3 6.4l7 3.6 7-3.6-7-3.6z" />
    <path d="M3 10.6l7 3.6 7-3.6" />
    <path d="M3 14.4l7 3.6 7-3.6" />
  </svg>
);

// 設定＝齒輪。原本是太陽（放射線條），在工具列裡容易被誤讀成「亮度／主題」，
// 而且和 IconGenerate 的放射造型撞型。改為 6 齒齒輪：齒數刻意取少，
// 因為 18px 顯示時 8 齒的齒溝會小於一個像素而糊成一圈。
// 座標由 scripts/gen-gear-path.mjs 精算（中心 10,10；齒頂 r=8、齒根 r=6.3）。
export const IconSettings = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M7.54 4.2L8.2 2.21L11.8 2.21L12.46 4.2L13.79 4.97L15.85 4.54L17.65 7.66L16.25 9.23L16.25 10.77L17.65 12.34L15.85 15.46L13.79 15.03L12.46 15.8L11.8 17.79L8.2 17.79L7.54 15.8L6.21 15.03L4.15 15.46L2.35 12.34L3.75 10.77L3.75 9.23L2.35 7.66L4.15 4.54L6.21 4.97Z" />
    <circle cx="10" cy="10" r="2.6" />
  </svg>
);

export const IconHistory = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M3.4 10a6.6 6.6 0 1 0 2.1-4.85" />
    <path d="M3 3.2v3.1h3.1" />
    <path d="M10 6.6V10l2.6 1.6" />
  </svg>
);

export const IconExport = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M10 12.6V3.4" />
    <path d="M6.8 6.6L10 3.4l3.2 3.2" />
    <path d="M3.6 12.4v2.8a1.4 1.4 0 0 0 1.4 1.4h10a1.4 1.4 0 0 0 1.4-1.4v-2.8" />
  </svg>
);

export const IconSave = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M3.2 3.2h10.9l2.7 2.7v10.9H3.2z" />
    <path d="M6 3.2v4.4h7.4V3.2M6.1 16.8v-5.5h7.8v5.5" />
  </svg>
);

export const IconFolder = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M2.8 5.5h5l1.6 2h7.8v7.6a1.7 1.7 0 0 1-1.7 1.7h-11a1.7 1.7 0 0 1-1.7-1.7z" />
    <path d="M2.8 8V4.9a1.7 1.7 0 0 1 1.7-1.7h3.2l1.7 2.3h5.1A1.7 1.7 0 0 1 16.2 7v.5" />
  </svg>
);

export const IconNew = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M5 2.8h6.2l3.8 3.8v10.6H5z" />
    <path d="M11.2 2.8v3.8H15M7.7 11h4.6M10 8.7v4.6" />
  </svg>
);

export const IconClose = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M5.2 5.2l9.6 9.6M14.8 5.2l-9.6 9.6" />
  </svg>
);

export const IconCheck = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M4.2 10.6l3.6 3.4 8-8.2" />
  </svg>
);

export const IconZoomFit = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M3.2 7V4.2A1 1 0 0 1 4.2 3.2H7M13 3.2h2.8a1 1 0 0 1 1 1V7M16.8 13v2.8a1 1 0 0 1-1 1H13M7 16.8H4.2a1 1 0 0 1-1-1V13" />
  </svg>
);
