/* ============================================================
 * 几何引擎：状态转移的路径 / 锚点 / 平行边 / 自环 / 箭头 / 标签锚点 / 曲率
 * 画布渲染与导出共用同一套数学（WYSIWYG）。
 * ============================================================ */
import type { ProjectDoc, ProjectState, ProjectTransition, ProjectSettings, ThemeMode } from './core';
import { PALETTES, THEME, nodeSize, estWidth, labelLines } from './core';

export interface Pt { x: number; y: number }
export interface NodeShape {
  id: string; x: number; y: number; w: number; h: number;
  cx: number; cy: number; isCircle: boolean; r: number;
}
export function shapesOf(doc: ProjectDoc, settings: ProjectSettings): Map<string, NodeShape> {
  const map = new Map<string, NodeShape>();
  for (const s of doc.states) {
    const { w, h } = nodeSize(s, settings);
    map.set(s.id, { id: s.id, x: s.position.x, y: s.position.y, w, h, cx: s.position.x + w / 2, cy: s.position.y + h / 2, isCircle: s.kind === 'junction' || s.kind === 'start', r: s.kind === 'junction' ? 13 : 11 });
  }
  return map;
}

export interface EdgeGeom {
  id: string; d: string; color: string; width: number; dash?: string;
  ax: number; ay: number; aa: number;
  labelX: number; labelY: number; labelW: number; labelH: number; lines: string[];
  /** 曲率手柄（世界坐标）：仅曲线/折线提供，供拖拽调整 */
  handle?: { x: number; y: number };
  sx: number; sy: number; ex: number; ey: number;
  bendable: boolean; isLoop: boolean;
}

export function resolveEdgeAppearance(t: ProjectTransition, settings: ProjectSettings, theme: ThemeMode) {
  const color = t.lineColor ? PALETTES[t.lineColor][theme].accent : THEME[theme].edge;
  const width = t.lineWidth ?? settings.edgeWidth;
  const dash = t.dashed ? `${Math.max(5, width * 3.4)} ${Math.max(4, width * 2.8)}` : undefined;
  return { color, width, dash };
}

const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);
const norm = (v: Pt): Pt => { const l = Math.hypot(v.x, v.y) || 1; return { x: v.x / l, y: v.y / l }; };
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

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
const dedupe = (pts: Pt[]) => pts.filter((p, i) => i === 0 || dist(p, pts[i - 1]) > 0.5);

const PARALLEL_GAP = 26;
const SELF_LOOP_BASE = 36;
const SELF_LOOP_STEP = 22;

/** 由鼠标世界坐标反算 bend 值（用于拖拽曲率） */
export function bendFromPoint(sx: number, sy: number, ex: number, ey: number, wx: number, wy: number, isStep: boolean): number {
  const mx = (sx + ex) / 2, my = (sy + ey) / 2;
  const dx = ex - sx, dy = ey - sy;
  const len = Math.hypot(dx, dy) || 1;
  if (isStep) {
    // 折线：沿连线方向投影
    return clamp(((wx - mx) * dx + (wy - my) * dy) / len, -len / 2 + 8, len / 2 - 8);
  }
  // 曲线：沿法向投影
  const nx = -dy / len, ny = dx / len;
  return clamp((wx - mx) * nx + (wy - my) * ny, -320, 320);
}

