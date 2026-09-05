/* ============================================================
 * studio —— 流程图布局 / 子流程浮动面板 / 多选对齐 / 持久化 / 规范化 / 示例
 * ============================================================ */
import type { FlowNode, FlowEdge, InnerFlow, Page, PageType, StudioDoc, ThemeMode, WbShape, ProjectState, ProjectTransition } from './core';
import { makePage, uid, SHAPE_COLORS, defaultSettings, ensureStartNode } from './core';

export type Dir = 'LR' | 'TB';
export interface Rect { x: number; y: number; w: number; h: number }

export const C_PAD = 18;
export const C_HEADER = 34;
export const PANEL_MIN_W = 260;
export const PANEL_MIN_H = 150;

export function flowNodeSize(n: FlowNode): { w: number; h: number } { return { w: n.w, h: n.h }; }

export function panelSize(n: FlowNode): { w: number; h: number } {
  const inner = n.inner;
  if (!inner || !inner.nodes.length) return { w: Math.max(n.w, PANEL_MIN_W), h: PANEL_MIN_H };
  let x2 = 0, y2 = 0;
  for (const k of inner.nodes) {
    x2 = Math.max(x2, k.x + k.w); y2 = Math.max(y2, k.y + k.h);
    if (k.kind === 'subprocess' && k.expanded && k.expandPos) {
      const ps = panelSize(k);
      x2 = Math.max(x2, k.expandPos.x + ps.w); y2 = Math.max(y2, k.expandPos.y + ps.h);
    }
  }
  return { w: Math.max(PANEL_MIN_W, x2 + C_PAD * 2), h: Math.max(PANEL_MIN_H, y2 + C_HEADER + C_PAD) };
}

export interface FlatFlowNode { n: FlowNode; path: string[]; x: number; y: number; w: number; h: number }
export interface FlatFlowEdge { e: FlowEdge; path: string[]; a: FlatFlowNode; b: FlatFlowNode }
export interface FlatPanel { id: string; path: string[]; n: FlowNode; x: number; y: number; w: number; h: number }

export function flattenFlow(nodes: FlowNode[], edges: FlowEdge[], ox = 0, oy = 0, path: string[] = []) {
  const flatN: FlatFlowNode[] = []; const flatE: FlatFlowEdge[] = []; const panels: FlatPanel[] = [];
  const posMap = new Map<string, FlatFlowNode>();
  const walk = (ns: FlowNode[], es: FlowEdge[], wx: number, wy: number, p: string[]) => {
    for (const n of ns) {
      const f: FlatFlowNode = { n, path: p, x: wx + n.x, y: wy + n.y, w: n.w, h: n.h };
      flatN.push(f); posMap.set(n.id, f);
      if (n.kind === 'subprocess' && n.expanded && n.inner) {
        const ep = n.expandPos ?? { x: n.x + n.w + 72, y: n.y };
        const ps = panelSize(n);
        panels.push({ id: n.id, path: p, n, x: wx + ep.x, y: wy + ep.y, w: ps.w, h: ps.h });
        walk(n.inner.nodes, n.inner.edges, wx + ep.x + C_PAD, wy + ep.y + C_HEADER, [...p, n.id]);
      }
    }
    for (const e of es) {
      const a = posMap.get(e.source); const b = posMap.get(e.target);
      if (a && b) flatE.push({ e, path: p, a, b });
    }
  };
  walk(nodes, edges, ox, oy, path);
  return { nodes: flatN, edges: flatE, panels };
}

/* ---------------- 树工具 ---------------- */
export function findFlowNode(nodes: FlowNode[], id: string): FlowNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.inner) { const r = findFlowNode(n.inner.nodes, id); if (r) return r; }
  }
  return null;
}
export function updateFlowNode(nodes: FlowNode[], id: string, patch: Partial<FlowNode>): FlowNode[] {
  return nodes.map((n) => {
    if (n.id === id) return { ...n, ...patch };
    if (n.inner) {
      const inner = updateFlowNode(n.inner.nodes, id, patch);
      if (inner !== n.inner.nodes) return { ...n, inner: { nodes: inner, edges: n.inner.edges } };
    }
    return n;
  });
}
export function mapFlowLevel(nodes: FlowNode[], edges: FlowEdge[], path: string[], fn: (f: InnerFlow) => InnerFlow): { nodes: FlowNode[]; edges: FlowEdge[] } {
  if (!path.length) { const r = fn({ nodes, edges }); return { nodes: r.nodes, edges: r.edges }; }
  const [head, ...rest] = path;
  return {
    nodes: nodes.map((n) => {
      if (n.id !== head || !n.inner) return n;
      const r = mapFlowLevel(n.inner.nodes, n.inner.edges, rest, fn);
      return { ...n, inner: r };
    }),
    edges,
  };
}

