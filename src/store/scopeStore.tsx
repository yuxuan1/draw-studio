/* ============================================================
 * scopeStore —— FlowForge 全局状态
 *
 * Source of Truth 优先级：Domain Model > ScopeLayout > 渲染态
 *  - project/layouts 由 Command 历史栈管理（C10，可撤销）
 *  - 作用域导航（scopeStack）不入 Undo（浏览器式历史）
 *  - 每个 Process 一套稳定布局，进出 Scope 不重排（C07/红线）
 * ============================================================ */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  Project, Process, ScopeRef, ScopeLayout, ID, Position,
  NodeType, EdgeStyle, Handle, Projection, Edge, Page, ShapeColorKey,
} from '../lib/domain';
import type { ThemeMode } from '../lib/core';
import {
  defaultProject, uid, projectProcess, layoutProcess, layoutCallGraph, buildProjectCallGraph,
  NODE_DEFAULTS, makeNode, serializeProject, deserializeProject, calledBy, OVERVIEW_CARD,
} from '../lib/domain';
import type { Function as FnDef, CallNode, ReferenceNode } from '../lib/domain';
import type { Command } from '../lib/command';
import { createHistory, execute, undo as hUndo, redo as hRedo, replaceCmd, batchCmd } from '../lib/command';

export interface Sel { kind: null | 'node' | 'edge'; id: ID | null; ids: ID[] }
export type SelInput = { kind: Sel['kind']; id?: ID | null; ids?: ID[] };
export type Tool = 'select' | NodeType;
export type AppMode = 'edit' | 'read';
export type ViewKind = 'flow' | 'callgraph';
export interface PaletteState { open: boolean; x: number; y: number; step: null | 'call' | 'reference' }
interface Toast { id: number; msg: string; type: 'ok' | 'err' }

/** Command 管理的状态：Domain + 布局（二者都是真源，渲染态可丢弃） */
interface DocState { project: Project; layouts: Record<ID, ScopeLayout> }

const LS_KEY = 'flowforge.project.v1';

function loadInitial(): DocState {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const d = JSON.parse(raw) as { project?: Project; layouts?: Record<ID, ScopeLayout> };
      const project = d.project ? (deserializeProject(JSON.stringify(d.project)) ?? defaultProject()) : defaultProject();
      return { project, layouts: d.layouts ?? {} };
    }
  } catch { /* fallthrough */ }
  const project = defaultProject();
  const layouts: Record<ID, ScopeLayout> = {};
  project.processes.forEach((p) => {
    if (p.nodes.length) {
      layouts[p.id] = { positions: layoutProcess(p), viewport: { x: 0, y: 0, zoom: 1 }, locked: false, algorithm: 'hierarchical' };
    }
  });
  return { project, layouts };
}

function readDomTheme(): ThemeMode {
  const el = document.documentElement;
  return el.classList.contains('dark') || el.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

interface ScopeCtx {
  project: Project; layouts: Record<ID, ScopeLayout>;
  scope: ScopeRef; scopeStack: ScopeRef[];
  page: Page; currentProcess: Process | null; projection: Projection;
  canUndo: boolean; canRedo: boolean; undo: () => void; redo: () => void;
  addNode: (type: NodeType, x: number, y: number) => void;
  deleteSel: () => void;
  renameNode: (nid: ID, name: string) => void;
  moveNode: (nid: ID, to: Position) => void;
  setNodeColor: (nid: ID, color: ShapeColorKey) => void;
  setNodeType: (nid: ID, type: NodeType) => void;
  createEdge: (source: ID, target: ID, sh?: Handle, th?: Handle) => void;
  deleteEdge: (eid: ID) => void;
  setEdgeStyle: (eid: ID, style: EdgeStyle) => void;
  setEdgeLabel: (eid: ID, label: string) => void;
  autoLayout: () => void;
  enterScope: (processId: ID) => void; back: () => void; canBack: boolean;
  gotoPage: (pageId: ID) => void; gotoProcess: (processId: ID) => void;
  sel: Sel; setSel: (s: SelInput) => void;
  tool: Tool; setTool: (t: Tool) => void;
  theme: ThemeMode; setTheme: (t: ThemeMode) => void;
  previewNodeId: ID | null; setPreviewNodeId: (id: ID | null) => void;
  toasts: Toast[]; toast: (msg: string, type?: Toast['type']) => void;
  addPage: () => void; deletePage: (id: ID) => void; renamePage: (id: ID, name: string) => void;
  fitSignal: number; requestFit: () => void;
  savedAt: number;
  exportHandle: { current: null | ((bg: 'white' | 'transparent' | 'theme') => { svg: string; w: number; h: number } | null) };
  /* 阅读 / 编辑模式 */
  mode: AppMode; toggleMode: () => void;
  /* P 键形状选择面板 */
  palette: PaletteState; openPalette: () => void; closePalette: () => void; setPaletteStep: (s: PaletteState['step']) => void;
  placeNode: (type: NodeType, opts?: { targetProcessId?: ID; functionId?: ID }) => void;
  screenToWorldRef: { current: null | ((sx: number, sy: number) => Position) };
  /* 全局调用图视图 */
  viewKind: ViewKind; setViewKind: (v: ViewKind) => void;
  moveOverviewNode: (id: ID, to: Position) => void;
  /* 函数库 */
  addFunction: () => void; renameFunction: (id: ID, name: string) => void; deleteFunction: (id: ID) => void;
}

const Ctx = createContext<ScopeCtx | null>(null);
export function useScope(): ScopeCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useScope outside provider');
  return v;
}

