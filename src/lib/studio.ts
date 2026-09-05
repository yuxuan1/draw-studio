/* ============================================================
 * 统一画布数据层 v2
 * · 多页面：画布页（状态机 + 流程图）/ 白板页
 * · 子流程：可递归展开的容器节点（[[...]]），内部是完整小流程图
 * · 流程图以「结点 + 连线」建模，同类型元素自由连线
 * ============================================================ */
import type {
  ProjectState, ProjectTransition, ProjectSettings, NodeKind, PaletteColor,
} from './core';
import { defaultSettings } from './core';

export type FlowKind = 'start' | 'process' | 'decision' | 'io' | 'subprocess';
export type PageType = 'canvas' | 'whiteboard';
export type Dir = 'LR' | 'TB';
export type WbKind = 'image' | 'rect' | 'ellipse' | 'arrow' | 'line' | 'text';

export interface FlowEdge { id: string; source: string; target: string; label?: string }
export interface InnerFlow { nodes: FlowNode[]; edges: FlowEdge[] }

export interface FlowNode {
  id: string;
  kind: FlowKind;
  text: string;
  x: number; y: number; w: number; h: number;   // 结点紧凑尺寸（主流程占位，展开后也不变）
  fill: string; stroke: string;
  inner?: InnerFlow;      // 仅 subprocess：内部小流程图
  expanded?: boolean;     // 仅 subprocess：是否展开
  expandPos?: { x: number; y: number };  // 仅 subprocess：展开面板在本层坐标系的位置（记忆）
}

export interface WbShape {
  id: string; kind: WbKind;
  x: number; y: number; w: number; h: number;
  fill: string; stroke: string; strokeWidth: number;
  text?: string; src?: string;
}

export interface Page {
  id: string;
  name: string;
  type: PageType;
  /* 画布页内容 */
  states: ProjectState[];
  transitions: ProjectTransition[];
  flowNodes: FlowNode[];
  flowEdges: FlowEdge[];
  flowDir: Dir;
  /* 白板页内容 */
  wbShapes: WbShape[];
}

export interface StudioDoc {
  version: 2;
  name: string;
  settings: ProjectSettings;
  pages: Page[];
  activePageId: string;
}