/* ---------------- 层级布局（仅作用于单层，子流程按紧凑尺寸占位） ---------------- */
const NODE_GAP = 54;
const LAYER_GAP = 110;
export function layoutFlowGraph(nodes: FlowNode[], edges: FlowEdge[], dir: Dir): FlowNode[] {
  if (!nodes.length) return nodes;
  const size = (n: FlowNode) => flowNodeSize(n);
  const ids = nodes.map((n) => n.id);
  const indeg = new Map<string, number>(); ids.forEach((id) => indeg.set(id, 0));
  const adj = new Map<string, string[]>(); ids.forEach((id) => adj.set(id, []));
  for (const e of edges) {
    if (indeg.has(e.source) && indeg.has(e.target) && e.source !== e.target) {
      indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
      adj.get(e.source)!.push(e.target);
    }
  }
  // 拓扑分层（Kahn），环上结点兜底放最后一层
  const layer = new Map<string, number>();
  const queue = ids.filter((id) => (indeg.get(id) ?? 0) === 0);
  queue.forEach((id) => layer.set(id, 0));
  const indeg2 = new Map(indeg);
  const q = [...queue];
  while (q.length) {
    const u = q.shift()!;
    for (const v of adj.get(u) ?? []) {
      layer.set(v, Math.max(layer.get(v) ?? 0, (layer.get(u) ?? 0) + 1));
      indeg2.set(v, (indeg2.get(v) ?? 1) - 1);
      if (indeg2.get(v) === 0) q.push(v);
    }
  }
  let maxLayer = 0; layer.forEach((l) => { maxLayer = Math.max(maxLayer, l); });
  ids.forEach((id) => { if (!layer.has(id)) layer.set(id, maxLayer + 1); });
  const layers = new Map<number, string[]>();
  ids.forEach((id) => { const l = layer.get(id)!; if (!layers.has(l)) layers.set(l, []); layers.get(l)!.push(id); });
  // 逐层排放
  const placed = new Map<string, { m: number; c: number }>();
  let cursorM = 0;
  const sortedLayers = [...layers.keys()].sort((a, b) => a - b);
  for (const l of sortedLayers) {
    const ln = layers.get(l)!.map((id) => nodes.find((n) => n.id === id)!);
    let cursorC = 0, maxM = 0;
    for (const n of ln) {
      const s = size(n);
      const cross = dir === 'LR' ? s.h : s.w;
      const main = dir === 'LR' ? s.w : s.h;
      placed.set(n.id, { m: cursorM, c: cursorC + cross / 2 });
      cursorC += cross + NODE_GAP;
      maxM = Math.max(maxM, main);
    }
    cursorM += maxM + LAYER_GAP;
  }
  // 归一化到 (0,0)：按整体包围盒平移，保证所有坐标 ≥ 0（不越出面板）
  let minM = Infinity, minC = Infinity;
  placed.forEach((p) => { minM = Math.min(minM, p.m); minC = Math.min(minC, p.c); });
  const rects = nodes.map((n) => {
    const p = placed.get(n.id)!; const s = size(n);
    const m = p.m - minM, c = p.c - minC - (dir === 'LR' ? s.h : s.w) / 2;
    return dir === 'LR' ? { n, x: m, y: c, w: s.w, h: s.h } : { n, x: c, y: m, w: s.w, h: s.h };
  });
  const bx = Math.min(...rects.map((r) => r.x));
  const by = Math.min(...rects.map((r) => r.y));
  return rects.map((r) => ({ ...r.n, x: Math.round(r.x - bx), y: Math.round(r.y - by) }));
}
export function layoutInner(n: FlowNode, dir: Dir): FlowNode {
  if (n.kind !== 'subprocess' || !n.inner) return n;
  return { ...n, inner: { nodes: layoutFlowGraph(n.inner.nodes, n.inner.edges, dir), edges: n.inner.edges } };
}

