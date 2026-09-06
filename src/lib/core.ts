/* ============================================================
 * core —— 数据模型 · 主题色板 · 标签引擎 · 文本度量
 * 主题修复核心：所有画布元素颜色都通过「明/暗双色板」按当前主题解析，
 * 文字颜色依据填充亮度计算（readableOn），保证任何主题下均可读。
 * ============================================================ */

export type ThemeMode = 'light' | 'dark';
export type PaletteColor =
  | 'indigo' | 'blue' | 'teal' | 'green' | 'amber' | 'rose' | 'violet' | 'slate';

export const FONT_STACK =
  "'Space Grotesk','Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif";
export const GRID_SNAP = 16;
export const START_ID = '__start__';

/* ---------------- 画布装饰色（明/暗两套） ---------------- */
export const THEME = {
  light: {
    canvas: '#eef0f4', dot: '#c3ccd7',
    edge: '#5f6e84', edgeLabelBg: '#ffffff', edgeLabelBorder: '#d5dbe4', edgeLabelText: '#3c4a61',
    actionText: '#4a5872', muted: '#7b8798',
    startFill: '#333f52', startDot: '#ffffff',
    junctionFill: '#5f6e84', junctionBorder: '#ffffff',
    panelFill: '#ffffff', panelBorder: '#c8cfda', panelHeader: '#f6f7f9',
    sel: '#0d9488', selGlow: 'rgba(13,148,136,0.30)',
    tether: '#94a3b8',
  },
  dark: {
    canvas: '#11161d', dot: '#232c38',
    edge: '#8794a8', edgeLabelBg: '#1b222d', edgeLabelBorder: '#3a4553', edgeLabelText: '#c3cdda',
    actionText: '#a7b3c4', muted: '#77839a',
    startFill: '#cbd5e1', startDot: '#131a24',
    junctionFill: '#8794a8', junctionBorder: '#11161d',
    panelFill: '#1b222c', panelBorder: '#38424f', panelHeader: '#232c38',
    sel: '#2dd4bf', selGlow: 'rgba(45,212,191,0.38)',
    tether: '#475569',
  },
} as const;

/* ---------------- 状态机 8 色板（明/暗两套） ---------------- */
interface ToneSet { fill: string; border: string; accent: string; text: string }
export const PALETTES: Record<PaletteColor, { light: ToneSet; dark: ToneSet }> = {
  indigo: { light: { fill: '#eef1ff', border: '#8b9af0', accent: '#4f5fe0', text: '#333d9e' }, dark: { fill: '#252b52', border: '#5f6bd6', accent: '#8b96ef', text: '#c6cdfb' } },
  blue:   { light: { fill: '#e7f3fe', border: '#67aaf5', accent: '#2272dd', text: '#1d4f9e' }, dark: { fill: '#1c3252', border: '#3d82e0', accent: '#6aa5f2', text: '#bcd8fb' } },
  teal:   { light: { fill: '#e2f6f1', border: '#34c4ae', accent: '#0d9488', text: '#0f5e56' }, dark: { fill: '#123a35', border: '#17a695', accent: '#35d3bd', text: '#96f0e0' } },
  green:  { light: { fill: '#e8f7ea', border: '#54c468', accent: '#22993d', text: '#1c6630' }, dark: { fill: '#17391f', border: '#2da448', accent: '#57cf70', text: '#b4f0c0' } },
  amber:  { light: { fill: '#fdf2dd', border: '#eeb63f', accent: '#d18a06', text: '#8f5c06' }, dark: { fill: '#3f3010', border: '#d99c17', accent: '#f2bd45', text: '#f8e3ac' } },
  rose:   { light: { fill: '#fdecf0', border: '#f07d94', accent: '#de3357', text: '#9c2440' }, dark: { fill: '#451725', border: '#e04f6e', accent: '#f97e98', text: '#fcc4d0' } },
  violet: { light: { fill: '#f2eefc', border: '#a489ec', accent: '#7a3fdd', text: '#57309c' }, dark: { fill: '#302456', border: '#8b5fe0', accent: '#b18ef5', text: '#ddcffc' } },
  slate:  { light: { fill: '#edf0f4', border: '#93a1b4', accent: '#52617a', text: '#39465c' }, dark: { fill: '#232c38', border: '#5b6b80', accent: '#8b9cb3', text: '#c3cdda' } },
};
export const COLOR_ORDER: PaletteColor[] = ['indigo', 'blue', 'teal', 'green', 'amber', 'rose', 'violet', 'slate'];
export const COLOR_LABELS: Record<PaletteColor, string> = {
  indigo: '靛蓝', blue: '天蓝', teal: '青绿', green: '草绿',
  amber: '琥珀', rose: '玫红', violet: '紫罗兰', slate: '石墨',
};

