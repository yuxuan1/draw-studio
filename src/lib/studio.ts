/* ============================================================
 * 统一画布数据层：状态机 + 流程图（树）+ 白板 共存于同一文档
 * ============================================================ */
import type {
  ProjectState, ProjectTransition, ProjectSettings, NodeKind, PaletteColor,
} from './core';
import { defaultSettings } from './core';

export type FlowShape = 'rect' | 'diamond' | 'stadium' | 'parallelogram';
export type WbKind = 'image' | 'rect' | 'ellipse' | 'arrow' | 'line' | 'text';

export interface FlowNode {
  id: string;
  parentId: string | null;
  shape: FlowShape;
  text: string;
  x: number; y: number; w: number; h: number;
  fill: string; stroke: string;
  collapsed: boolean;
}

export interface WbShape {
  id: string;
  kind: WbKind;
  x: number; y: number; w: number; h: number;
  fill: string; stroke: string; strokeWidth: number;
  text?: string;
  src?: string;
}

export interface StudioDoc {
  version: 1;
  name: string;
  settings: ProjectSettings;
  flowDirection: 'LR' | 'TB';
  states: ProjectState[];
  transitions: ProjectTransition[];
  flowNodes: FlowNode[];
  wbShapes: WbShape[];
}

export function defaultStudioDoc(name = '未命名画布'): StudioDoc {
  return {
    version: 1,
    name,
    settings: defaultSettings(),
    flowDirection: 'LR',
    states: [],
    transitions: [],
    flowNodes: [],
    wbShapes: [],
  };
}

