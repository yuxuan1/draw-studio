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
  x: number; y: number; w: number; h: number;   // 子流程展开时 w/h 为最小尺寸
  fill: string; stroke: string;
  inner?: InnerFlow;      // 仅 subprocess：内部小流程图
  expanded?: boolean;     // 仅 subprocess：是否展开
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
    states: [], transitions: [], flowNodes: [], flowEdges: [], flowDir: 'LR',
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
  if (kind === 'subprocess') { n.inner = { nodes: [], edges: [] }; n.expanded = true; }
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

export const C_PAD = 18;     // 容器内边距
export const C_HEADER = 34;  // 容器头部高度

/** 结点当前渲染尺寸（展开的子流程 = 内容包围盒 + 头部 + 内边距） */
export function subprocessSize(n: FlowNode): { w: number; h: number } {
  if (n.kind !== 'subprocess' || !n.expanded) return { w: n.w, h: n.h };
  const inner = n.inner;
  if (!inner || !inner.nodes.length) return { w: Math.max(n.w, 220), h: Math.max(n.h, 130) };
  let x2 = 0, y2 = 0;
  for (const k of inner.nodes) {
    const s = subprocessSize(k);
    x2 = Math.max(x2, k.x + s.w);
    y2 = Math.max(y2, k.y + s.h);
  }
  return { w: Math.max(n.w, x2 + C_PAD * 2), h: Math.max(n.h, y2 + C_HEADER + C_PAD) };
}

export interface FlatFlowNode { n: FlowNode; path: string[]; x: number; y: number; w: number; h: number }
export interface FlatFlowEdge { e: FlowEdge; path: string[]; a: FlatFlowNode; b: FlatFlowNode }

/** 递归展平：把嵌套子流程换算成世界坐标（内部坐标相对于容器内容区左上角） */
export function flattenFlow(
  nodes: FlowNode[], edges: FlowEdge[], ox = 0, oy = 0, path: string[] = [],
): { nodes: FlatFlowNode[]; edges: FlatFlowEdge[] } {
  const flatN: FlatFlowNode[] = [];
  const flatE: FlatFlowEdge[] = [];
  const posMap = new Map<string, FlatFlowNode>();
  const walk = (ns: FlowNode[], es: FlowEdge[], wx: number, wy: number, p: string[]) => {
    for (const n of ns) {
      const s = subprocessSize(n);
      const f: FlatFlowNode = { n, path: p, x: wx + n.x, y: wy + n.y, w: s.w, h: s.h };
      flatN.push(f); posMap.set(n.id, f);
      if (n.kind === 'subprocess' && n.expanded && n.inner) {
        walk(n.inner.nodes, n.inner.edges, f.x + C_PAD, f.y + C_HEADER, [...p, n.id]);
      }
    }
    for (const e of es) {
      const a = posMap.get(e.source); const b = posMap.get(e.target);
      if (a && b) flatE.push({ e, path: p, a, b });
    }
  };
  walk(nodes, edges, ox, oy, path);
  return { nodes: flatN, edges: flatE };
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

export function layoutFlowGraph(nodes: FlowNode[], edges: FlowEdge[], dir: Dir): FlowNode[] {
  if (!nodes.length) return nodes;
  /* 1) 先整理子流程内部（后序），展开者的存储尺寸同步为内容尺寸 */
  const ns = nodes.map((n) => {
    if (n.kind !== 'subprocess' || !n.inner) return n;
    const innerNodes = layoutFlowGraph(n.inner.nodes, n.inner.edges, dir);
    const next = { ...n, inner: { nodes: innerNodes, edges: n.inner.edges } };
    if (n.expanded) { const s = subprocessSize(next); return { ...next, w: s.w, h: s.h }; }
    return next;
  });

  const size = (n: FlowNode) => subprocessSize(n);
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

/* ---------------- 持久化 / 规范化 ---------------- */

const LS_KEY = 'stateflow-studio.pages.v1';
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
      node.expanded = n.expanded !== false;
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
  base.flowDir = p.flowDir === 'TB' ? 'TB' : 'LR';
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
  eB.expanded = true;
  const topNodes = [eStart, eA, eB, eC, eEnd];
  const topEdges: FlowEdge[] = [
    { id: nid('fe'), source: eStart.id, target: eA.id },
    { id: nid('fe'), source: eA.id, target: eB.id },
    { id: nid('fe'), source: eB.id, target: eC.id },
    { id: nid('fe'), source: eC.id, target: eEnd.id },
  ];
  const laid = layoutFlowGraph(topNodes, topEdges, 'LR');
  page.flowNodes = laid.map((n) => ({ ...n, x: n.x + 80, y: n.y + 250 }));
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
