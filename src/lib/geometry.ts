/* ============================================================
 * 几何引擎：边路径 / 锚点 / 平行边 / 自环 / 箭头 / 标签锚点
 * 画布渲染与导出共用同一套数学（WYSIWYG 保证）
 * ============================================================ */

import type { ProjectDoc, ProjectState, ProjectTransition, ProjectSettings, ThemeMode } from './core';
import { PALETTES, THEME, START_ID, estWidth, nodeSize, actionLines, labelLines } from './core';

export interface Pt { x: number; y: number }

export interface NodeShape {
  id: string;
  x: number; y: number; w: number; h: number;
  cx: number; cy: number;
  isCircle: boolean; r: number;
}

export function shapesOf(doc: ProjectDoc, settings: ProjectSettings): Map<string, NodeShape> {
  const map = new Map<string, NodeShape>();
  for (const s of doc.states) {
    const { w, h } = nodeSize(s, settings);
    map.set(s.id, {
      id: s.id, x: s.position.x, y: s.position.y, w, h,
      cx: s.position.x + w / 2, cy: s.position.y + h / 2,
      isCircle: s.kind === 'junction' || s.kind === 'start',
      r: s.kind === 'junction' ? 13 : 11,
    });
  }
  return map;
}

export interface EdgeGeom {
  id: string;
  d: string;
  color: string;
  width: number;
  dash?: string;
  ax: number; ay: number; aa: number; // 箭头尖端与角度
  labelX: number; labelY: number; labelW: number; labelH: number;
  lines: string[];
}

export function resolveEdgeAppearance(
  t: ProjectTransition, settings: ProjectSettings, theme: ThemeMode
): { color: string; width: number; dash?: string } {
  const color = t.lineColor ? PALETTES[t.lineColor][theme].accent : THEME[theme].edge;
  const width = t.lineWidth ?? settings.edgeWidth;
  const dash = t.dashed ? `${Math.max(5, width * 3.4)} ${Math.max(4, width * 2.8)}` : undefined;
  return { color, width, dash };
}

const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);
const norm = (v: Pt): Pt => {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
};

/** 矩形边界交点（沿方向 d） */
function rectBoundary(sh: NodeShape, d: Pt, pad: number): Pt {
  const dx = Math.abs(d.x) < 1e-6 ? 1e-6 : Math.abs(d.x);
  const dy = Math.abs(d.y) < 1e-6 ? 1e-6 : Math.abs(d.y);
  const t = Math.min(sh.w / 2 / dx, sh.h / 2 / dy);
  const n = norm(d);
  return { x: sh.cx + d.x * t + n.x * pad, y: sh.cy + d.y * t + n.y * pad };
}

function circleBoundary(sh: NodeShape, d: Pt, pad: number): Pt {
  const n = norm(d);
  return { x: sh.cx + n.x * (sh.r + pad), y: sh.cy + n.y * (sh.r + pad) };
}

function boundary(sh: NodeShape | undefined, d: Pt, pad: number): Pt {
  if (!sh) return { x: 0, y: 0 };
  return sh.isCircle ? circleBoundary(sh, d, pad) : rectBoundary(sh, d, pad);
}

/** 圆角折线路径 */
function roundedPath(pts: Pt[], r: number): string {
  if (pts.length < 2) return '';
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const v1 = norm({ x: p.x - pts[i - 1].x, y: p.y - pts[i - 1].y });
    const v2 = norm({ x: pts[i + 1].x - p.x, y: pts[i + 1].y - p.y });
    const r1 = Math.min(r, dist(p, pts[i - 1]) / 2);
    const r2 = Math.min(r, dist(pts[i + 1], p) / 2);
    const a = { x: p.x - v1.x * r1, y: p.y - v1.y * r1 };
    const b = { x: p.x + v2.x * r2, y: p.y + v2.y * r2 };
    d += ` L ${a.x.toFixed(1)} ${a.y.toFixed(1)} Q ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${last.x.toFixed(1)} ${last.y.toFixed(1)}`;
  return d;
}

function dedupe(pts: Pt[]): Pt[] {
  return pts.filter((p, i) => i === 0 || dist(p, pts[i - 1]) > 0.5);
}

const PARALLEL_GAP = 26;
const SELF_LOOP_BASE = 36;
const SELF_LOOP_STEP = 22;

