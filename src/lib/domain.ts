/* ============================================================
 * domain —— FlowForge 领域模型（Source of Truth）
 *
 * 红线（C01–C12）在此落地：
 *  - Domain Model（Project）> ScopeLayout（位置/视口）> 渲染态
 *  - 一份模型多种视图；一个对象多处引用；一个 Scope 一套稳定布局
 *  - 子流程不再"嵌套 inner"，而是扁平 Process + CallNode.targetProcessId 引用
 * ============================================================ */

export type ID = string;
export interface Position { x: number; y: number }
export interface Bounds { x: number; y: number; w: number; h: number }
export interface Viewport { x: number; y: number; zoom: number }

/* ---------------- 枚举（唯一口径，camelCase） ---------------- */
export type NodeType =
  | 'start' | 'end' | 'action' | 'decision' | 'loop' | 'parallel' | 'join'
  | 'wait' | 'return' | 'call' | 'reference' | 'comment' | 'state' | 'choice';
export type EdgeType = 'flow' | 'reference' | 'transition';
export type DisplayMode = 'collapsed' | 'summary' | 'expanded';
export type PageType = 'flow' | 'state';
export type Handle = 't' | 'b' | 'l' | 'r';

/* ---------------- 连线样式（可配置线形/颜色/虚线） ---------------- */
export interface EdgeStyle {
  type?: 'default' | 'straight' | 'step' | 'smoothstep';
  color?: string;
  dashed?: boolean;
}

/* ---------------- 节点（判别联合） ---------------- */
export interface BaseNode {
  id: ID;
  type: NodeType;
  name: string;
  description?: string;
  parentId?: ID;
  properties?: Record<string, unknown>;
}
export interface CallNode extends BaseNode {
  type: 'call';
  targetProcessId: ID;
  displayMode: DisplayMode;
  arguments?: string[];
}
export interface ReferenceNode extends BaseNode {
  type: 'reference';
  functionId: ID;
}
export interface DecisionNode extends BaseNode {
  type: 'decision';
  expression?: string;
}
export type ProcessNode = BaseNode | CallNode | ReferenceNode | DecisionNode;

/* ---------------- 连线（四周锚点 t/b/l/r，缺省 source=b target=t） ---------------- */
export interface Edge {
  id: ID;
  type: EdgeType;
  source: ID;
  target: ID;
  label?: string;
  condition?: string;
  priority?: number;
  sourceHandle?: Handle;
  targetHandle?: Handle;
  style?: EdgeStyle;
}

/* ---------------- 组织 ---------------- */
export interface Parameter { name: string; type?: string; direction?: 'in' | 'out' | 'inout' }
export interface Function {
  id: ID; name: string; namespace?: string;
  type: 'local' | 'shared' | 'library' | 'external';
  description?: string; parameters?: Parameter[]; returnType?: string;
}
export interface Process {
  id: ID; name: string; description?: string; parentId?: ID;
  nodes: ProcessNode[]; edges: Edge[];
  metadata?: Record<string, unknown>;
}
export interface State {
  id: ID; name: string;
  type: 'initial' | 'normal' | 'final' | 'composite' | 'history';
  entryAction?: string; exitAction?: string; doAction?: string; description?: string;
}
export interface Transition {
  id: ID; source: ID; target: ID;
  event?: string; guard?: string; action?: string;
  priority?: number; description?: string;
}
export interface StateMachine {
  id: ID; name: string; description?: string;
  states: State[]; transitions: Transition[];
}

/* ---------------- 页 / 作用域 / 布局 ---------------- */
export interface Page {
  id: ID; name: string; type: PageType; order: number;
  rootProcessId?: ID;
  rootStateMachineId?: ID;
}
export interface ScopeRef {
  pageId: ID;
  processId?: ID;       // 当前所在 Process（嵌套子流程时为子 Process）
  stateMachineId?: ID;
}
export type LayoutAlgorithm = 'manual' | 'hierarchical' | 'tree' | 'orthogonal';
export interface ScopeLayout {
  positions: Record<ID, Position>;
  viewport: Viewport;
  locked: boolean;
  algorithm: LayoutAlgorithm;
}

/* ---------------- 顶层 ---------------- */
export interface Project {
  format: 'flowforge';
  version: 1;
  id: ID;
  name: string;
  pages: Page[];
  functions: Function[];
  processes: Process[];
  stateMachines: StateMachine[];
  settings: { theme: 'light' | 'dark' };
}