let seq = 0;
export function nid(prefix: string): string {
  seq = (seq + 1) % 1296;
  return `${prefix}_${Date.now().toString(36).slice(-4)}${seq.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

/* ---------------- 工厂 ---------------- */

export function makePage(type: PageType, name: string): Page {
  return {
    id: nid('p'), name, type,
    states: [], transitions: [], flowNodes: [], flowEdges: [], flowDir: 'TB',
    wbShapes: [],
  };
}

export function defaultStudioDoc(name = '未命名工程'): StudioDoc {
  const p = makePage('canvas', '画布 1');
  return { version: 2, name, settings: defaultSettings(), pages: [p], activePageId: p.id };
}

export function makeSmState(kind: NodeKind, x: number, y: number, name: string): ProjectState {
  return {
    id: nid('s'), name, kind,
    color: (kind === 'junction' || kind === 'start' ? 'slate' : 'indigo') as PaletteColor,
    position: { x, y },
  };
}

const FLOW_DEFAULTS: Record<FlowKind, { w: number; h: number; text: string; fill: string; stroke: string }> = {
  start:      { w: 118, h: 44, text: '开始',     fill: '#dcfce7', stroke: '#22c55e' },
  process:    { w: 132, h: 52, text: '新流程',   fill: '#eef2ff', stroke: '#6366f1' },
  decision:   { w: 148, h: 74, text: '判定?',    fill: '#fef3c7', stroke: '#f59e0b' },
  io:         { w: 140, h: 52, text: '输入/输出', fill: '#e0f2fe', stroke: '#0ea5e9' },
  subprocess: { w: 190, h: 64, text: '子流程',   fill: '#f3e8ff', stroke: '#a855f7' },
};

export function makeFlowNode(kind: FlowKind, x: number, y: number): FlowNode {
  const d = FLOW_DEFAULTS[kind];
  const n: FlowNode = { id: nid('f'), kind, text: d.text, x, y, w: d.w, h: d.h, fill: d.fill, stroke: d.stroke };
  if (kind === 'subprocess') { n.inner = { nodes: [], edges: [] }; n.expanded = false; }
  return n;
}

export function makeWbShape(kind: WbKind, x: number, y: number): WbShape {
  const base: WbShape = {
    id: nid('w'), kind, x, y, w: 160, h: 100,
    fill: 'rgba(99,102,241,0.16)', stroke: '#6366f1', strokeWidth: 2,
  };
  if (kind === 'ellipse') { base.fill = 'rgba(14,165,233,0.16)'; base.stroke = '#0ea5e9'; }
  if (kind === 'arrow') { base.w = 160; base.h = 0; base.fill = 'none'; base.stroke = '#f43f5e'; base.strokeWidth = 2.5; }
  if (kind === 'line') { base.w = 160; base.h = 0; base.fill = 'none'; base.stroke = '#64748b'; base.strokeWidth = 2; }
  if (kind === 'text') { base.w = 180; base.h = 40; base.fill = 'none'; base.stroke = 'transparent'; base.text = '双击编辑文字'; }
  return base;
}

/* ---------------- 子流程几何 ---------------- */

export const C_PAD = 18;     // 面板内边距
export const C_HEADER = 34;  // 面板头部高度
export const PANEL_MIN_W = 260;
export const PANEL_MIN_H = 150;

/** 结点紧凑尺寸：子流程结点在主流程中永远只占这一小块（保证主布局稳定） */
export function flowNodeSize(n: FlowNode): { w: number; h: number } {
  return { w: n.w, h: n.h };
}

/** 展开面板尺寸：由内部内容包围盒 + 头部 + 内边距推得（递归计入嵌套面板） */
export function panelSize(n: FlowNode): { w: number; h: number } {
  const inner = n.inner;
  if (!inner || !inner.nodes.length) return { w: Math.max(n.w, PANEL_MIN_W), h: PANEL_MIN_H };
  let x2 = 0, y2 = 0;
  for (const k of inner.nodes) {
    x2 = Math.max(x2, k.x + k.w);
    y2 = Math.max(y2, k.y + k.h);
    if (k.kind === 'subprocess' && k.expanded && k.expandPos) {
      const ps = panelSize(k);
      x2 = Math.max(x2, k.expandPos.x + ps.w);
      y2 = Math.max(y2, k.expandPos.y + ps.h);
    }
  }
  return { w: Math.max(PANEL_MIN_W, x2 + C_PAD * 2), h: Math.max(PANEL_MIN_H, y2 + C_HEADER + C_PAD) };
}

export interface FlatFlowNode { n: FlowNode; path: string[]; x: number; y: number; w: number; h: number }
export interface FlatFlowEdge { e: FlowEdge; path: string[]; a: FlatFlowNode; b: FlatFlowNode }
export interface FlatPanel { id: string; path: string[]; n: FlowNode; x: number; y: number; w: number; h: number }

/**
 * 递归展平：子流程结点本体按紧凑尺寸落在原位；
 * 展开的面板以其记忆位置 expandPos 为原点独立摆放，内部结点换算到面板内容区。
 */
export function flattenFlow(
  nodes: FlowNode[], edges: FlowEdge[], ox = 0, oy = 0, path: string[] = [],
): { nodes: FlatFlowNode[]; edges: FlatFlowEdge[]; panels: FlatPanel[] } {
  const flatN: FlatFlowNode[] = [];
  const flatE: FlatFlowEdge[] = [];
  const panels: FlatPanel[] = [];
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

/** 对 path 指定层级的 {nodes, edges} 做变换（path=[] 为顶层） */
export function mapFlowLevel(
  nodes: FlowNode[], edges: FlowEdge[], path: string[],
  fn: (f: InnerFlow) => InnerFlow,
): { nodes: FlowNode[]; edges: FlowEdge[] } {
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

/** 递归查找结点 */
export function findFlowNode(nodes: FlowNode[], id: string): FlowNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.inner) { const f = findFlowNode(n.inner.nodes, id); if (f) return f; }
  }
  return null;
}

/** 递归更新结点（任意层级，按 id） */
export function updateFlowNode(nodes: FlowNode[], id: string, patch: Partial<FlowNode>): FlowNode[] {
  return nodes.map((n) => {
    if (n.id === id) return { ...n, ...patch };
    if (n.inner) return { ...n, inner: { ...n.inner, nodes: updateFlowNode(n.inner.nodes, id, patch) } };
    return n;
  });
}

/** 递归删除：按 id 移除结点（含子树）、关联连线或指定连线 */
export function pruneFlow(nodes: FlowNode[], edges: FlowEdge[], id: string): InnerFlow {
  const ns = nodes
    .filter((n) => n.id !== id)
    .map((n) => (n.inner ? { ...n, inner: pruneFlow(n.inner.nodes, n.inner.edges, id) } : n));
  const es = edges.filter((e) => e.id !== id && e.source !== id && e.target !== id);
  return { nodes: ns, edges: es };
}

/* ---------------- 流程图层级布局（支持子流程嵌套，后序递归） ---------------- */

const LAYER_GAP = 96;
const NODE_GAP = 30;

/**
 * 层级布局（仅作用于传入的这一层；子流程按紧凑尺寸占位，内部位置不被改动）。
 * 输出坐标从 (0,0) 起算 —— 对子流程内部调用时即为面板内容区坐标。
 */
export function layoutFlowGraph(nodes: FlowNode[], edges: FlowEdge[], dir: Dir): FlowNode[] {
  if (!nodes.length) return nodes;
  const ns = nodes;
  const size = (n: FlowNode) => flowNodeSize(n);
  const ids = new Set(ns.map((n) => n.id));
  const es = edges.filter((e) => ids.has(e.source) && ids.has(e.target) && e.source !== e.target);

  /* 2) 最长路径分层（Kahn；环上结点追加到末层） */
  const indeg = new Map(ns.map((n) => [n.id, 0]));
  const adj = new Map<string, string[]>();
  for (const e of es) {
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
    adj.set(e.source, [...(adj.get(e.source) ?? []), e.target]);
  }
  const layer = new Map<string, number>();
  const queue = ns.filter((n) => indeg.get(n.id) === 0).map((n) => n.id);
  queue.forEach((id) => layer.set(id, 0));
  let qi = 0;
  while (qi < queue.length) {
    const u = queue[qi++];
    for (const v of adj.get(u) ?? []) {
      layer.set(v, Math.max(layer.get(v) ?? 0, (layer.get(u) ?? 0) + 1));
      indeg.set(v, indeg.get(v)! - 1);
      if (indeg.get(v) === 0) queue.push(v);
    }
  }
  let maxL = 0;
  layer.forEach((l) => { maxL = Math.max(maxL, l); });
  for (const n of ns) if (!layer.has(n.id)) layer.set(n.id, ++maxL);

  /* 3) 层内排序：原始顺序 + 一轮重心法 */
  const layers: FlowNode[][] = [];
  for (const n of ns) {
    const l = layer.get(n.id)!;
    (layers[l] ??= []).push(n);
  }
  const pred = new Map<string, string[]>();
  for (const e of es) pred.set(e.target, [...(pred.get(e.target) ?? []), e.source]);
  for (let l = 1; l < layers.length; l++) {
    const prevOrder = new Map(layers[l - 1].map((n, i) => [n.id, i]));
    layers[l].sort((a, b) => {
      const bar = (n: FlowNode) => {
        const ps = (pred.get(n.id) ?? []).map((p) => prevOrder.get(p)).filter((v) => v !== undefined) as number[];
        return ps.length ? ps.reduce((s, v) => s + v, 0) / ps.length : 0;
      };
      return bar(a) - bar(b);
    });
  }

  /* 4) 放置：主轴逐层推进，副轴居中堆叠 */
  const placed = new Map<string, { m: number; c: number }>();
  let cursorM = 0;
  for (const ln of layers) {
    if (!ln) continue;
    const total = ln.reduce((a, n) => a + (dir === 'LR' ? size(n).h : size(n).w), 0) + NODE_GAP * (ln.length - 1);
    let cursorC = -total / 2;
    let maxM = 0;
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

  /* 5) 归一化到 (0,0) 并写回坐标 */
  let minM = Infinity, minC = Infinity;
  placed.forEach((p) => { minM = Math.min(minM, p.m); minC = Math.min(minC, p.c); });
  return ns.map((n) => {
    const p = placed.get(n.id)!;
    const s = size(n);
    const m = p.m - minM, c = p.c - minC - (dir === 'LR' ? s.h : s.w) / 2;
    return dir === 'LR' ? { ...n, x: m, y: c } : { ...n, x: c, y: m };
  });
}

/** 重排子流程内部（面板内容区坐标），不触碰面板位置 */
export function layoutInner(n: FlowNode, dir: Dir): FlowNode {
  if (n.kind !== 'subprocess' || !n.inner) return n;
  return { ...n, inner: { nodes: layoutFlowGraph(n.inner.nodes, n.inner.edges, dir), edges: n.inner.edges } };
}

/**
 * 展开/收纳子流程（画布与属性面板共用的唯一入口）。
 * 展开：首次→内部自动布局 + 同层碰撞避让选址；再次→复用记忆位置。
 * 收纳：仅收起，内部布局与面板位置全部保留。
 */
export function toggleSubInDoc(
  nodes: FlowNode[], edges: FlowEdge[], id: string, flowDir: Dir, extraObstacles: Rect[] = [],
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const locate = (ns: FlowNode[], es: FlowEdge[]): { ns: FlowNode[]; n: FlowNode } | null => {
    for (const n of ns) if (n.id === id) return { ns, n };
    for (const n of ns) if (n.inner) {
      const r = locate(n.inner.nodes, n.inner.edges);
      if (r) return r;
    }
    return null;
  };
  const loc = locate(nodes, edges);
  if (!loc || loc.n.kind !== 'subprocess') return { nodes, edges };
  const n = loc.n;
  if (n.expanded) {
    return { nodes: updateFlowNode(nodes, id, { expanded: false }), edges };
  }
  let inner = n.inner;
  let expandPos = n.expandPos;
  if (!expandPos && inner && inner.nodes.length) {
    inner = { nodes: layoutFlowGraph(inner.nodes, inner.edges, flowDir), edges: inner.edges };
  }
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

/* ---------------- 面板智能选址（碰撞避让） ---------------- */

export interface Rect { x: number; y: number; w: number; h: number }
const EXPAND_GAP = 72;

/**
 * 为展开面板挑选位置：优先主流程的侧向（横向流程→下/上，纵向流程→右/左），
 * 逐个候选做碰撞检测；无空位时逐圈向外搜索。返回的坐标与结点同坐标系。
 */
export function computeExpandPos(
  node: Rect, pw: number, ph: number, obstacles: Rect[], flowDir: Dir,
): { x: number; y: number } {
  const cx = node.x + node.w / 2, cy = node.y + node.h / 2;
  const horiz = flowDir === 'LR';
  const candidates = (m: number): { x: number; y: number }[] => (horiz
    ? [
        { x: cx - pw / 2, y: node.y + node.h + m },   // 下方
        { x: cx - pw / 2, y: node.y - m - ph },        // 上方
        { x: node.x + node.w + m, y: cy - ph / 2 },    // 右
        { x: node.x - m - pw, y: cy - ph / 2 },        // 左
      ]
    : [
        { x: node.x + node.w + m, y: cy - ph / 2 },    // 右
        { x: node.x - m - pw, y: cy - ph / 2 },        // 左
        { x: cx - pw / 2, y: node.y + node.h + m },    // 下
        { x: cx - pw / 2, y: node.y - m - ph },        // 上
      ]);
  const M = 14; // 安全边距
  const hit = (r: Rect) => obstacles.some(
    (o) => r.x < o.x + o.w + M && r.x + r.w + M > o.x && r.y < o.y + o.h + M && r.y + r.h + M > o.y,
  );
  for (const m of [EXPAND_GAP, EXPAND_GAP * 2, EXPAND_GAP * 3.2, EXPAND_GAP * 4.6, EXPAND_GAP * 6.2]) {
    for (const c of candidates(m)) {
      if (!hit({ x: c.x, y: c.y, w: pw, h: ph })) return { x: Math.round(c.x), y: Math.round(c.y) };
    }
  }
  const fb = candidates(EXPAND_GAP)[0];
  return { x: Math.round(fb.x), y: Math.round(fb.y) };
}

/* ---------------- 持久化 / 规范化 ---------------- */

/* v2：子流程改为侧向浮动面板模型，旧版内联展开数据不兼容，直接弃用 */
const LS_KEY = 'stateflow-studio.pages.v2';
const FLOW_KINDS: FlowKind[] = ['start', 'process', 'decision', 'io', 'subprocess'];

function normalizeFlowNodes(raw: unknown): FlowNode[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((n) => n && typeof n.id === 'string').map((n) => {
    const kind: FlowKind = FLOW_KINDS.includes(n.kind as FlowKind) ? (n.kind as FlowKind) : 'process';
    const node: FlowNode = {
      id: n.id, kind,
      text: typeof n.text === 'string' ? n.text : '',
      x: Number(n.x) || 0, y: Number(n.y) || 0,
      w: Number(n.w) || 120, h: Number(n.h) || 50,
      fill: typeof n.fill === 'string' ? n.fill : FLOW_DEFAULTS[kind].fill,
      stroke: typeof n.stroke === 'string' ? n.stroke : FLOW_DEFAULTS[kind].stroke,
    };
    if (kind === 'subprocess') {
      node.inner = {
        nodes: normalizeFlowNodes(n.inner?.nodes),
        edges: normalizeFlowEdges(n.inner?.edges),
      };
      if (n.expandPos && Number.isFinite(n.expandPos.x) && Number.isFinite(n.expandPos.y)) {
        node.expandPos = { x: Number(n.expandPos.x), y: Number(n.expandPos.y) };
      }
      /* 展开状态必须有记忆位置才成立，否则视为收纳（下次展开时重新选址+内部自动布局） */
      node.expanded = n.expanded === true && !!node.expandPos;
    }
    return node;
  });
}

function normalizeFlowEdges(raw: unknown): FlowEdge[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((e) => e && typeof e.source === 'string' && typeof e.target === 'string')
    .map((e) => ({ id: typeof e.id === 'string' ? e.id : nid('fe'), source: e.source, target: e.target, label: e.label || undefined }));
}

function normalizePage(raw: unknown, i: number): Page {
  const p = (raw ?? {}) as Partial<Page>;
  const base = makePage(p.type === 'whiteboard' ? 'whiteboard' : 'canvas', typeof p.name === 'string' && p.name ? p.name : `页面 ${i + 1}`);
  base.id = typeof p.id === 'string' ? p.id : base.id;
  base.states = Array.isArray(p.states) ? p.states : [];
  base.transitions = Array.isArray(p.transitions) ? p.transitions : [];
  base.flowNodes = normalizeFlowNodes(p.flowNodes);
  base.flowEdges = normalizeFlowEdges(p.flowEdges);
  base.flowDir = p.flowDir === 'LR' ? 'LR' : 'TB';
  base.wbShapes = Array.isArray(p.wbShapes) ? p.wbShapes : [];
  return base;
}

export function normalizeStudio(raw: unknown): StudioDoc {
  const d = (raw ?? {}) as Partial<StudioDoc>;
  if (d.version !== 2 || !Array.isArray(d.pages) || !d.pages.length) throw new Error('bad doc');
  const pages = d.pages.map(normalizePage);
  const base = defaultStudioDoc(typeof d.name === 'string' && d.name ? d.name : '未命名工程');
  return {
    ...base,
    settings: { ...base.settings, ...(d.settings ?? {}) },
    pages,
    activePageId: pages.some((p) => p.id === d.activePageId) ? (d.activePageId as string) : pages[0].id,
  };
}

export function loadStudio(): StudioDoc {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return sampleStudioDoc();
    return normalizeStudio(JSON.parse(raw));
  } catch {
    return sampleStudioDoc();
  }
}

export function saveStudio(doc: StudioDoc) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(doc)); } catch { /* 图片过大等情形静默 */ }
}

/* ---------------- 示例工程（含递归子流程演示） ---------------- */

export function sampleStudioDoc(): StudioDoc {
  const page = makePage('canvas', '主流程');
  /* 状态机：三状态 + 带标签转移 */
  const s1 = makeSmState('state', 60, 30, '空闲');
  const s2 = makeSmState('state', 330, 30, '运行中');
  const s3 = makeSmState('terminal', 600, 30, '完成');
  s1.entry = 'init();'; s2.during = 'poll();';
  page.states = [s1, s2, s3];
  page.transitions = [
    { id: nid('t'), source: s1.id, target: s2.id, event: 'START', condition: 'ready', transitionAction: 'run();', enabled: true },
    { id: nid('t'), source: s2.id, target: s3.id, event: 'DONE', conditionAction: 'log();', enabled: true },
    { id: nid('t'), source: s2.id, target: s1.id, event: 'STOP', transitionAction: 'halt();', enabled: true },
  ];

  /* 流程图：开始→计算A→[[计算过程B]]→计算C→结束；B 内含 开始→计算D→[[计算过程E]]→结束 */
  const f = (kind: FlowKind, text: string) => { const n = makeFlowNode(kind, 0, 0); n.text = text; return n; };
  const eStart = f('start', '开始');
  const eA = f('process', '计算 A');
  const eB = f('subprocess', '计算过程 B');
  const eC = f('process', '计算 C');
  const eEnd = f('start', '结束');
  const dStart = f('start', '开始');
  const dD = f('process', '计算 D');
  const dE = f('subprocess', '计算过程 E');
  const dEnd = f('start', '结束');
  const gStart = f('start', '开始');
  const gF = f('process', '计算 F');
  const gEnd = f('start', '结束');
  /* 最内层 E：默认收纳 */
  dE.inner = { nodes: [gStart, gF, gEnd], edges: [
    { id: nid('fe'), source: gStart.id, target: gF.id },
    { id: nid('fe'), source: gF.id, target: gEnd.id, label: '完成' },
  ] };
  dE.expanded = false;
  eB.inner = { nodes: [dStart, dD, dE, dEnd], edges: [
    { id: nid('fe'), source: dStart.id, target: dD.id },
    { id: nid('fe'), source: dD.id, target: dE.id },
    { id: nid('fe'), source: dE.id, target: dEnd.id },
  ] };
  eB.expanded = false;
  const topNodes = [eStart, eA, eB, eC, eEnd];
  const topEdges: FlowEdge[] = [
    { id: nid('fe'), source: eStart.id, target: eA.id },
    { id: nid('fe'), source: eA.id, target: eB.id },
    { id: nid('fe'), source: eB.id, target: eC.id },
    { id: nid('fe'), source: eC.id, target: eEnd.id },
  ];
  /* 主流程默认纵向（TB）排列 */
  let laid = layoutFlowGraph(topNodes, topEdges, 'TB')
    .map((n) => ({ ...n, x: n.x + 300, y: n.y + 260 }));
  /* 展开 [[计算过程 B]]：内部自动布局 + 侧向（右/左）碰撞避让选址（演示浮动面板） */
  const bNode = laid.find((n) => n.id === eB.id)!;
  const bLaid = layoutInner(bNode, 'TB');
  const bPanel = panelSize(bLaid);
  const bObs = laid.filter((n) => n.id !== eB.id).map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h }));
  const bPos = computeExpandPos(bNode, bPanel.w, bPanel.h, bObs, 'TB');
  laid = laid.map((n) => (n.id === eB.id ? { ...bLaid, expanded: true, expandPos: bPos } : n));
  page.flowNodes = laid;
  page.flowEdges = topEdges;

  /* 白板页 */
  const wb = makePage('whiteboard', '灵感白板');
  const note = makeWbShape('rect', 120, 120);
  note.text = '白板页：插入图片后可在其上叠加形状标注'; note.w = 260; note.h = 90;
  note.fill = 'rgba(245,158,11,0.18)'; note.stroke = '#f59e0b';
  const oval = makeWbShape('ellipse', 460, 140);
  oval.fill = 'rgba(168,85,247,0.15)'; oval.stroke = '#a855f7'; oval.w = 150; oval.h = 90;
  const txt = makeWbShape('text', 130, 260);
  txt.text = '箭头 / 直线 / 矩形 / 椭圆 / 文字皆可叠加'; txt.w = 320;
  wb.wbShapes = [note, oval, txt];

  return {
    version: 2, name: 'StateFlow · 演示工程', settings: defaultSettings(),
    pages: [page, wb], activePageId: page.id,
  };
}