/** 计算所有可见转移的几何 */
export function computeEdgeGeoms(
  doc: ProjectDoc, settings: ProjectSettings, theme: ThemeMode
): EdgeGeom[] {
  const shapes = shapesOf(doc, settings);
  const T = THEME[theme];
  const arrow = settings.arrowSize;
  const visible = doc.transitions.filter((t) => t.enabled !== false);

  // 平行边分组（含反向边同组），自环单独分组
  const groups = new Map<string, ProjectTransition[]>();
  for (const t of visible) {
    const key = t.source === t.target
      ? `self:${t.source}`
      : `pair:${[t.source, t.target].sort().join('~')}`;
    const arr = groups.get(key);
    if (arr) arr.push(t); else groups.set(key, [t]);
  }

  const geoms: EdgeGeom[] = [];

  for (const [key, list] of groups) {
    if (key.startsWith('self:')) {
      list.forEach((t, idx) => {
        const sh = shapes.get(t.source);
        if (!sh) return;
        const top = sh.isCircle ? sh.cy - sh.r : sh.y;
        const h = SELF_LOOP_BASE + idx * SELF_LOOP_STEP;
        const s: Pt = { x: sh.cx - 17, y: top };
        const e: Pt = { x: sh.cx + 17, y: top };
        const endGap = arrow * 0.62;
        const d = `M ${s.x} ${s.y} C ${s.x} ${s.y - h}, ${e.x} ${e.y - h}, ${e.x} ${e.y - endGap}`;
        const { color, width, dash } = resolveEdgeAppearance(t, settings, theme);
        const lines = labelLines(t);
        const lw = lines.length ? Math.max(...lines.map((l) => estWidth(l, 11))) + 20 : 0;
        geoms.push({
          id: t.id, d, color, width, dash,
          ax: e.x, ay: e.y, aa: Math.PI / 2,
          labelX: sh.cx, labelY: top - h * 0.72,
          labelW: lw, labelH: lines.length ? lines.length * 15 + 9 : 0,
          lines,
        });
      });
      continue;
    }

    const n = list.length;
    list.forEach((t, i) => {
      const src = shapes.get(t.source);
      const dst = shapes.get(t.target);
      if (!src || !dst) return;
      const offset = (i - (n - 1) / 2) * PARALLEL_GAP;
      const { color, width, dash } = resolveEdgeAppearance(t, settings, theme);
      const style = settings.edgeStyle;

      // 锚点方向：折线用轴向，曲线/直线用中心连线方向
      const dc = norm({ x: dst.cx - src.cx, y: dst.cy - src.cy });
      const horiz = Math.abs(dc.x) >= Math.abs(dc.y);
      const axisDir: Pt = horiz
        ? { x: Math.sign(dc.x) || 1, y: 0 }
        : { x: 0, y: Math.sign(dc.y) || 1 };

      let s = boundary(src, style === 'straight' || style === 'bezier' ? dc : axisDir, 2);
      let e = boundary(dst, style === 'straight' || style === 'bezier'
        ? { x: -dc.x, y: -dc.y }
        : { x: -axisDir.x, y: -axisDir.y }, 2);

      // 平行偏移：沿中心连线法向平移两端锚点
      if (offset !== 0) {
        const perp = { x: -dc.y, y: dc.x };
        s = { x: s.x + perp.x * offset, y: s.y + perp.y * offset };
        e = { x: e.x + perp.x * offset, y: e.y + perp.y * offset };
      }

      let d = '';
      let labelX = (s.x + e.x) / 2;
      let labelY = (s.y + e.y) / 2;
      let arrowAngle = Math.atan2(e.y - s.y, e.x - s.x);
      const endGap = arrow * 0.62;

      if (style === 'straight') {
        const dirEnd = norm({ x: e.x - s.x, y: e.y - s.y });
        const e2 = { x: e.x - dirEnd.x * endGap, y: e.y - dirEnd.y * endGap };
        d = `M ${s.x.toFixed(1)} ${s.y.toFixed(1)} L ${e2.x.toFixed(1)} ${e2.y.toFixed(1)}`;
      } else if (style === 'bezier') {
        const k = Math.max(36, Math.min(130, dist(s, e) * 0.38));
        const ns = norm({ x: s.x - src.cx, y: s.y - src.cy });
        const ne = norm({ x: e.x - dst.cx, y: e.y - dst.cy });
        const c1 = { x: s.x + ns.x * k, y: s.y + ns.y * k };
        const c2 = { x: e.x + ne.x * k, y: e.y + ne.y * k };
        const dirEnd = norm({ x: e.x - c2.x, y: e.y - c2.y });
        const e2 = { x: e.x - dirEnd.x * endGap, y: e.y - dirEnd.y * endGap };
        d = `M ${s.x.toFixed(1)} ${s.y.toFixed(1)} C ${c1.x.toFixed(1)} ${c1.y.toFixed(1)}, ${c2.x.toFixed(1)} ${c2.y.toFixed(1)}, ${e2.x.toFixed(1)} ${e2.y.toFixed(1)}`;
        labelX = (s.x + 3 * c1.x + 3 * c2.x + e.x) / 8;
        labelY = (s.y + 3 * c1.y + 3 * c2.y + e.y) / 8;
        arrowAngle = Math.atan2(dirEnd.y, dirEnd.x);
      } else {
        const r = style === 'smoothstep' ? 12 : 0;
        let pts: Pt[];
        if (horiz) {
          const mx = (s.x + e.x) / 2;
          pts = dedupe([s, { x: mx, y: s.y }, { x: mx, y: e.y }, e]);
        } else {
          const my = (s.y + e.y) / 2;
          pts = dedupe([s, { x: s.x, y: my }, { x: e.x, y: my }, e]);
        }
        if (pts.length === 2) {
          const dirEnd = norm({ x: pts[1].x - pts[0].x, y: pts[1].y - pts[0].y });
          pts[1] = { x: pts[1].x - dirEnd.x * endGap, y: pts[1].y - dirEnd.y * endGap };
        } else {
          const last = pts[pts.length - 1];
          const prev = pts[pts.length - 2];
          const dirEnd = norm({ x: last.x - prev.x, y: last.y - prev.y });
          pts[pts.length - 1] = { x: last.x - dirEnd.x * endGap, y: last.y - dirEnd.y * endGap };
          // 标签取中间段中点
          const midIdx = Math.floor(pts.length / 2);
          const midA = pts[midIdx - 1];
          const midB = pts[midIdx];
          labelX = (midA.x + midB.x) / 2;
          labelY = (midA.y + midB.y) / 2;
          arrowAngle = Math.atan2(dirEnd.y, dirEnd.x);
        }
        d = roundedPath(pts, r);
        if (pts.length === 2) {
          labelX = (pts[0].x + pts[1].x) / 2;
          labelY = (pts[0].y + pts[1].y) / 2;
          arrowAngle = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
        }
      }

      const lines = labelLines(t);
      const lw = lines.length ? Math.max(...lines.map((l) => estWidth(l, 11))) + 20 : 0;
      geoms.push({
        id: t.id, d, color, width, dash,
        ax: e.x, ay: e.y, aa: arrowAngle,
        labelX, labelY, labelW: lw,
        labelH: lines.length ? lines.length * 15 + 9 : 0,
        lines,
      });
    });
  }
  return geoms;
}