/* ---------------- id 生成 ---------------- */
let seq = 0;
export function uid(prefix: string): ID {
  seq = (seq + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

/* ---------------- 节点默认值（尺寸 / 配色键 / 形状） ---------------- */
export type ShapeColorKey = 'green' | 'indigo' | 'amber' | 'sky' | 'violet' | 'rose' | 'slate';
export const NODE_DEFAULTS: Record<NodeType, { w: number; h: number; color: ShapeColorKey; label: string }> = {
  start:     { w: 110, h: 42, color: 'green',  label: '开始' },
  end:       { w: 110, h: 42, color: 'slate',  label: '结束' },
  action:    { w: 132, h: 50, color: 'indigo', label: '动作' },
  decision:  { w: 140, h: 72, color: 'amber',  label: '判定?' },
  loop:      { w: 132, h: 50, color: 'violet', label: '循环' },
  parallel:  { w: 132, h: 50, color: 'sky',    label: '并行' },
  join:      { w: 132, h: 50, color: 'sky',    label: '汇聚' },
  wait:      { w: 132, h: 50, color: 'sky',    label: '等待' },
  return:    { w: 132, h: 50, color: 'slate',  label: '返回' },
  call:      { w: 170, h: 54, color: 'violet', label: '调用子流程' },
  reference: { w: 150, h: 50, color: 'rose',   label: '引用函数' },
  comment:   { w: 150, h: 44, color: 'slate',  label: '注释' },
  state:     { w: 130, h: 50, color: 'indigo', label: '状态' },
  choice:    { w: 130, h: 64, color: 'amber',  label: '选择' },
};
export const NODE_TYPE_LABEL: Record<NodeType, string> = {
  start: '开始', end: '结束', action: '动作', decision: '判定', loop: '循环',
  parallel: '并行', join: '汇聚', wait: '等待', return: '返回',
  call: '调用', reference: '引用', comment: '注释', state: '状态', choice: '选择',
};

export function makeNode(type: NodeType, x: number, y: number, extra?: Partial<ProcessNode>): ProcessNode {
  const d = NODE_DEFAULTS[type];
  const node: ProcessNode = { id: uid('n'), type, name: d.label, ...extra } as ProcessNode;
  (node as { x?: number }).x = x;
  (node as { y?: number }).y = y;
  return node;
}
/* 位置存于 ScopeLayout.positions；渲染态节点携带 x/y 便于投影（非持久化字段） */
export type RenderNode = ProcessNode & { x: number; y: number; w: number; h: number };

/* ---------------- 作用域投影（Domain → 当前 Scope 可见节点） ---------------- */
export const FALLBACK_STEP_Y = 80;

export function pickHandles(
  pos: Record<ID, Position>, src: ID, tgt: ID,
): { source: Handle; target: Handle } {
  const sp = pos[src], tp = pos[tgt];
  if (!sp || !tp) return { source: 'b', target: 't' };
  const dx = tp.x - sp.x, dy = tp.y - sp.y;
  if (Math.abs(dy) >= Math.abs(dx)) {
    return dy > 0 ? { source: 'b', target: 't' } : { source: 'r', target: 'r' };
  }
  return dx > 0 ? { source: 'r', target: 'l' } : { source: 'l', target: 'r' };
}

export interface ProjectedEdge extends Edge {
  sourceHandle: Handle; targetHandle: Handle;
  kind: 'straight' | 'step' | 'smoothstep';
  dashed: boolean;
}
export interface Projection { nodes: RenderNode[]; edges: ProjectedEdge[] }

export function projectProcess(process: Process, layout: ScopeLayout | undefined): Projection {
  const positions = layout?.positions ?? {};
  const pos: Record<ID, Position> = {};
  const nodes: RenderNode[] = [];
  process.nodes.forEach((n, i) => {
    const p = positions[n.id] ?? { x: 0, y: i * FALLBACK_STEP_Y };
    pos[n.id] = p;
    const d = NODE_DEFAULTS[n.type];
    nodes.push({ ...n, x: p.x, y: p.y, w: d.w, h: d.h } as RenderNode);
  });
  const edges: ProjectedEdge[] = process.edges.map((e) => {
    const s = e.style ?? {};
    const calc = pickHandles(pos, e.source, e.target);
    const dashed = s.dashed ?? e.type === 'reference';
    const kind = s.type && s.type !== 'default'
      ? (s.type === 'straight' ? 'straight' : s.type === 'step' ? 'step' : 'smoothstep')
      : 'smoothstep';
    return {
      ...e,
      sourceHandle: e.sourceHandle ?? calc.source,
      targetHandle: e.targetHandle ?? calc.target,
      kind, dashed,
    };
  });
  return { nodes, edges };
}

/* ---------------- 层级树（左侧大纲 / Overview） ---------------- */
export interface HierarchyNode { process: Process; children: HierarchyNode[] }
export function buildHierarchy(project: Project, rootProcessId: ID): HierarchyNode | null {
  const byId = new Map(project.processes.map((p) => [p.id, p]));
  const root = byId.get(rootProcessId);
  if (!root) return null;
  const visited = new Set<ID>();
  const build = (proc: Process): HierarchyNode => {
    visited.add(proc.id);
    const children: HierarchyNode[] = [];
    for (const n of proc.nodes) {
      if (n.type === 'call') {
        const tgt = byId.get((n as CallNode).targetProcessId);
        if (tgt && !visited.has(tgt.id)) children.push(build(tgt));
      }
    }
    return { process: proc, children };
  };
  return build(root);
}

/* ---------------- 项目调用图（Overview） ---------------- */
export interface CallGraphNode { id: ID; name: string; nodeCount: number; callCount: number }
export interface CallGraphEdge { source: ID; target: ID }
export function buildProjectCallGraph(project: Project): { nodes: CallGraphNode[]; edges: CallGraphEdge[] } {
  const nodes: CallGraphNode[] = project.processes.map((p) => ({
    id: p.id, name: p.name,
    nodeCount: p.nodes.length,
    callCount: p.nodes.filter((n) => n.type === 'call').length,
  }));
  const edges: CallGraphEdge[] = [];
  const seen = new Set<string>();
  for (const p of project.processes) {
    for (const n of p.nodes) {
      if (n.type === 'call') {
        const key = `${p.id}->${(n as CallNode).targetProcessId}`;
        if (!seen.has(key)) { seen.add(key); edges.push({ source: p.id, target: (n as CallNode).targetProcessId }); }
      }
    }
  }
  return { nodes, edges };
}

/* ---------------- 迷你缩略图布局（单击浮层） ---------------- */
export interface MiniNode { id: ID; name: string; type: NodeType; x: number; y: number; w: number; h: number }
export interface MiniEdge { x1: number; y1: number; x2: number; y2: number }
export interface MiniLayout { nodes: MiniNode[]; edges: MiniEdge[]; width: number; height: number }
export function layoutMini(process: Process): MiniLayout {
  const PAD = 12, GX = 200, GY = 56;
  const indeg = new Map<ID, number>();
  const out = new Map<ID, ID[]>();
  process.nodes.forEach((n) => { indeg.set(n.id, 0); out.set(n.id, []); });
  process.edges.forEach((e) => {
    if (indeg.has(e.target)) indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
    if (out.has(e.source)) out.get(e.source)!.push(e.target);
  });
  const layer = new Map<ID, number>();
  let frontier = process.nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id);
  let depth = 0;
  const placed = new Set<ID>();
  while (frontier.length) {
    frontier.forEach((id) => { layer.set(id, depth); placed.add(id); });
    const next: ID[] = [];
    frontier.forEach((id) => {
      (out.get(id) ?? []).forEach((t) => {
        indeg.set(t, (indeg.get(t) ?? 1) - 1);
        if ((indeg.get(t) ?? 0) === 0 && !placed.has(t) && !next.includes(t)) next.push(t);
      });
    });
    frontier = next; depth++;
  }
  process.nodes.forEach((n) => { if (!layer.has(n.id)) layer.set(n.id, depth); });

  const byLayer = new Map<number, ID[]>();
  process.nodes.forEach((n) => {
    const l = layer.get(n.id) ?? 0;
    if (!byLayer.has(l)) byLayer.set(l, []);
    byLayer.get(l)!.push(n.id);
  });
  const pos = new Map<ID, MiniNode>();
  let maxW = 0, maxH = 0;
  [...byLayer.entries()].sort((a, b) => a[0] - b[0]).forEach(([l, ids]) => {
    ids.forEach((id, idx) => {
      const n = process.nodes.find((x) => x.id === id)!;
      const w = Math.min(200, Math.max(56, n.name.length * 9 + 28));
      const node: MiniNode = { id, name: n.name, type: n.type, x: PAD + l * GX, y: PAD + idx * GY, w, h: 34 };
      pos.set(id, node);
      maxW = Math.max(maxW, node.x + w); maxH = Math.max(maxH, node.y + 34);
    });
  });
  const edges: MiniEdge[] = process.edges
    .filter((e) => pos.has(e.source) && pos.has(e.target))
    .map((e) => {
      const s = pos.get(e.source)!, t = pos.get(e.target)!;
      return { x1: s.x + s.w, y1: s.y + s.h / 2, x2: t.x, y2: t.y + t.h / 2 };
    });
  return { nodes: [...pos.values()], edges, width: maxW + PAD, height: maxH + PAD };
}

/* ---------------- 层级自动布局（hierarchical，TB 方向） ----------------
   首次进入无布局的 Scope 调用一次；结果写回 ScopeLayout 后绝不自动重排（红线）。 */
export function layoutProcess(process: Process): Record<ID, Position> {
  const NODE_GAP = 44;      // 同层节点间距
  const LAYER_GAP = 52;     // 层间距
  const indeg = new Map<ID, number>();
  const out = new Map<ID, ID[]>();
  const byId = new Map(process.nodes.map((n) => [n.id, n]));
  process.nodes.forEach((n) => { indeg.set(n.id, 0); out.set(n.id, []); });
  process.edges.forEach((e) => {
    if (indeg.has(e.target) && byId.has(e.source)) {
      indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
      out.get(e.source)!.push(e.target);
    }
  });
  // Kahn 分层
  const layer = new Map<ID, number>();
  let frontier = process.nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id);
  const placed = new Set<ID>();
  let depth = 0;
  while (frontier.length) {
    frontier.forEach((id) => { layer.set(id, depth); placed.add(id); });
    const next: ID[] = [];
    frontier.forEach((id) => (out.get(id) ?? []).forEach((t) => {
      indeg.set(t, (indeg.get(t) ?? 1) - 1);
      if ((indeg.get(t) ?? 0) === 0 && !placed.has(t) && !next.includes(t)) next.push(t);
    }));
    frontier = next; depth++;
  }
  process.nodes.forEach((n) => { if (!layer.has(n.id)) layer.set(n.id, depth); });

  // 重心排序减交叉：每层按父层平均 x 排序
  const byLayer = new Map<number, ID[]>();
  process.nodes.forEach((n) => {
    const l = layer.get(n.id) ?? 0;
    if (!byLayer.has(l)) byLayer.set(l, []);
    byLayer.get(l)!.push(n.id);
  });
  const layers = [...byLayer.keys()].sort((a, b) => a - b);
  const order = new Map<ID, number>();
  layers.forEach((l) => byLayer.get(l)!.forEach((id, i) => order.set(id, i)));
  for (let li = 1; li < layers.length; li++) {
    const ids = byLayer.get(layers[li])!;
    const bary = new Map<ID, number>();
    ids.forEach((id) => {
      const parents = process.edges.filter((e) => e.target === id && layer.get(e.source) === layers[li - 1]);
      if (parents.length) {
        bary.set(id, parents.reduce((a, e) => a + (order.get(e.source) ?? 0), 0) / parents.length);
      } else bary.set(id, order.get(id) ?? 0);
    });
    ids.sort((a, b) => (bary.get(a) ?? 0) - (bary.get(b) ?? 0));
    ids.forEach((id, i) => order.set(id, i));
    byLayer.set(layers[li], ids);
  }

  // 计算坐标：层内居中，层层向下
  const pos: Record<ID, Position> = {};
  let y = 60;
  layers.forEach((l) => {
    const ids = byLayer.get(l)!;
    const widths = ids.map((id) => NODE_DEFAULTS[byId.get(id)!.type].w);
    const totalW = widths.reduce((a, b) => a + b, 0) + NODE_GAP * (ids.length - 1);
    let x = 60 + Math.max(0, (600 - totalW) / 2);
    let maxH = 0;
    ids.forEach((id, i) => {
      const n = byId.get(id)!;
      const d = NODE_DEFAULTS[n.type];
      pos[id] = { x: Math.round(x), y: Math.round(y) };
      x += d.w + NODE_GAP;
      maxH = Math.max(maxH, d.h);
    });
    y += maxH + LAYER_GAP;
  });
  return pos;
}