let seq = 0;
export function nid(prefix: string): string {
  seq = (seq + 1) % 1296;
  return `${prefix}_${Date.now().toString(36).slice(-4)}${seq.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

/* ---------------- 流程图树布局（子节点展开在父节点旁边） ---------------- */

export const FLOW_H_GAP = 64;  // 父子间距（展开方向）
export const FLOW_V_GAP = 22;  // 兄弟间距

const kidsOf = (nodes: FlowNode[], id: string | null) =>
  nodes.filter((n) => n.parentId === id);

/** 子树在「垂直于展开方向」上占据的总跨度 */
function subtreeSpan(nodes: FlowNode[], n: FlowNode, dir: 'LR' | 'TB', memo: Map<string, number>): number {
  const cached = memo.get(n.id);
  if (cached !== undefined) return cached;
  const self = dir === 'LR' ? n.h : n.w;
  if (n.collapsed) { memo.set(n.id, self); return self; }
  const ks = kidsOf(nodes, n.id);
  if (!ks.length) { memo.set(n.id, self); return self; }
  const s = ks.reduce((a, k) => a + subtreeSpan(nodes, k, dir, memo), 0) + FLOW_V_GAP * (ks.length - 1);
  const v = Math.max(self, s);
  memo.set(n.id, v);
  return v;
}

/**
 * 整理树：根保持原位，每个结点的子级排布在其「旁边」（LR=右侧 / TB=下方），
 * 并沿垂直方向居中。折叠的子树不参与排布 —— 因此展开时子级恰好从父结点旁长出。
 */
export function tidyFlow(nodes: FlowNode[], dir: 'LR' | 'TB'): FlowNode[] {
  const map = new Map(nodes.map((n) => [n.id, { ...n }]));
  const all = [...map.values()];
  const memo = new Map<string, number>();
  const span = (n: FlowNode) => subtreeSpan(all, n, dir, memo);

  const place = (n: FlowNode) => {
    if (n.collapsed) return;
    const ks = kidsOf(all, n.id);
    if (!ks.length) return;
    if (dir === 'LR') {
      const childX = n.x + n.w + FLOW_H_GAP;
      const total = ks.reduce((a, k) => a + span(k), 0) + FLOW_V_GAP * (ks.length - 1);
      let cursor = n.y + n.h / 2 - total / 2;
      for (const k of ks) {
        const sp = span(k);
        k.x = childX;
        k.y = cursor + sp / 2 - k.h / 2;
        place(k);
        cursor += sp + FLOW_V_GAP;
      }
    } else {
      const childY = n.y + n.h + FLOW_H_GAP;
      const total = ks.reduce((a, k) => a + span(k), 0) + FLOW_V_GAP * (ks.length - 1);
      let cursor = n.x + n.w / 2 - total / 2;
      for (const k of ks) {
        const sp = span(k);
        k.y = childY;
        k.x = cursor + sp / 2 - k.w / 2;
        place(k);
        cursor += sp + FLOW_V_GAP;
      }
    }
  };

  for (const r of all.filter((n) => !n.parentId)) place(r);
  return all;
}

/** 某结点可见后代数量（用于折叠徽标 +N） */
export function hiddenDescendants(nodes: FlowNode[], id: string): number {
  let count = 0;
  const walk = (pid: string) => {
    for (const k of nodes.filter((n) => n.parentId === pid)) { count++; walk(k.id); }
  };
  walk(id);
  return count;
}

/* ---------------- 默认形状工厂 ---------------- */

export function makeFlowNode(shape: FlowShape, x: number, y: number, parentId: string | null): FlowNode {
  const base: FlowNode = {
    id: nid('f'), parentId, shape, text: '新节点',
    x, y, w: 132, h: 52, fill: '#eef2ff', stroke: '#6366f1', collapsed: false,
  };
  if (shape === 'diamond') { base.w = 150; base.h = 74; base.text = '判定?'; base.fill = '#fef3c7'; base.stroke = '#f59e0b'; }
  if (shape === 'stadium') { base.w = 128; base.h = 48; base.text = '开始 / 结束'; base.fill = '#dcfce7'; base.stroke = '#22c55e'; }
  if (shape === 'parallelogram') { base.w = 140; base.h = 52; base.text = '输入 / 输出'; base.fill = '#e0f2fe'; base.stroke = '#0ea5e9'; }
  return base;
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

export function makeSmState(kind: NodeKind, x: number, y: number, name: string): ProjectState {
  return { id: nid('s'), name, kind, color: (kind === 'junction' || kind === 'start' ? 'slate' : 'indigo') as PaletteColor, position: { x, y } };
}

/* ---------------- 持久化 ---------------- */

const LS_KEY = 'stateflow-studio.unified.v1';

export function normalizeStudio(raw: unknown): StudioDoc {
  const d = (raw ?? {}) as Partial<StudioDoc>;
  const base = defaultStudioDoc(typeof d.name === 'string' && d.name ? d.name : '未命名画布');
  return {
    ...base,
    settings: { ...base.settings, ...(d.settings ?? {}) },
    flowDirection: d.flowDirection === 'TB' ? 'TB' : 'LR',
    states: Array.isArray(d.states) ? (d.states as ProjectState[]) : [],
    transitions: Array.isArray(d.transitions) ? (d.transitions as ProjectTransition[]) : [],
    flowNodes: Array.isArray(d.flowNodes) ? (d.flowNodes as FlowNode[]) : [],
    wbShapes: Array.isArray(d.wbShapes) ? (d.wbShapes as WbShape[]) : [],
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

/* ---------------- 示例工程（首次打开的完整演示） ---------------- */

export function sampleStudioDoc(): StudioDoc {
  const doc = defaultStudioDoc('登录流程 · 演示');
  // —— 状态机：两个状态 + 一条带标签转移 ——
  const s1 = makeSmState('state', 60, 40, '空闲');
  const s2 = makeSmState('state', 320, 40, '运行中');
  s1.entry = 'init();'; s2.during = 'poll();';
  doc.states = [s1, s2];
  doc.transitions = [{
    id: nid('t'), source: s1.id, target: s2.id,
    event: 'START', condition: 'ready', transitionAction: 'run();', enabled: true,
  }];
  // —— 流程图：一棵小树（子级展开在父级旁边）——
  const root = makeFlowNode('stadium', 60, 260, null); root.text = '开始';
  const step = makeFlowNode('rect', 0, 0, root.id); step.text = '输入账号密码';
  const judge = makeFlowNode('diamond', 0, 0, step.id); judge.text = '校验通过?';
  const ok = makeFlowNode('rect', 0, 0, judge.id); ok.text = '进入主页';
  const fail = makeFlowNode('parallelogram', 0, 0, judge.id); fail.text = '提示错误';
  doc.flowNodes = tidyFlow([root, step, judge, ok, fail], 'LR');
  // —— 白板：一个便签形状 ——
  const note = makeWbShape('rect', 950, 80);
  note.text = '白板便签：可叠加在图片上'; note.w = 200; note.h = 90;
  note.fill = 'rgba(245,158,11,0.18)'; note.stroke = '#f59e0b';
  doc.wbShapes = [note];
  return doc;
}
