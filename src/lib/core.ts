/* ============================================================
 * StateFlow Studio — 数据层核心（唯一事实来源）
 * 数据模型 / 标签引擎 / 文本度量 / 色板 / normalize / 示例工程
 * ============================================================ */

export type NodeKind = 'state' | 'terminal' | 'junction' | 'start';
export type PaletteColor =
  | 'indigo' | 'blue' | 'teal' | 'green'
  | 'amber' | 'rose' | 'violet' | 'slate';
export type LayoutKind = 'LR' | 'TB' | 'circle' | 'grid';
export type EdgeStyleKind = 'bezier' | 'smoothstep' | 'orthogonal' | 'straight';
export type ThemeMode = 'light' | 'dark';

export interface ProjectState {
  id: string;
  name: string;
  kind: NodeKind;
  entry?: string;
  during?: string;
  exit?: string;
  note?: string;
  color: PaletteColor;
  position: { x: number; y: number };
}

export interface ProjectTransition {
  id: string;
  source: string;
  target: string;
  event?: string;
  condition?: string;
  conditionAction?: string;
  transitionAction?: string;
  enabled: boolean;
  note?: string;
  lineWidth?: number;
  dashed?: boolean;
  lineColor?: PaletteColor;
}

export interface ProjectSettings {
  layout: LayoutKind;
  edgeStyle: EdgeStyleKind;
  theme: ThemeMode;
  showGrid: boolean;
  showMiniMap: boolean;
  snapToGrid: boolean;
  showActionText: boolean;
  edgeWidth: number;
  arrowSize: number;
}

export interface ProjectDoc {
  version: 1;
  name: string;
  states: ProjectState[];
  transitions: ProjectTransition[];
  settings: ProjectSettings;
}

export const START_ID = '__start__';
export const GRID_SNAP = 16;
export const FONT_STACK =
  "'Space Grotesk','Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif";

/* ---------------- 色板（8 色 × 明暗两套） ---------------- */

export const COLOR_ORDER: PaletteColor[] = [
  'indigo', 'blue', 'teal', 'green', 'amber', 'rose', 'violet', 'slate',
];

export const COLOR_LABELS: Record<PaletteColor, string> = {
  indigo: '靛蓝', blue: '天蓝', teal: '青绿', green: '草绿',
  amber: '琥珀', rose: '玫红', violet: '紫罗兰', slate: '石墨',
};

interface ToneSet { fill: string; border: string; accent: string; text: string }

export const PALETTES: Record<PaletteColor, { light: ToneSet; dark: ToneSet }> = {
  indigo: {
    light: { fill: '#eef1ff', border: '#8b9af0', accent: '#4f5fe0', text: '#333d9e' },
    dark: { fill: '#252b52', border: '#5f6bd6', accent: '#8b96ef', text: '#c6cdfb' },
  },
  blue: {
    light: { fill: '#e7f3fe', border: '#67aaf5', accent: '#2272dd', text: '#1d4f9e' },
    dark: { fill: '#1c3252', border: '#3d82e0', accent: '#6aa5f2', text: '#bcd8fb' },
  },
  teal: {
    light: { fill: '#e2f6f1', border: '#34c4ae', accent: '#0d9488', text: '#0f5e56' },
    dark: { fill: '#123a35', border: '#17a695', accent: '#35d3bd', text: '#96f0e0' },
  },
  green: {
    light: { fill: '#e8f7ea', border: '#54c468', accent: '#22993d', text: '#1c6630' },
    dark: { fill: '#17391f', border: '#2da448', accent: '#57cf70', text: '#b4f0c0' },
  },
  amber: {
    light: { fill: '#fdf2dd', border: '#eeb63f', accent: '#d18a06', text: '#8f5c06' },
    dark: { fill: '#3f3010', border: '#d99c17', accent: '#f2bd45', text: '#f8e3ac' },
  },
  rose: {
    light: { fill: '#fdecf0', border: '#f07d94', accent: '#de3357', text: '#9c2440' },
    dark: { fill: '#451725', border: '#e04f6e', accent: '#f97e98', text: '#fcc4d0' },
  },
  violet: {
    light: { fill: '#f2eefc', border: '#a489ec', accent: '#7a3fdd', text: '#57309c' },
    dark: { fill: '#302456', border: '#8b5fe0', accent: '#b18ef5', text: '#ddcffc' },
  },
  slate: {
    light: { fill: '#edf0f4', border: '#93a1b4', accent: '#52617a', text: '#39465c' },
    dark: { fill: '#272f3c', border: '#5d6b80', accent: '#93a3b8', text: '#c9d3e0' },
  },
};