/* ---------------- 流程图 / 白板形状色板（明/暗两套） ----------------
   元素只存 color 键，渲染时按主题解析 fill/stroke —— 这是主题切换
   后颜色正确变化的关键（旧版存固定浅色 hex，暗色下文字不可读）。 */
export type ShapeColorKey = 'green' | 'indigo' | 'amber' | 'sky' | 'violet' | 'rose' | 'slate';
export const SHAPE_COLORS: Record<ShapeColorKey, { light: { fill: string; stroke: string }; dark: { fill: string; stroke: string } }> = {
  green:  { light: { fill: '#dcfce7', stroke: '#22c55e' }, dark: { fill: '#14532d', stroke: '#4ade80' } },
  indigo: { light: { fill: '#eef2ff', stroke: '#6366f1' }, dark: { fill: '#312e81', stroke: '#818cf8' } },
  amber:  { light: { fill: '#fef3c7', stroke: '#f59e0b' }, dark: { fill: '#78350f', stroke: '#fbbf24' } },
  sky:    { light: { fill: '#e0f2fe', stroke: '#0ea5e9' }, dark: { fill: '#0c4a6e', stroke: '#38bdf8' } },
  violet: { light: { fill: '#f3e8ff', stroke: '#a855f7' }, dark: { fill: '#4c1d95', stroke: '#c084fc' } },
  rose:   { light: { fill: '#ffe4e6', stroke: '#f43f5e' }, dark: { fill: '#881337', stroke: '#fb7185' } },
  slate:  { light: { fill: '#f1f5f9', stroke: '#64748b' }, dark: { fill: '#1e293b', stroke: '#94a3b8' } },
};
export const SHAPE_COLOR_ORDER: ShapeColorKey[] = ['green', 'indigo', 'amber', 'sky', 'violet', 'rose', 'slate'];

/** 按主题解析形状颜色；color 键无效时回退到元素自带的 fill/stroke */
export function resolveShapeColor(
  color: string | undefined, fill: string, stroke: string, theme: ThemeMode,
): { fill: string; stroke: string } {
  const p = (color && SHAPE_COLORS[color as ShapeColorKey]) ? SHAPE_COLORS[color as ShapeColorKey][theme] : undefined;
  return p ? { fill: p.fill, stroke: p.stroke } : { fill, stroke };
}

/** 依据填充色亮度返回适合叠加的文字色（保证任何主题下可读） */
export function readableOn(fill: string): string {
  const h = (fill || '').replace('#', '');
  if (h.length < 6) return '#1e293b';
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return '#1e293b';
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#1e293b' : '#ffffff';
}

/* ---------------- 文本度量（CJK≈1em，拉丁≈0.56em） ---------------- */
export function estWidth(text: string, fontSize: number): number {
  let w = 0;
  for (const ch of text || '') w += ch.charCodeAt(0) > 0x2e80 ? fontSize : fontSize * 0.56;
  return w;
}
export function wrapText(text: string, maxWidth: number, fontSize: number): string[] {
  const lines: string[] = [];
  for (const raw of (text || '').split('\n')) {
    let cur = '', w = 0;
    for (const ch of raw) {
      const cw = ch.charCodeAt(0) > 0x2e80 ? fontSize : fontSize * 0.56;
      if (w + cw > maxWidth && cur) { lines.push(cur); cur = ch; w = cw; }
      else { cur += ch; w += cw; }
    }
    lines.push(cur);
  }
  return lines.length ? lines : [''];
}