/** 箭头三角形顶点 */
export function arrowPoints(ax: number, ay: number, angle: number, size: number): string {
  const dx = Math.cos(angle), dy = Math.sin(angle);
  const px = -dy, py = dx;
  const bx = ax - dx * size, by = ay - dy * size;
  return `${ax},${ay} ${bx + px * size * 0.44},${by + py * size * 0.44} ${bx - px * size * 0.44},${by - py * size * 0.44}`;
}

/** 全文档包围盒（结点 + 边标签），供适应视图与导出共用 */
export function docBounds(
  doc: ProjectDoc, settings: ProjectSettings, geoms?: EdgeGeom[]
): { x: number; y: number; w: number; h: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of doc.states) {
    const { w, h } = nodeSize(s, settings);
    minX = Math.min(minX, s.position.x);
    minY = Math.min(minY, s.position.y);
    maxX = Math.max(maxX, s.position.x + w);
    maxY = Math.max(maxY, s.position.y + h);
  }
  for (const g of geoms ?? computeEdgeGeoms(doc, settings, settings.theme)) {
    if (g.labelW > 0) {
      minX = Math.min(minX, g.labelX - g.labelW / 2);
      maxX = Math.max(maxX, g.labelX + g.labelW / 2);
      minY = Math.min(minY, g.labelY - g.labelH / 2);
      maxY = Math.max(maxY, g.labelY + g.labelH / 2);
    }
  }
  if (!isFinite(minX)) return { x: 0, y: 0, w: 800, h: 500 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** 结点上动作行渲染数据（含截断） */
export function renderActionLines(s: ProjectState, settings: ProjectSettings, w: number) {
  return actionLines(s, settings.showActionText).map((l) => ({
    ...l,
    t: (() => {
      const max = w - 30;
      let t = l.t;
      while (t.length > 1 && estWidth(t, 11) > max) t = t.slice(0, -1);
      return estWidth(l.t, 11) > max ? t + '…' : l.t;
    })(),
  }));
}

export type { ProjectTransition };