/** 主题级令牌（画布 / 连线 / 结点公共色） */
export const THEME = {
  light: {
    canvas: '#eef0f4', dot: '#c3ccd7',
    edge: '#5f6e84', edgeLabelBg: '#ffffff', edgeLabelBorder: '#d5dbe4', edgeLabelText: '#3c4a61',
    actionText: '#4a5872', muted: '#7b8798',
    startFill: '#333f52', startDot: '#ffffff',
    junctionFill: '#5f6e84', junctionBorder: '#ffffff',
    sel: '#0d9488', selGlow: 'rgba(13,148,136,0.30)',
  },
  dark: {
    canvas: '#11161d', dot: '#232c38',
    edge: '#8794a8', edgeLabelBg: '#1b222d', edgeLabelBorder: '#3a4553', edgeLabelText: '#c3cdda',
    actionText: '#a7b3c4', muted: '#77839a',
    startFill: '#cbd5e1', startDot: '#131a24',
    junctionFill: '#8794a8', junctionBorder: '#11161d',
    sel: '#2dd4bf', selGlow: 'rgba(45,212,191,0.38)',
  },
} as const;

/* ---------------- 标签引擎（4.5 节，跨栈必须复刻） ----------------
 * event[condition]{condition_action}/transition_action
 * 顺序任意但括号须配对（支持嵌套）；/ 之后剩余全部为 transitionAction。 */

export interface LabelParts {
  event?: string;
  condition?: string;
  conditionAction?: string;
  transitionAction?: string;
}

export function parseLabel(raw: string): LabelParts {
  const s = (raw ?? '').trim();
  const out: LabelParts = {};
  let event = '';
  let i = 0;
  const readBlock = (open: string, close: string): string => {
    let depth = 0;
    let buf = '';
    while (i < s.length) {
      const c = s[i];
      if (c === open) { depth++; i++; if (depth === 1) continue; buf += c; continue; }
      if (c === close) {
        depth--;
        if (depth === 0) { i++; return buf; }
        buf += c; i++; continue;
      }
      if (depth >= 1) buf += c;
      i++;
    }
    return buf; // 容忍残缺：未配对时吃掉剩余文本，不抛错
  };
  while (i < s.length) {
    const c = s[i];
    if (c === '[') { out.condition = out.condition ? out.condition + readBlock('[', ']') : readBlock('[', ']'); continue; }
    if (c === '{') { out.conditionAction = out.conditionAction ? out.conditionAction + readBlock('{', '}') : readBlock('{', '}'); continue; }
    if (c === '/') { out.transitionAction = s.slice(i + 1).trim() || undefined; i = s.length; break; }
    event += c;
    i++;
  }
  const ev = event.trim();
  if (ev) out.event = ev;
  if (out.condition !== undefined) out.condition = out.condition.trim() || undefined;
  if (out.conditionAction !== undefined) out.conditionAction = out.conditionAction.trim() || undefined;
  return out;
}

export function formatLabel(p: LabelParts): string {
  let s = p.event ?? '';
  if (p.condition) s += `[${p.condition}]`;
  if (p.conditionAction) s += `{${p.conditionAction}}`;
  if (p.transitionAction) s += `/${p.transitionAction}`;
  return s;
}

/** 画布标签第一行：event[cond]{ca} */
export function labelHead(p: ProjectTransition): string {
  let s = p.event ?? '';
  if (p.condition) s += `[${p.condition}]`;
  if (p.conditionAction) s += `{${p.conditionAction}}`;
  return s;
}