export function ScopeProvider({ children }: { children: ReactNode }) {
  const [hist, setHist] = useState(() => createHistory<DocState>(loadInitial()));
  const docRef = useRef(hist.present);
  docRef.current = hist.present;

  const [scopeStack, setScopeStack] = useState<ScopeRef[]>(() => {
    const p = docRef.current.project;
    const page = p.pages[0];
    return [{ pageId: page.id, processId: page.rootProcessId }];
  });
  const [sel, setSelState] = useState<Sel>({ kind: null, id: null, ids: [] });
  const [tool, setTool] = useState<Tool>('select');
  const [theme, setThemeState] = useState<ThemeMode>(() => readDomTheme());
  const [previewNodeId, setPreviewNodeId] = useState<ID | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [fitSignal, setFitSignal] = useState(0);
  const [savedAt, setSavedAt] = useState(0);
  const exportHandle = useRef<ScopeCtx['exportHandle']['current']>(null);

  const { project, layouts } = hist.present;
  const scope = scopeStack[scopeStack.length - 1];
  const page = project.pages.find((p) => p.id === scope.pageId) ?? project.pages[0];
  const currentProcessId = scope.processId ?? page?.rootProcessId;
  const currentProcess = project.processes.find((p) => p.id === currentProcessId) ?? null;

  const projection = useMemo<Projection>(
    () => (currentProcess ? projectProcess(currentProcess, layouts[currentProcess.id]) : { nodes: [], edges: [] }),
    [currentProcess, layouts],
  );

  /* ---------- Command 执行 ---------- */
  const run = useCallback((cmd: Command<DocState>) => setHist((h) => execute(h, cmd)), []);
  const undo = useCallback(() => setHist((h) => hUndo(h)), []);
  const redo = useCallback(() => setHist((h) => hRedo(h)), []);

  /** 在当前 Process 上做一个不可合并的替换命令 */
  const mutateProcess = useCallback((pid: ID, label: string, fn: (p: Process) => Process) => {
    const before = docRef.current;
    const after: DocState = {
      ...before,
      project: { ...before.project, processes: before.project.processes.map((p) => (p.id === pid ? fn(p) : p)) },
    };
    run(replaceCmd(label, before, after));
  }, [run]);

  /* ---------- 节点操作 ---------- */
  const addNode = useCallback((type: NodeType, x: number, y: number) => {
    const pid = currentProcessId; if (!pid) return;
    const node = makeNode(type, 0, 0);
    const before = docRef.current;
    const after: DocState = {
      project: { ...before.project, processes: before.project.processes.map((p) => (p.id === pid ? { ...p, nodes: [...p.nodes, node] } : p)) },
      layouts: { ...before.layouts, [pid]: { ...(before.layouts[pid] ?? { positions: {}, viewport: { x: 0, y: 0, zoom: 1 }, locked: false, algorithm: 'manual' as const }), positions: { ...(before.layouts[pid]?.positions ?? {}), [node.id]: { x: Math.round(x), y: Math.round(y) } } } },
    };
    run(replaceCmd('新增节点', before, after));
    setSelState({ kind: 'node', id: node.id, ids: [node.id] });
  }, [currentProcessId, run]);

  const deleteSel = useCallback(() => {
    const pid = currentProcessId; if (!pid) return;
    const s = sel;
    const before = docRef.current;
    let after: DocState = before;
    if (s.kind === 'node' && s.ids.length) {
      const rm = new Set(s.ids);
      after = {
        ...after,
        project: { ...after.project, processes: after.project.processes.map((p) => (p.id === pid ? { ...p, nodes: p.nodes.filter((n) => !rm.has(n.id)), edges: p.edges.filter((e) => !rm.has(e.source) && !rm.has(e.target)) } : p)) },
      };
    } else if (s.kind === 'edge' && s.id) {
      const eid = s.id;
      after = { ...after, project: { ...after.project, processes: after.project.processes.map((p) => (p.id === pid ? { ...p, edges: p.edges.filter((e) => e.id !== eid) } : p)) } };
    } else return;
    run(replaceCmd('删除', before, after));
    setSelState({ kind: null, id: null, ids: [] });
  }, [currentProcessId, sel, run]);

  const renameNode = useCallback((nid: ID, name: string) => {
    const pid = currentProcessId; if (!pid) return;
    mutateProcess(pid, '重命名', (p) => ({ ...p, nodes: p.nodes.map((n) => (n.id === nid ? { ...n, name } : n)) }));
  }, [currentProcessId, mutateProcess]);

  const moveNode = useCallback((nid: ID, to: Position) => {
    const pid = currentProcessId; if (!pid) return;
    const before = docRef.current;
    const lay = before.layouts[pid];
    const positions = { ...(lay?.positions ?? {}), [nid]: { x: Math.round(to.x), y: Math.round(to.y) } };
    const after: DocState = {
      ...before,
      layouts: { ...before.layouts, [pid]: { ...(lay ?? { positions: {}, viewport: { x: 0, y: 0, zoom: 1 }, locked: false, algorithm: 'manual' as const }), positions } },
    };
    run(replaceCmd('移动节点', before, after, `move:${pid}:${nid}`));
  }, [currentProcessId, run]);

  const setNodeColor = useCallback((nid: ID, color: ShapeColorKey) => {
    const pid = currentProcessId; if (!pid) return;
    mutateProcess(pid, '节点配色', (p) => ({ ...p, nodes: p.nodes.map((n) => (n.id === nid ? { ...n, properties: { ...(n.properties ?? {}), color } } : n)) }));
  }, [currentProcessId, mutateProcess]);

  const setNodeType = useCallback((nid: ID, type: NodeType) => {
    const pid = currentProcessId; if (!pid) return;
    mutateProcess(pid, '节点类型', (p) => ({ ...p, nodes: p.nodes.map((n) => (n.id === nid ? { ...n, type } : n)) }));
  }, [currentProcessId, mutateProcess]);

  /* ---------- 连线操作 ---------- */
  const createEdge = useCallback((source: ID, target: ID, sh?: Handle, th?: Handle) => {
    const pid = currentProcessId; if (!pid) return;
    if (source === target) return;
    const edge: Edge = { id: uid('e'), type: 'flow', source, target, sourceHandle: sh, targetHandle: th };
    mutateProcess(pid, '新增连线', (p) => ({ ...p, edges: [...p.edges, edge] }));
    setSelState({ kind: 'edge', id: edge.id, ids: [edge.id] });
  }, [currentProcessId, mutateProcess]);

  const deleteEdge = useCallback((eid: ID) => {
    const pid = currentProcessId; if (!pid) return;
    mutateProcess(pid, '删除连线', (p) => ({ ...p, edges: p.edges.filter((e) => e.id !== eid) }));
    setSelState({ kind: null, id: null, ids: [] });
  }, [currentProcessId, mutateProcess]);

  const setEdgeStyle = useCallback((eid: ID, style: EdgeStyle) => {
    const pid = currentProcessId; if (!pid) return;
    mutateProcess(pid, '连线样式', (p) => ({ ...p, edges: p.edges.map((e) => (e.id === eid ? { ...e, style: { ...(e.style ?? {}), ...style } } : e)) }));
  }, [currentProcessId, mutateProcess]);

  const setEdgeLabel = useCallback((eid: ID, label: string) => {
    const pid = currentProcessId; if (!pid) return;
    mutateProcess(pid, '连线标签', (p) => ({ ...p, edges: p.edges.map((e) => (e.id === eid ? { ...e, label: label || undefined } : e)) }));
  }, [currentProcessId, mutateProcess]);

  /* ---------- 自动布局（Batch，一条 Undo） ---------- */
  const autoLayout = useCallback(() => {
    const pid = currentProcessId; if (!pid) return;
    const proc = docRef.current.project.processes.find((p) => p.id === pid);
    if (!proc || !proc.nodes.length) return;
    const positions = layoutProcess(proc);
    const before = docRef.current;
    const after: DocState = {
      ...before,
      layouts: { ...before.layouts, [pid]: { ...(before.layouts[pid] ?? { positions: {}, viewport: { x: 0, y: 0, zoom: 1 }, locked: false, algorithm: 'hierarchical' as const }), positions, algorithm: 'hierarchical' } },
    };
    run(replaceCmd('自动布局', before, after));
    setFitSignal((n) => n + 1);
  }, [currentProcessId, run]);

  /* ---------- 作用域导航（不入 Undo） ---------- */
  const ensureLayout = useCallback((pid: ID) => {
    const st = docRef.current;
    if (st.layouts[pid]) return;
    const proc = st.project.processes.find((p) => p.id === pid);
    if (!proc || !proc.nodes.length) return;
    // 首次布局：写入后投影自动刷新（红线允许的"首次布局"）
    const after: DocState = {
      ...st,
      layouts: { ...st.layouts, [pid]: { positions: layoutProcess(proc), viewport: { x: 0, y: 0, zoom: 1 }, locked: false, algorithm: 'hierarchical' } },
    };
    setHist((h) => execute(h, replaceCmd('初始布局', st, after)));
  }, []);

  const enterScope = useCallback((processId: ID) => {
    ensureLayout(processId);
    setScopeStack((s) => [...s, { pageId: s[s.length - 1].pageId, processId }]);
    setSelState({ kind: null, id: null, ids: [] });
    setPreviewNodeId(null);
    setFitSignal((n) => n + 1);
  }, [ensureLayout]);

  const back = useCallback(() => {
    setScopeStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
    setSelState({ kind: null, id: null, ids: [] });
    setPreviewNodeId(null);
    setFitSignal((n) => n + 1);
  }, []);

  const gotoPage = useCallback((pageId: ID) => {
    const pg = docRef.current.project.pages.find((p) => p.id === pageId);
    if (!pg) return;
    if (pg.rootProcessId) ensureLayout(pg.rootProcessId);
    setScopeStack([{ pageId, processId: pg.rootProcessId }]);
    setSelState({ kind: null, id: null, ids: [] });
    setFitSignal((n) => n + 1);
  }, [ensureLayout]);

  const gotoProcess = useCallback((processId: ID) => {
    ensureLayout(processId);
    setScopeStack((s) => [{ pageId: s[s.length - 1].pageId, processId }]);
    setSelState({ kind: null, id: null, ids: [] });
    setFitSignal((n) => n + 1);
  }, [ensureLayout]);

  /* ---------- 页面 ---------- */
  const addPage = useCallback(() => {
    const before = docRef.current;
    const proc: Process = { id: uid('pr'), name: `流程 ${before.project.processes.length + 1}`, nodes: [], edges: [] };
    const pg: Page = { id: uid('pg'), name: `页面 ${before.project.pages.length + 1}`, type: 'flow', order: before.project.pages.length, rootProcessId: proc.id };
    const after: DocState = { ...before, project: { ...before.project, pages: [...before.project.pages, pg], processes: [...before.project.processes, proc] } };
    run(replaceCmd('新增页面', before, after));
    gotoPage(pg.id);
  }, [run, gotoPage]);

  const deletePage = useCallback((id: ID) => {
    const before = docRef.current;
    if (before.project.pages.length <= 1) return;
    const after: DocState = { ...before, project: { ...before.project, pages: before.project.pages.filter((p) => p.id !== id) } };
    run(replaceCmd('删除页面', before, after));
    setScopeStack((s) => [{ pageId: after.project.pages[0].id, processId: after.project.pages[0].rootProcessId }]);
  }, [run]);

  const renamePage = useCallback((id: ID, name: string) => {
    const before = docRef.current;
    const after: DocState = { ...before, project: { ...before.project, pages: before.project.pages.map((p) => (p.id === id ? { ...p, name } : p)) } };
    run(replaceCmd('重命名页面', before, after));
  }, [run]);

  /* ---------- 主题（同步 <html>，不入 Undo） ---------- */
  const setTheme = useCallback((t: ThemeMode) => {
    setThemeState(t);
    const el = document.documentElement;
    el.classList.toggle('dark', t === 'dark');
    el.classList.toggle('light', t !== 'dark');
    el.setAttribute('data-theme', t);
    el.style.colorScheme = t;
  }, []);
  useEffect(() => {
    const el = document.documentElement;
    const obs = new MutationObserver(() => {
      const t = readDomTheme();
      setThemeState((cur) => (cur === t ? cur : t));
    });
    obs.observe(el, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    return () => obs.disconnect();
  }, []);

  /* ---------- 自动保存（500ms 防抖） ---------- */
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify({ project: hist.present.project, layouts: hist.present.layouts }));
        setSavedAt(Date.now());
      } catch { /* ignore */ }
    }, 500);
    return () => clearTimeout(t);
  }, [hist.present]);

  /* ---------- Toast ---------- */
  const toast = useCallback((msg: string, type: Toast['type'] = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((ts) => [...ts, { id, msg, type }]);
    setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 2200);
  }, []);

  const requestFit = useCallback(() => setFitSignal((n) => n + 1), []);
  const setSel = useCallback((s: SelInput) => {
    setSelState({ kind: s.kind, id: s.id ?? null, ids: s.ids ?? (s.id ? [s.id] : []) });
  }, []);

  /* ---------- 阅读 / 编辑模式（视图态，不入 Undo） ---------- */
  const [mode, setMode] = useState<AppMode>('edit');
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const toggleMode = useCallback(() => {
    setMode((m) => {
      const next = m === 'edit' ? 'read' : 'edit';
      if (next === 'read') { setSelState({ kind: null, id: null, ids: [] }); setPreviewNodeId(null); }
      return next;
    });
  }, []);

  /* ---------- 鼠标位置追踪（P 键面板落点用） ---------- */
  const mouseRef = useRef<{ x: number; y: number }>({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  useEffect(() => {
    const onMove = (e: PointerEvent) => { mouseRef.current = { x: e.clientX, y: e.clientY }; };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, []);
  const screenToWorldRef = useRef<ScopeCtx['screenToWorldRef']['current']>(null);
  /** 按下 P 键瞬间的鼠标屏幕坐标（放置节点时使用，而非点击面板时的位置） */
  const paletteAnchorRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  /* ---------- P 键形状选择面板 ---------- */
  const [palette, setPalette] = useState<PaletteState>({ open: false, x: 0, y: 0, step: null });
  const openPalette = useCallback(() => {
    if (modeRef.current === 'read') { toast('阅读模式下不能添加节点', 'err'); return; }
    const m = mouseRef.current;
    paletteAnchorRef.current = { x: m.x, y: m.y };
    /* 防止面板溢出屏幕边缘 */
    const x = Math.min(m.x + 14, window.innerWidth - 260);
    const y = Math.min(m.y + 10, window.innerHeight - 380);
    setPalette({ open: true, x: Math.max(8, x), y: Math.max(8, y), step: null });
  }, [toast]);
  const closePalette = useCallback(() => setPalette((p) => ({ ...p, open: false, step: null })), []);
  const setPaletteStep = useCallback((s: PaletteState['step']) => setPalette((p) => ({ ...p, step: s })), []);

  /** 在按下 P 时的鼠标位置放置节点（世界坐标由画布注册的换算器求得） */
  const placeNode = useCallback((type: NodeType, opts?: { targetProcessId?: ID; functionId?: ID }) => {
    const pid = currentProcessId; if (!pid) return;
    const conv = screenToWorldRef.current;
    const m = paletteAnchorRef.current;
    const w = conv ? conv(m.x, m.y) : { x: 200, y: 200 };
    const d = NODE_DEFAULTS[type];
    const extra: Record<string, unknown> = {};
    if (type === 'call' && opts?.targetProcessId) {
      const tgt = docRef.current.project.processes.find((p) => p.id === opts.targetProcessId);
      Object.assign(extra, { targetProcessId: opts.targetProcessId, displayMode: 'collapsed', name: tgt?.name ?? '调用子流程' });
    }
    if (type === 'reference' && opts?.functionId) {
      const fn = docRef.current.project.functions.find((f) => f.id === opts.functionId);
      Object.assign(extra, { functionId: opts.functionId, name: fn?.name ?? '引用函数' });
    }
    const node = makeNode(type, 0, 0, extra as Partial<CallNode>);
    const before = docRef.current;
    const after: DocState = {
      project: { ...before.project, processes: before.project.processes.map((p) => (p.id === pid ? { ...p, nodes: [...p.nodes, node] } : p)) },
      layouts: {
        ...before.layouts,
        [pid]: {
          ...(before.layouts[pid] ?? { positions: {}, viewport: { x: 0, y: 0, zoom: 1 }, locked: false, algorithm: 'manual' as const }),
          positions: { ...(before.layouts[pid]?.positions ?? {}), [node.id]: { x: Math.round(w.x - d.w / 2), y: Math.round(w.y - d.h / 2) } },
        },
      },
    };
    run(replaceCmd('新增节点', before, after));
    setSelState({ kind: 'node', id: node.id, ids: [node.id] });
    setPalette({ open: false, x: 0, y: 0, step: null });
  }, [currentProcessId, run]);

  /* ---------- 全局调用图（Overview） ---------- */
  const [viewKind, setViewKindState] = useState<ViewKind>('flow');
  const setViewKind = useCallback((v: ViewKind) => {
    setViewKindState(v);
    if (v === 'callgraph') {
      /* 首次打开无布局 → 自动布局一次并写入（红线允许的"首次布局"） */
      const st = docRef.current;
      if (!st.layouts['__overview']) {
        const g = buildProjectCallGraph(st.project);
        const positions = g.nodes.length ? layoutCallGraph(g) : {};
        const after: DocState = {
          ...st,
          layouts: { ...st.layouts, __overview: { positions, viewport: { x: 0, y: 0, zoom: 1 }, locked: false, algorithm: 'hierarchical' } },
        };
        setHist((h) => execute(h, replaceCmd('全局视图布局', st, after)));
      }
      setFitSignal((n) => n + 1);
    }
    setSelState({ kind: null, id: null, ids: [] });
    setPreviewNodeId(null);
  }, []);
  const moveOverviewNode = useCallback((id: ID, to: Position) => {
    const before = docRef.current;
    const lay = before.layouts['__overview'] ?? { positions: {}, viewport: { x: 0, y: 0, zoom: 1 }, locked: false, algorithm: 'manual' as const };
    const after: DocState = {
      ...before,
      layouts: { ...before.layouts, __overview: { ...lay, positions: { ...lay.positions, [id]: { x: Math.round(to.x), y: Math.round(to.y) } } } },
    };
    run(replaceCmd('移动流程卡片', before, after, `move:__overview__:${id}`));
  }, [run]);

  /* ---------- 函数库 ---------- */
  const mutateProject = useCallback((label: string, fn: (p: Project) => Project) => {
    const before = docRef.current;
    run(replaceCmd(label, before, { ...before, project: fn(before.project) }));
  }, [run]);
  const addFunction = useCallback(() => {
    const n = docRef.current.project.functions.length + 1;
    const f: FnDef = { id: uid('fn'), name: `新函数 ${n}`, type: 'shared' };
    mutateProject('新增函数', (p) => ({ ...p, functions: [...p.functions, f] }));
    toast(`已创建「${f.name}」，可在流程图 P 面板中引用`);
  }, [mutateProject, toast]);
  const renameFunction = useCallback((id: ID, name: string) => {
    mutateProject('重命名函数', (p) => ({ ...p, functions: p.functions.map((f) => (f.id === id ? { ...f, name } : f)) }));
  }, [mutateProject]);
  const deleteFunction = useCallback((id: ID) => {
    const refs = calledBy(docRef.current.project, id);
    if (refs.length) { toast(`该函数被 ${refs.length} 处引用，无法删除`, 'err'); return; }
    mutateProject('删除函数', (p) => ({ ...p, functions: p.functions.filter((f) => f.id !== id) }));
  }, [mutateProject, toast]);

  const value: ScopeCtx = {
    project, layouts, scope, scopeStack, page, currentProcess, projection,
    canUndo: hist.past.length > 0, canRedo: hist.future.length > 0, undo, redo,
    addNode, deleteSel, renameNode, moveNode, setNodeColor, setNodeType,
    createEdge, deleteEdge, setEdgeStyle, setEdgeLabel, autoLayout,
    enterScope, back, canBack: scopeStack.length > 1,
    gotoPage, gotoProcess,
    sel, setSel, tool, setTool, theme, setTheme,
    previewNodeId, setPreviewNodeId, toasts, toast,
    addPage, deletePage, renamePage,
    fitSignal, requestFit, savedAt, exportHandle,
    mode, toggleMode,
    palette, openPalette, closePalette, setPaletteStep, placeNode, screenToWorldRef,
    viewKind, setViewKind, moveOverviewNode,
    addFunction, renameFunction, deleteFunction,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export { serializeProject };