/* ---------------- 子流程展开/收纳（碰撞避让选址） ---------------- */
const EXPAND_GAP = 72;
export function computeExpandPos(node: Rect, pw: number, ph: number, obstacles: Rect[], flowDir: Dir): { x: number; y: number } {
  const cx = node.x + node.w / 2, cy = node.y + node.h / 2;
  const horiz = flowDir === 'LR';
  const candidates = (m: number) => (horiz
    ? [{ x: cx - pw / 2, y: node.y + node.h + m }, { x: cx - pw / 2, y: node.y - m - ph }, { x: node.x + node.w + m, y: cy - ph / 2 }, { x: node.x - m - pw, y: cy - ph / 2 }]
    : [{ x: node.x + node.w + m, y: cy - ph / 2 }, { x: node.x - m - pw, y: cy - ph / 2 }, { x: cx - pw / 2, y: node.y + node.h + m }, { x: cx - pw / 2, y: node.y - m - ph }]);
  const M = 14;
  const hit = (r: Rect) => obstacles.some((o) => r.x < o.x + o.w + M && r.x + r.w + M > o.x && r.y < o.y + o.h + M && r.y + r.h + M > o.y);
  for (const m of [EXPAND_GAP, EXPAND_GAP * 2, EXPAND_GAP * 3.2, EXPAND_GAP * 4.6]) {
    for (const c of candidates(m)) if (!hit({ x: c.x, y: c.y, w: pw, h: ph })) return { x: Math.round(c.x), y: Math.round(c.y) };
  }
  const fb = candidates(EXPAND_GAP)[0];
  return { x: Math.round(fb.x), y: Math.round(fb.y) };
}
export function toggleSubInDoc(nodes: FlowNode[], edges: FlowEdge[], id: string, flowDir: Dir, extraObstacles: Rect[] = []): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const locate = (ns: FlowNode[]): { ns: FlowNode[]; n: FlowNode } | null => {
    for (const n of ns) if (n.id === id) return { ns, n };
    for (const n of ns) if (n.inner) { const r = locate(n.inner.nodes); if (r) return r; }
    return null;
  };
  const loc = locate(nodes);
  if (!loc || loc.n.kind !== 'subprocess') return { nodes, edges };
  const n = loc.n;
  if (n.expanded) return { nodes: updateFlowNode(nodes, id, { expanded: false }), edges };
  let inner = n.inner; let expandPos = n.expandPos;
  if (!expandPos && inner && inner.nodes.length) inner = { nodes: layoutFlowGraph(inner.nodes, inner.edges, flowDir), edges: inner.edges };
  const tmp: FlowNode = { ...n, inner, expanded: true };
  if (!expandPos) {
    const ps = panelSize(tmp);
    const obstacles: Rect[] = [...extraObstacles];
    for (const m of loc.ns) {
      if (m.id === id) continue;
      obstacles.push({ x: m.x, y: m.y, w: m.w, h: m.h });
      if (m.kind === 'subprocess' && m.expanded && m.expandPos) {
        const mps = panelSize(m);
        obstacles.push({ x: m.expandPos.x, y: m.expandPos.y, w: mps.w, h: mps.h });
      }
    }
    expandPos = computeExpandPos(n, ps.w, ps.h, obstacles, flowDir);
  }
  return { nodes: updateFlowNode(nodes, id, { expanded: true, inner, expandPos }), edges };
}

/* ---------------- 多选对齐 / 分布 ---------------- */
export interface AlItem { id: string; x: number; y: number; w: number; h: number }
export function distribute(items: AlItem[], axis: 'x' | 'y'): Map<string, { x: number; y: number }> {
  const sorted = [...items].sort((a, b) => (axis === 'x' ? a.x - b.x : a.y - b.y));
  const res = new Map<string, { x: number; y: number }>();
  if (sorted.length < 3) { sorted.forEach((i) => res.set(i.id, { x: i.x, y: i.y })); return res; }
  const first = sorted[0], last = sorted[sorted.length - 1];
  const inner = sorted.slice(1, -1);
  const span = axis === 'x' ? last.x - (first.x + first.w) : last.y - (first.y + first.h);
  const innerSize = inner.reduce((a, i) => a + (axis === 'x' ? i.w : i.h), 0);
  const gap = (span - innerSize) / (inner.length + 1);
  let cursor = axis === 'x' ? first.x + first.w + gap : first.y + first.h + gap;
  res.set(first.id, { x: first.x, y: first.y });
  res.set(last.id, { x: last.x, y: last.y });
  for (const i of inner) {
    res.set(i.id, axis === 'x' ? { x: Math.round(cursor), y: i.y } : { x: i.x, y: Math.round(cursor) });
    cursor += (axis === 'x' ? i.w : i.h) + gap;
  }
  return res;
}