/** 画布标签分行：[头段, '/ ta'] */
export function labelLines(p: ProjectTransition): string[] {
  const lines: string[] = [];
  const head = labelHead(p);
  if (head) lines.push(head);
  if (p.transitionAction) lines.push(`/ ${p.transitionAction}`);
  return lines;
}

/* ---------------- 文本度量（CJK≈1em，拉丁≈0.56em） ---------------- */

export function estWidth(text: string, fontSize: number): number {
  let units = 0;
  for (let i = 0; i < text.length; i++) {
    units += text.charCodeAt(i) >= 0x2e80 ? 1 : 0.56;
  }
  return Math.ceil(units * fontSize);
}

export function truncateText(text: string, fontSize: number, maxWidth: number): string {
  if (estWidth(text, fontSize) <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && estWidth(t + '…', fontSize) > maxWidth) t = t.slice(0, -1);
  return t + '…';
}

/* ---------------- 结点动作行与尺寸 ---------------- */

export interface ActionLine { k: 'entry' | 'during' | 'exit'; t: string }

export function actionLines(s: ProjectState, show: boolean): ActionLine[] {
  if (!show || s.kind === 'junction' || s.kind === 'start') return [];
  const out: ActionLine[] = [];
  (['entry', 'during', 'exit'] as const).forEach((k) => {
    const v = s[k];
    if (!v) return;
    v.split(/[;\n]/).map((x) => x.trim()).filter(Boolean).forEach((t) => {
      out.push({ k, t: t.endsWith(';') ? t : t + ';' });
    });
  });
  return out;
}

export const NODE_HEADER_H = 34;

export function nodeSize(s: ProjectState, settings: ProjectSettings): { w: number; h: number } {
  if (s.kind === 'junction') return { w: 26, h: 26 };
  if (s.kind === 'start') return { w: 22, h: 22 };
  const nameW = estWidth(s.name || 'State', 13);
  const w = Math.max(132, Math.min(300, nameW + 36));
  const lines = actionLines(s, settings.showActionText);
  const h = lines.length ? NODE_HEADER_H + lines.length * 16 + 10 : 52;
  return { w, h };
}

/* ---------------- normalize / 默认值 / 初始结点派生态 ---------------- */

export function defaultSettings(): ProjectSettings {
  return {
    layout: 'LR', edgeStyle: 'smoothstep', theme: 'light',
    showGrid: true, showMiniMap: true, snapToGrid: true, showActionText: true,
    edgeWidth: 1.6, arrowSize: 16,
  };
}

export function defaultDoc(name: string): ProjectDoc {
  return { version: 1, name, states: [], transitions: [], settings: defaultSettings() };
}

