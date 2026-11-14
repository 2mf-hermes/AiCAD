/* ============================================================================
   標註圖層的畫布渲染（Annotation Layer）
   ----------------------------------------------------------------------------
   座標與匯出共用同一份 annotationPrimitives()，這裡只負責把圖元畫成 React 元素。
   兩邊若各算一套，預覽與匯出就會差幾個像素，使用者會以為「疊回去沒對準」。
   ========================================================================== */

import { LABEL_FONT_STACK } from '../core/textOverlay';
import type { AnnotationPrimitive } from '../core/annotationOverlay';

/** 線寬固定 1.1、與圖框一致；non-scaling-stroke 讓縮放時線不會跟著糊掉。 */
export function annotationNodes(primitives: readonly AnnotationPrimitive[]) {
  return primitives.map((primitive, index) => {
    const key = `annotation-${index}`;
    if (primitive.kind === 'line') {
      return (
        <line
          key={key}
          x1={primitive.x1}
          y1={primitive.y1}
          x2={primitive.x2}
          y2={primitive.y2}
          stroke="currentColor"
          strokeWidth={1.1}
          vectorEffect="non-scaling-stroke"
        />
      );
    }
    if (primitive.kind === 'arrow') {
      const points: string[] = [];
      for (let i = 0; i + 1 < primitive.points.length; i += 2) {
        points.push(`${primitive.points[i]},${primitive.points[i + 1]}`);
      }
      return <polygon key={key} points={points.join(' ')} fill="currentColor" stroke="currentColor" strokeWidth={0.6} />;
    }
    if (primitive.kind === 'rect') {
      return (
        <rect
          key={key}
          x={primitive.x}
          y={primitive.y}
          width={primitive.w}
          height={primitive.h}
          /* 填的是紙色而不是墨色：數值底下那塊要用來蓋掉尺寸線，不是把它塗黑。 */
          fill={primitive.fill === 'paper' ? 'var(--sheet-paper, #ffffff)' : 'none'}
          stroke="currentColor"
          strokeWidth={1.1}
          vectorEffect="non-scaling-stroke"
        />
      );
    }
    if (primitive.kind === 'circle') {
      return (
        <circle
          key={key}
          cx={primitive.cx}
          cy={primitive.cy}
          r={primitive.r}
          fill={primitive.fill === 'paper' ? 'var(--sheet-paper, #ffffff)' : 'none'}
          stroke="currentColor"
          strokeWidth={1.1}
          vectorEffect="non-scaling-stroke"
        />
      );
    }
    return (
      <text
        key={key}
        x={primitive.x}
        y={primitive.y}
        fontSize={primitive.size}
        textAnchor={primitive.anchor}
        fontWeight={primitive.weight}
        fill="currentColor"
        style={{ fontFamily: LABEL_FONT_STACK }}
      >
        {primitive.text}
      </text>
    );
  });
}