/* ---------------- 持久化 / 规范化 ---------------- */
const LS_KEY = 'stateflow-studio.pages.v3';
const FLOW_KINDS = ['start', 'process', 'decision', 'io', 'subprocess'] as const;
const SHAPE_KEYS = Object.keys(SHAPE_COLORS);

function normalizeFlowNodes(raw: unknown): FlowNode[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((n) => n && typeof n.id === 'string').map((n) => {
    const kind = FLOW_KINDS.includes(n.kind) ? n.kind : 'process';
    const colorKey = SHAPE_KEYS.includes(n.color) ? n.color : undefined;
    const light = SHAPE_COLORS[(colorKey ?? 'indigo') as keyof typeof SHAPE_COLORS].light;
    const node: FlowNode = {
      id: n.id, kind, text: typeof n.text === 'string' ? n.text : '',
      x: Number(n.x) || 0, y: Number(n.y) || 0,
      w: Number(n.w) || 120, h: Number(n.h) || 50,
      color: (colorKey ?? 'indigo') as FlowNode['color'],
      fill: typeof n.fill === 'string' ? n.fill : light.fill,
      stroke: typeof n.stroke === 'string' ? n.stroke : light.stroke,
    };
    if (kind === 'subprocess') {
      let innerNodes = normalizeFlowNodes(n.inner?.nodes);
      if (innerNodes.length) {
        const minX = Math.min(...innerNodes.map((k) => k.x));
        const minY = Math.min(...innerNodes.map((k) => k.y));
        if (minX < 0 || minY < 0) innerNodes = innerNodes.map((k) => ({ ...k, x: k.x + (minX < 0 ? -minX : 0), y: k.y + (minY < 0 ? -minY : 0) }));
      }
      node.inner = { nodes: innerNodes, edges: normalizeFlowEdges(n.inner?.edges) };
      if (n.expandPos && Number.isFinite(n.expandPos.x) && Number.isFinite(n.expandPos.y)) node.expandPos = { x: Number(n.expandPos.x), y: Number(n.expandPos.y) };
      node.expanded = n.expanded === true && !!node.expandPos;
    }
    return node;
  });
}
function normalizeFlowEdges(raw: unknown): FlowEdge[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((e) => e && typeof e.source === 'string' && typeof e.target === 'string')
    .map((e) => ({ id: typeof e.id === 'string' ? e.id : uid('fe'), source: e.source, target: e.target, label: e.label || undefined }));
}
function normalizeWb(raw: unknown): WbShape[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((w) => w && typeof w.id === 'string').map((w) => ({
    id: w.id, kind: w.kind, x: Number(w.x) || 0, y: Number(w.y) || 0, w: Number(w.w) || 100, h: Number(w.h) || 80,
    color: SHAPE_KEYS.includes(w.color) ? w.color : undefined,
    fill: typeof w.fill === 'string' ? w.fill : 'none',
    stroke: typeof w.stroke === 'string' ? w.stroke : '#64748b',
    strokeWidth: Number(w.strokeWidth) || 2,
    text: typeof w.text === 'string' ? w.text : undefined,
    src: typeof w.src === 'string' ? w.src : undefined,
  }));
}
function normalizeStates(raw: unknown): ProjectState[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((s) => s && typeof s.id === 'string').map((s) => ({
    id: s.id, name: typeof s.name === 'string' ? s.name : 'State',
    kind: ['state', 'terminal', 'junction', 'start'].includes(s.kind) ? s.kind : 'state',
    entry: s.entry || undefined, during: s.during || undefined, exit: s.exit || undefined, note: s.note || undefined,
    color: (['indigo', 'blue', 'teal', 'green', 'amber', 'rose', 'violet', 'slate'].includes(s.color) ? s.color : 'indigo'),
    position: { x: Number(s.position?.x) || 0, y: Number(s.position?.y) || 0 },
  }));
}
function normalizeTransitions(raw: unknown): ProjectTransition[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((t) => t && typeof t.id === 'string' && typeof t.source === 'string' && typeof t.target === 'string').map((t) => ({
    id: t.id, source: t.source, target: t.target,
    event: t.event || undefined, condition: t.condition || undefined,
    conditionAction: t.conditionAction || undefined, transitionAction: t.transitionAction || undefined,
    enabled: t.enabled !== false, note: t.note || undefined,
    lineWidth: typeof t.lineWidth === 'number' ? t.lineWidth : undefined,
    dashed: t.dashed === true, lineColor: t.lineColor || undefined,
    lineStyle: ['bezier', 'smoothstep', 'orthogonal', 'straight'].includes(t.lineStyle) ? t.lineStyle : undefined,
    bend: typeof t.bend === 'number' ? t.bend : undefined,
  }));
}
function normalizePage(raw: unknown, i: number): Page {
  const p = (raw ?? {}) as Partial<Page>;
  const base = makePage(p.type === 'whiteboard' ? 'whiteboard' : 'canvas', typeof p.name === 'string' && p.name ? p.name : `页面 ${i + 1}`);
  base.id = typeof p.id === 'string' ? p.id : base.id;
  base.states = normalizeStates(p.states);
  base.transitions = normalizeTransitions(p.transitions);
  base.flowNodes = normalizeFlowNodes(p.flowNodes);
  base.flowEdges = normalizeFlowEdges(p.flowEdges);
  base.flowDir = p.flowDir === 'LR' ? 'LR' : 'TB';
  base.wbShapes = normalizeWb(p.wbShapes);
  return ensureStartNode(base);
}
export function normalizeStudio(raw: unknown): StudioDoc {
  const d = (raw ?? {}) as Partial<StudioDoc>;
  if (!Array.isArray(d.pages) || !d.pages.length) throw new Error('bad doc');
  const pages = d.pages.map(normalizePage);
  const st = (d.settings ?? {}) as Partial<StudioDoc['settings']>;
  return {
    version: 3,
    name: typeof d.name === 'string' && d.name ? d.name : '未命名工程',
    pages,
    activePageId: pages.some((p) => p.id === d.activePageId) ? (d.activePageId as string) : pages[0].id,
    settings: { ...defaultSettings(st.theme === 'dark' ? 'dark' : 'light'), ...st, theme: st.theme === 'dark' ? 'dark' : 'light' },
  };
}
export function loadStudio(initialTheme: ThemeMode): StudioDoc {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return normalizeStudio(JSON.parse(raw));
  } catch { /* 损坏则回退示例 */ }
  return sampleDoc(initialTheme);
}
export function saveStudio(doc: StudioDoc) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(doc)); } catch { /* 忽略配额错误 */ }
}