let uidCounter = 0;
export function uid(prefix: 's' | 't'): string {
  uidCounter = (uidCounter + 1) % 1296;
  return `${prefix}_${Date.now().toString(36).slice(-5)}${uidCounter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

/** 初始结点为派生态：仅当存在 source=__start__ 的转移时需要存在 */
export function ensureStartNode(doc: ProjectDoc): ProjectDoc {
  const needs = doc.transitions.some((t) => t.source === START_ID);
  const has = doc.states.some((s) => s.id === START_ID);
  if (needs && !has) {
    const target = doc.transitions.find((t) => t.source === START_ID);
    const ts = doc.states.find((s) => s.id === target?.target);
    const x = ts ? ts.position.x - 120 : 40;
    const y = ts ? ts.position.y + 15 : 120;
    const start: ProjectState = {
      id: START_ID, name: 'start', kind: 'start', color: 'slate', position: { x, y },
    };
    return { ...doc, states: [start, ...doc.states] };
  }
  if (!needs && has) {
    return { ...doc, states: doc.states.filter((s) => s.id !== START_ID) };
  }
  return doc;
}

/** 读取工程文件：补默认值；version 非 1 抛错由调用方提示 */
export function normalizeDoc(raw: unknown): ProjectDoc {
  const d = raw as Partial<ProjectDoc> | null;
  if (!d || typeof d !== 'object') throw new Error('bad doc');
  if (d.version !== 1) throw new Error('unsupported version');
  const states: ProjectState[] = Array.isArray(d.states)
    ? d.states.filter((s) => s && typeof s.id === 'string').map((s, i) => ({
        id: s.id,
        name: typeof s.name === 'string' ? s.name : `State${i + 1}`,
        kind: (['state', 'terminal', 'junction', 'start'] as NodeKind[]).includes(s.kind) ? s.kind : 'state',
        entry: s.entry || undefined,
        during: s.during || undefined,
        exit: s.exit || undefined,
        note: s.note || undefined,
        color: COLOR_ORDER.includes(s.color) ? s.color : 'indigo',
        position: {
          x: Number(s.position?.x) || 0,
          y: Number(s.position?.y) || 0,
        },
      }))
    : [];
  const transitions: ProjectTransition[] = Array.isArray(d.transitions)
    ? d.transitions.filter((t) => t && typeof t.source === 'string' && typeof t.target === 'string').map((t, i) => ({
        id: typeof t.id === 'string' ? t.id : uid('t'),
        source: t.source,
        target: t.target,
        event: t.event || undefined,
        condition: t.condition || undefined,
        conditionAction: t.conditionAction || undefined,
        transitionAction: t.transitionAction || undefined,
        enabled: t.enabled !== false,
        note: t.note || undefined,
        lineWidth: typeof t.lineWidth === 'number' ? t.lineWidth : undefined,
        dashed: t.dashed === true ? true : undefined,
        lineColor: t.lineColor && COLOR_ORDER.includes(t.lineColor) ? t.lineColor : undefined,
      }))
    : [];
  const doc: ProjectDoc = {
    version: 1,
    name: typeof d.name === 'string' && d.name.trim() ? d.name : '未命名状态机',
    states,
    transitions,
    settings: { ...defaultSettings(), ...(typeof d.settings === 'object' && d.settings ? d.settings : {}) },
  };
  return ensureStartNode(doc);
}

export function nextStateName(doc: ProjectDoc): string {
  const used = new Set(doc.states.map((s) => s.name));
  let n = doc.states.filter((s) => s.kind === 'state').length + 1;
  while (used.has(`State${n}`)) n++;
  return `State${n}`;
}

export function sanitizeFilename(name: string): string {
  return (name.trim() || '未命名状态机').replace(/[\\/:*?"<>|\s]+/g, '_');
}

export function cloneDoc(doc: ProjectDoc): ProjectDoc {
  return JSON.parse(JSON.stringify(doc)) as ProjectDoc;
}

/* ---------------- 内置示例工程 ---------------- */

const trafficLight: ProjectDoc = {
  version: 1,
  name: '交通信号灯',
  states: [
    { id: START_ID, name: 'start', kind: 'start', color: 'slate', position: { x: 40, y: 158 } },
    { id: 's_red', name: '红灯', kind: 'state', color: 'rose', entry: 'cnt = 0;', during: 'lamp = RED;', position: { x: 180, y: 120 }, note: '主相位：南北向放行' },
    { id: 's_green', name: '绿灯', kind: 'state', color: 'green', entry: 't = 0;', during: 'lamp = GREEN;', position: { x: 470, y: 120 } },
    { id: 's_yellow', name: '黄灯', kind: 'state', color: 'amber', entry: 't = 0;', during: 'lamp = YELLOW;', position: { x: 760, y: 120 } },
    { id: 's_off', name: '夜间闪烁', kind: 'terminal', color: 'slate', entry: 'lamp = BLINK;', position: { x: 470, y: 330 }, note: '终止状态：调度中心接管' },
  ],
  transitions: [
    { id: 't_boot', source: START_ID, target: 's_red', enabled: true },
    { id: 't_wait', source: 's_red', target: 's_red', event: 'TICK', condition: 'cnt < 30', conditionAction: 'cnt++;', enabled: true },
    { id: 't_go', source: 's_red', target: 's_green', event: 'TICK', condition: 'cnt >= 30', conditionAction: 'cnt = 0;', enabled: true },
    { id: 't_warn', source: 's_green', target: 's_yellow', event: 'TICK', condition: 't >= 25', enabled: true },
    { id: 't_back', source: 's_yellow', target: 's_red', event: 'TICK', condition: 't >= 3', transitionAction: 'next();', enabled: true },
    { id: 't_night', source: 's_yellow', target: 's_off', event: 'CMD_NIGHT', condition: 'sw == 1', transitionAction: 'alarm();', enabled: true },
  ],
  settings: { ...defaultSettings(), layout: 'LR' },
};

const motorControl: ProjectDoc = {
  version: 1,
  name: '电机控制',
  states: [
    { id: START_ID, name: 'start', kind: 'start', color: 'slate', position: { x: 40, y: 178 } },
    { id: 'm_idle', name: 'IDLE', kind: 'state', color: 'indigo', entry: 'motor = 0;', position: { x: 180, y: 150 }, note: '待机：等待启动指令' },
    { id: 'm_run', name: 'RUN', kind: 'state', color: 'blue', entry: 'ramp = 1;', during: 'motor = PWM;', position: { x: 460, y: 150 } },
    { id: 'm_j', name: 'J1', kind: 'junction', color: 'slate', position: { x: 745, y: 163 } },
    { id: 'm_fault', name: 'FAULT', kind: 'state', color: 'rose', entry: 'alarm();', exit: 'alarm = 0;', position: { x: 950, y: 48 } },
    { id: 'm_done', name: 'DONE', kind: 'terminal', color: 'green', entry: 'motor = 0;', position: { x: 950, y: 280 } },
  ],
  transitions: [
    { id: 'tm_boot', source: START_ID, target: 'm_idle', enabled: true },
    { id: 'tm_ping', source: 'm_idle', target: 'm_idle', event: 'PING', transitionAction: 'heartbeat();', enabled: true },
    { id: 'tm_start', source: 'm_idle', target: 'm_run', event: 'CMD_START', condition: 'ready', conditionAction: 'ramp = 1;', transitionAction: 'motorOn();', enabled: true },
    { id: 'tm_hot', source: 'm_run', target: 'm_j', event: 'OVERHEAT', enabled: true },
    { id: 'tm_fault', source: 'm_j', target: 'm_fault', condition: 'temp > 90', conditionAction: 'alarm();', enabled: true },
    { id: 'tm_cool', source: 'm_j', target: 'm_idle', condition: 'temp <= 90', transitionAction: 'coolDown();', enabled: true },
    { id: 'tm_stop', source: 'm_run', target: 'm_done', event: 'CMD_STOP', transitionAction: 'motorOff();', enabled: true, lineWidth: 2.2, lineColor: 'teal' },
  ],
  settings: { ...defaultSettings(), layout: 'LR', edgeStyle: 'smoothstep' },
};

export const SAMPLES: ProjectDoc[] = [trafficLight, motorControl];

/* ---------------- 批量转移导入（FR-2.3） ---------------- */

export function parseBulkTransitions(
  text: string,
  doc: ProjectDoc
): { ok: ProjectTransition[]; skipped: number } {
  const ok: ProjectTransition[] = [];
  let skipped = 0;
  const byName = new Map<string, ProjectState>();
  doc.states.forEach((s) => {
    byName.set(s.name, s);
    byName.set(s.id, s);
  });
  for (const rawLine of text.split(/\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(.+?)\s*(?:->|→|=>)\s*(.+?)(?:\s*[:：]\s*(.*))?$/);
    if (!m) { skipped++; continue; }
    const src = byName.get(m[1].trim());
    const dst = byName.get(m[2].trim());
    if (!src || !dst) { skipped++; continue; }
    const parts = parseLabel(m[3] ?? '');
    ok.push({
      id: uid('t'), source: src.id, target: dst.id, enabled: true, ...parts,
    });
  }
  return { ok, skipped };
}