/* ---------------- 默认 / 示例工程 ---------------- */
export function defaultProject(theme: 'light' | 'dark' = 'light'): Project {
  const main = makeSampleMain();
  const page: Page = { id: uid('pg'), name: '主流程', type: 'flow', order: 0, rootProcessId: main.processes[0].id };
  return {
    format: 'flowforge', version: 1, id: uid('proj'), name: '未命名工程',
    pages: [page], functions: [], processes: main.processes, stateMachines: [],
    settings: { theme },
  };
}

/** 示例：main → 计算A → call(核算B) → call(核算E 嵌在 B 内) 多层 */
export function makeSampleMain(): { processes: Process[] } {
  // 最内层 E：开始 → 计算F → 结束
  const eS = makeNode('start', 0, 0); eS.name = '开始';
  const eF = makeNode('action', 0, 80); eF.name = '计算 F';
  const eE = makeNode('end', 0, 160); eE.name = '结束';
  const procE: Process = {
    id: uid('pr'), name: '核算流程 E',
    nodes: [eS, eF, eE],
    edges: [
      { id: uid('e'), type: 'flow', source: eS.id, target: eF.id },
      { id: uid('e'), type: 'flow', source: eF.id, target: eE.id, label: '完成' },
    ],
  };
  const callE: CallNode = { ...makeNode('call', 0, 240), targetProcessId: procE.id, displayMode: 'collapsed' } as CallNode;
  callE.name = '核算流程 E';

  // B：开始 → 计算D → 判定 → call(E) → 结束 ；判定 →(否) 结束
  const bS = makeNode('start', 0, 0); bS.name = '开始';
  const bD = makeNode('action', 0, 80); bD.name = '计算 D';
  const bQ = makeNode('decision', 0, 160); bQ.name = 'D 完成?';
  const bE = makeNode('end', 0, 320); bE.name = '结束';
  const procB: Process = {
    id: uid('pr'), name: '核算流程 B',
    nodes: [bS, bD, bQ, callE, bE],
    edges: [
      { id: uid('e'), type: 'flow', source: bS.id, target: bD.id },
      { id: uid('e'), type: 'flow', source: bD.id, target: bQ.id },
      { id: uid('e'), type: 'flow', source: bQ.id, target: callE.id, label: '是' },
      { id: uid('e'), type: 'flow', source: callE.id, target: bE.id },
      { id: uid('e'), type: 'flow', source: bQ.id, target: bE.id, label: '否', style: { type: 'step', dashed: true } },
    ],
  };
  const callB: CallNode = { ...makeNode('call', 0, 240), targetProcessId: procB.id, displayMode: 'collapsed' } as CallNode;
  callB.name = '核算流程 B';

  // main：开始 → 录入订单 → call(B) → 计算C → 结束
  const mS = makeNode('start', 0, 0); mS.name = '开始';
  const mA = makeNode('action', 0, 80); mA.name = '录入订单';
  const mC = makeNode('action', 0, 320); mC.name = '计算 C';
  const mE = makeNode('end', 0, 400); mE.name = '结束';
  const procMain: Process = {
    id: uid('pr'), name: '订单处理',
    nodes: [mS, mA, callB, mC, mE],
    edges: [
      { id: uid('e'), type: 'flow', source: mS.id, target: mA.id },
      { id: uid('e'), type: 'flow', source: mA.id, target: callB.id },
      { id: uid('e'), type: 'flow', source: callB.id, target: mC.id, label: '核算通过' },
      { id: uid('e'), type: 'flow', source: mC.id, target: mE.id },
    ],
  };
  return { processes: [procMain, procB, procE] };
}

/* ---------------- 确定性序列化 / 反序列化 ---------------- */
export function serializeProject(p: Project): string {
  const norm: Project = {
    format: 'flowforge', version: 1, id: p.id, name: p.name,
    pages: [...p.pages].sort((a, b) => a.order - b.order),
    functions: [...p.functions].sort((a, b) => a.id.localeCompare(b.id)),
    processes: p.processes.map((pr) => ({
      ...pr,
      nodes: [...pr.nodes],
      edges: [...pr.edges],
    })),
    stateMachines: p.stateMachines,
    settings: p.settings,
  };
  return JSON.stringify(norm, null, 2);
}
export function deserializeProject(raw: string): Project | null {
  try {
    const d = JSON.parse(raw) as Project;
    if (d.format !== 'flowforge' || !Array.isArray(d.pages)) return null;
    return {
      format: 'flowforge', version: 1,
      id: d.id || uid('proj'), name: d.name || '未命名工程',
      pages: d.pages, functions: d.functions ?? [], processes: d.processes ?? [],
      stateMachines: d.stateMachines ?? [],
      settings: { theme: d.settings?.theme === 'dark' ? 'dark' : 'light' },
    };
  } catch { return null; }
}