export function computeEdgeGeoms(doc: ProjectDoc, settings: ProjectSettings, theme: ThemeMode): EdgeGeom[] {
  const shapes = shapesOf(doc, settings);
  const arrow = settings.arrowSize;
  const visible = doc.transitions.filter((t) => t.enabled !== false);
  const groups = new Map<string, ProjectTransition[]>();
  for (const t of visible) {
    const key = t.source === t.target ? `self:${t.source}` : `pair:${[t.source, t.target].sort().join('~')}`;
    const arr = groups.get(key);
    if (arr) arr.push(t); else groups.set(key, [t]);
  }
  const geoms: EdgeGeom[] = [];
  for (const [key, list] of groups) {
    if (key.startsWith('self:')) {
      list.forEach((t, idx) => {
        const sh = shapes.get(t.source); if (!sh) return;
        const top = sh.isCircle ? sh.cy - sh.r : sh.y;
        const h = SELF_LOOP_BASE + idx * SELF_LOOP_STEP;
        const s: Pt = { x: sh.cx - 17, y: top };
        const e: Pt = { x: sh.cx + 17, y: top };
        const endGap = arrow * 0.62;
        const d = `M ${s.x} ${s.y} C ${s.x} ${s.y - h}, ${e.x} ${e.y - h}, ${e.x} ${e.y - endGap}`;
        const { color, width, dash } = resolveEdgeAppearance(t, settings, theme);
        const lines = labelLines(t);
        const lw = lines.length ? Math.max(...lines.map((l) => estWidth(l, 11))) + 20 : 0;
        geoms.push({ id: t.id, d, color, width, dash, ax: e.x, ay: e.y, aa: Math.PI / 2, labelX: sh.cx, labelY: top - h * 0.72, labelW: lw, labelH: lines.length ? lines.length * 15 + 9 : 0, lines, sx: s.x, sy: s.y, ex: e.x, ey: e.y, bendable: false, isLoop: true });
      });
      continue;
    }
    const n = list.length;
    list.forEach((t, i) => {
      const src = shapes.get(t.source); const dst = shapes.get(t.target);
      if (!src || !dst) return;
      const offset = (i - (n - 1) / 2) * PARALLEL_GAP;
      const { color, width, dash } = resolveEdgeAppearance(t, settings, theme);
      const style = t.lineStyle ?? settings.edgeStyle;
      const dc = norm({ x: dst.cx - src.cx, y: dst.cy - src.cy });
      const horiz = Math.abs(dc.x) >= Math.abs(dc.y);
      const axisDir: Pt = horiz ? { x: Math.sign(dc.x) || 1, y: 0 } : { x: 0, y: Math.sign(dc.y) || 1 };
      let s = boundary(src, style === 'straight' || style === 'bezier' ? dc : axisDir, 2);
      let e = boundary(dst, style === 'straight' || style === 'bezier' ? { x: -dc.x, y: -dc.y } : { x: -axisDir.x, y: -axisDir.y }, 2);
      if (offset !== 0) {
        const perp = { x: -dc.y, y: dc.x };
        s = { x: s.x + perp.x * offset, y: s.y + perp.y * offset };
        e = { x: e.x + perp.x * offset, y: e.y + perp.y * offset };
      }
      let d = '';
      let labelX = (s.x + e.x) / 2, labelY = (s.y + e.y) / 2;
      let arrowAngle = Math.atan2(e.y - s.y, e.x - s.x);
      let handle: { x: number; y: number } | undefined;
      let bendable = false;
      const endGap = arrow * 0.62;
      const bend = t.bend ?? 0;

      if (style === 'straight') {
        const dirEnd = norm({ x: e.x - s.x, y: e.y - s.y });
        const e2 = { x: e.x - dirEnd.x * endGap, y: e.y - dirEnd.y * endGap };
        d = `M ${s.x.toFixed(1)} ${s.y.toFixed(1)} L ${e2.x.toFixed(1)} ${e2.y.toFixed(1)}`;
      } else if (style === 'bezier') {
        bendable = true;
        const mx = (s.x + e.x) / 2, my = (s.y + e.y) / 2;
        const len = dist(s, e) || 1;
        const nx = -(e.y - s.y) / len, ny = (e.x - s.x) / len;
        // bend=0 时用默认弧度
        const b = bend !== 0 ? bend : clamp(len * 0.18, 18, 60);
        const c = { x: mx + nx * b * 2, y: my + ny * b * 2 };
        const dirEnd = norm({ x: e.x - c.x, y: e.y - c.y });
        const e2 = { x: e.x - dirEnd.x * endGap, y: e.y - dirEnd.y * endGap };
        d = `M ${s.x.toFixed(1)} ${s.y.toFixed(1)} Q ${c.x.toFixed(1)} ${c.y.toFixed(1)} ${e2.x.toFixed(1)} ${e2.y.toFixed(1)}`;
        labelX = (s.x + 2 * c.x + e.x) / 4; labelY = (s.y + 2 * c.y + e.y) / 4;
        arrowAngle = Math.atan2(dirEnd.y, dirEnd.x);
        handle = { x: mx + nx * b, y: my + ny * b };
      } else {
        bendable = true;
        const r = style === 'smoothstep' ? 12 : 0;
        let pts: Pt[];
        if (horiz) {
          const mx = (s.x + e.x) / 2 + bend;
          pts = dedupe([s, { x: mx, y: s.y }, { x: mx, y: e.y }, e]);
        } else {
          const my = (s.y + e.y) / 2 + bend;
          pts = dedupe([s, { x: s.x, y: my }, { x: e.x, y: my }, e]);
        }
        const last = pts[pts.length - 1];
        if (pts.length >= 2) {
          const prev = pts[pts.length - 2];
          const dirEnd = norm({ x: last.x - prev.x, y: last.y - prev.y });
          pts[pts.length - 1] = { x: last.x - dirEnd.x * endGap, y: last.y - dirEnd.y * endGap };
          arrowAngle = Math.atan2(dirEnd.y, dirEnd.x);
        }
        d = roundedPath(pts, r);
        if (pts.length === 2) {
          labelX = (pts[0].x + pts[1].x) / 2; labelY = (pts[0].y + pts[1].y) / 2;
        } else {
          const midIdx = Math.floor(pts.length / 2);
          labelX = (pts[midIdx - 1].x + pts[midIdx].x) / 2; labelY = (pts[midIdx - 1].y + pts[midIdx].y) / 2;
        }
        // 折线手柄 = 拐点
        if (pts.length >= 3) {
          const gp = horiz ? { x: pts[1].x, y: (s.y + e.y) / 2 } : { x: (s.x + e.x) / 2, y: pts[1].y };
          handle = gp;
        }
      }
      const lines = labelLines(t);
      const lw = lines.length ? Math.max(...lines.map((l) => estWidth(l, 11))) + 20 : 0;
      geoms.push({ id: t.id, d, color, width, dash, ax: e.x, ay: e.y, aa: arrowAngle, labelX, labelY, labelW: lw, labelH: lines.length ? lines.length * 15 + 9 : 0, lines, handle, sx: s.x, sy: s.y, ex: e.x, ey: e.y, bendable, isLoop: false });
    });
  }
  return geoms;
}

export function arrowPoints(ax: number, ay: number, angle: number, size: number): string {
  const dx = Math.cos(angle), dy = Math.sin(angle);
  const px = -dy, py = dx;
  const bx = ax - dx * size, by = ay - dy * size;
  return `${ax},${ay} ${bx + px * size * 0.44},${by + py * size * 0.44} ${bx - px * size * 0.44},${by - py * size * 0.44}`;
}