/* ---------------- 标签引擎（Stateflow 四段） ---------------- */
export interface LabelParts { event?: string; condition?: string; conditionAction?: string; transitionAction?: string }
export function parseLabel(raw: string): LabelParts {
  const s = (raw ?? '').trim();
  const out: LabelParts = {};
  let event = '', i = 0;
  const readBlock = (open: string, close: string): string => {
    let depth = 0, buf = '';
    while (i < s.length) {
      const c = s[i];
      if (c === open) { depth++; i++; if (depth === 1) continue; buf += c; continue; }
      if (c === close) { depth--; i++; if (depth === 0) return buf; buf += c; continue; }
      buf += c; i++;
    }
    return buf;
  };
  while (i < s.length) {
    const c = s[i];
    if (c === '[') { out.condition = readBlock('[', ']'); continue; }
    if (c === '{') { out.conditionAction = readBlock('{', '}'); continue; }
    if (c === '/') { i++; out.transitionAction = s.slice(i).trim(); i = s.length; continue; }
    if (event === '' && !out.condition && !out.conditionAction) { event += c; i++; continue; }
    i++;
  }
  event = event.trim();
  if (event) out.event = event;
  return out;
}
export function formatLabel(t: LabelParts): string {
  let s = t.event ?? '';
  if (t.condition) s += `[${t.condition}]`;
  if (t.conditionAction) s += `{${t.conditionAction}}`;
  if (t.transitionAction) s += `/${t.transitionAction}`;
  return s;
}
export function labelLines(t: LabelParts): string[] {
  const head = `${t.event ?? ''}${t.condition ? `[${t.condition}]` : ''}${t.conditionAction ? `{${t.conditionAction}}` : ''}`;
  const lines: string[] = [];
  if (head.trim()) lines.push(head.trim());
  if (t.transitionAction) lines.push(`/ ${t.transitionAction}`);
  return lines;
}

/* ---------------- 数据模型 ---------------- */
export type NodeKind = 'state' | 'terminal' | 'junction' | 'start';
export interface ProjectState {
  id: string; name: string; kind: NodeKind;
  entry?: string; during?: string; exit?: string; note?: string;
  color: PaletteColor; position: { x: number; y: number };
}
export interface ProjectTransition {
  id: string; source: string; target: string;
  event?: string; condition?: string; conditionAction?: string; transitionAction?: string;
  enabled: boolean; note?: string;
  lineWidth?: number; dashed?: boolean; lineColor?: PaletteColor;
  lineStyle?: 'bezier' | 'smoothstep' | 'orthogonal' | 'straight';
  bend?: number;
}
export interface ProjectSettings {
  theme: ThemeMode; edgeStyle: 'bezier' | 'smoothstep' | 'orthogonal' | 'straight';
  showGrid: boolean; showMiniMap: boolean; snapToGrid: boolean; showActionText: boolean;
  edgeWidth: number; arrowSize: number;
}
/** 状态机内容切片（供几何引擎使用） */
export interface ProjectDoc { states: ProjectState[]; transitions: ProjectTransition[] }

export type FlowKind = 'start' | 'process' | 'decision' | 'io' | 'subprocess';
export interface FlowEdge { id: string; source: string; target: string; label?: string }
export interface InnerFlow { nodes: FlowNode[]; edges: FlowEdge[] }
export interface FlowNode {
  id: string; kind: FlowKind; text: string;
  x: number; y: number; w: number; h: number;
  color: ShapeColorKey; fill: string; stroke: string;
  inner?: InnerFlow; expanded?: boolean; expandPos?: { x: number; y: number };
}
export type WbKind = 'image' | 'rect' | 'ellipse' | 'arrow' | 'line' | 'text';
export interface WbShape {
  id: string; kind: WbKind; x: number; y: number; w: number; h: number;
  color?: ShapeColorKey; fill: string; stroke: string; strokeWidth: number;
  text?: string; src?: string;
}

export type PageType = 'canvas' | 'whiteboard';
export interface Page {
  id: string; type: PageType; name: string;
  states: ProjectState[]; transitions: ProjectTransition[];
  flowNodes: FlowNode[]; flowEdges: FlowEdge[]; flowDir: 'LR' | 'TB';
  wbShapes: WbShape[];
}
export interface StudioDoc { version: number; name: string; pages: Page[]; activePageId: string; settings: ProjectSettings }