/* ---------------- 示例工程 ---------------- */
export function sampleDoc(theme: ThemeMode): StudioDoc {
  const page = makePage('canvas', '交通信号灯');
  const st = (name: string, kind: ProjectState['kind'], x: number, y: number, color: ProjectState['color'], extra?: Partial<ProjectState>) => {
    const s: ProjectState = { id: uid('s'), name, kind, color, position: { x, y }, ...extra };
    page.states.push(s); return s;
  };
  const red = st('红灯', 'state', 240, 120, 'rose', { during: 'lamp = RED;', entry: 'cnt = 0;' });
  const green = st('绿灯', 'state', 520, 120, 'green', { during: 'lamp = GREEN;' });
  const yellow = st('黄灯', 'state', 520, 320, 'amber', { during: 'lamp = YELLOW;' });
  const off = st('关闭', 'terminal', 240, 320, 'slate');
  const tr = (source: string, target: string, parts: Partial<ProjectTransition>) =>
    page.transitions.push({ id: uid('t'), source, target, enabled: true, ...parts });
  tr('__missing__', red.id, {}); // 占位，稍后替换为 start
  page.transitions.pop();
  const startTr: ProjectTransition = { id: uid('t'), source: '__start__', target: red.id, enabled: true };
  page.transitions.push(startTr);
  tr(red.id, green.id, { event: 'TICK', condition: 'cnt >= 30', conditionAction: 'cnt = 0;', transitionAction: 'next();' });
  tr(green.id, yellow.id, { event: 'TICK', condition: 'cnt >= 25', transitionAction: 'next();' });
  tr(yellow.id, red.id, { event: 'TICK', condition: 'cnt >= 5', transitionAction: 'next();' });
  tr(red.id, red.id, { event: 'TICK', condition: 'cnt < 30', conditionAction: 'cnt++;' });
  tr(red.id, off.id, { event: 'CMD_OFF' });
  tr(off.id, red.id, { event: 'CMD_ON', transitionAction: 'reset();' });
  const p2 = makePage('whiteboard', '白板');
  const doc: StudioDoc = { version: 3, name: '交通信号灯', pages: [ensureStartNode(page), p2], activePageId: page.id, settings: defaultSettings(theme) };
  return doc;
}