/* ---------------- id 生成 ---------------- */
let uidCounter = 0;
export function uid(prefix: string): string {
  uidCounter = (uidCounter + 1) % 1296;
  return `${prefix}_${Date.now().toString(36).slice(-5)}${uidCounter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

/* ---------------- 默认值 / 工厂 ---------------- */
export function defaultSettings(theme: ThemeMode = 'light'): ProjectSettings {
  return { theme, edgeStyle: 'smoothstep', showGrid: true, showMiniMap: true, snapToGrid: true, showActionText: true, edgeWidth: 1.6, arrowSize: 16 };
}
const FLOW_DEFAULTS: Record<FlowKind, { w: number; h: number; text: string; color: ShapeColorKey }> = {
  start: { w: 118, h: 44, text: '开始', color: 'green' },
  process: { w: 132, h: 52, text: '新流程', color: 'indigo' },
  decision: { w: 148, h: 74, text: '判定?', color: 'amber' },
  io: { w: 140, h: 52, text: '输入/输出', color: 'sky' },
  subprocess: { w: 190, h: 64, text: '子流程', color: 'violet' },
};
export function makeFlowNode(kind: FlowKind, x: number, y: number): FlowNode {
  const d = FLOW_DEFAULTS[kind];
  const light = SHAPE_COLORS[d.color].light;
  const n: FlowNode = { id: uid('f'), kind, text: d.text, x, y, w: d.w, h: d.h, color: d.color, fill: light.fill, stroke: light.stroke };
  if (kind === 'subprocess') { n.inner = { nodes: [], edges: [] }; n.expanded = false; }
  return n;
}
export function makeWbShape(kind: WbKind, x: number, y: number): WbShape {
  const base: WbShape = { id: uid('w'), kind, x, y, w: 160, h: 100, color: 'indigo', fill: SHAPE_COLORS.indigo.light.fill, stroke: SHAPE_COLORS.indigo.light.stroke, strokeWidth: 2 };
  if (kind === 'ellipse') { base.color = 'sky'; base.fill = SHAPE_COLORS.sky.light.fill; base.stroke = SHAPE_COLORS.sky.light.stroke; }
  if (kind === 'arrow') { base.w = 160; base.h = 0; base.fill = 'none'; base.stroke = '#f43f5e'; base.strokeWidth = 2.5; base.color = undefined; }
  if (kind === 'line') { base.w = 160; base.h = 0; base.fill = 'none'; base.stroke = '#64748b'; base.strokeWidth = 2; base.color = undefined; }
  if (kind === 'text') { base.w = 180; base.h = 40; base.fill = 'none'; base.stroke = 'transparent'; base.text = '双击编辑文字'; base.color = undefined; }
  return base;
}
export function makeSmState(kind: NodeKind, x: number, y: number, name: string): ProjectState {
  return { id: uid('s'), name, kind, color: kind === 'terminal' ? 'rose' : kind === 'junction' ? 'slate' : 'indigo', position: { x, y } };
}
export function makePage(type: PageType, name: string): Page {
  return { id: uid('p'), type, name, states: [], transitions: [], flowNodes: [], flowEdges: [], flowDir: 'TB', wbShapes: [] };
}
export function defaultDoc(theme: ThemeMode): StudioDoc {
  const p = makePage('canvas', '主画布');
  return { version: 3, name: '未命名工程', pages: [p], activePageId: p.id, settings: defaultSettings(theme) };
}

/* ---------------- 初始结点派生态 ---------------- */
export function ensureStartNode(page: Page): Page {
  const needs = page.transitions.some((t) => t.source === START_ID);
  const has = page.states.some((s) => s.id === START_ID);
  if (needs && !has) {
    const target = page.transitions.find((t) => t.source === START_ID);
    const ts = page.states.find((s) => s.id === target?.target);
    const start: ProjectState = { id: START_ID, name: 'start', kind: 'start', color: 'slate', position: { x: ts ? ts.position.x - 120 : 40, y: ts ? ts.position.y + 15 : 120 } };
    return { ...page, states: [start, ...page.states] };
  }
  if (!needs && has) return { ...page, states: page.states.filter((s) => s.id !== START_ID) };
  return page;
}

/* ---------------- 结点尺寸（状态机） ---------------- */
const NODE_HEADER_H = 34;
export function actionLines(s: ProjectState, show: boolean): { k: string; t: string }[] {
  if (!show) return [];
  const out: { k: string; t: string }[] = [];
  const add = (k: string, v?: string) => { if (v) v.split(/[;\n]/).map((x) => x.trim()).filter(Boolean).forEach((t) => out.push({ k, t: t + ';' })); };
  add('entry', s.entry); add('during', s.during); add('exit', s.exit);
  return out;
}
export function nodeSize(s: ProjectState, settings: ProjectSettings): { w: number; h: number } {
  if (s.kind === 'junction') return { w: 26, h: 26 };
  if (s.kind === 'start') return { w: 22, h: 22 };
  const nameW = estWidth(s.name || 'State', 13);
  const w = Math.max(132, Math.min(300, nameW + 36));
  const lines = actionLines(s, settings.showActionText);
  const h = lines.length ? NODE_HEADER_H + lines.length * 16 + 10 : 52;
  return { w, h };
}
