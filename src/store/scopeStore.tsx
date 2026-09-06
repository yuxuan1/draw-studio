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
  defaultProject, uid, projectProcess, layoutProcess, NODE_DEFAULTS, makeNode,
  serializeProject, deserializeProject,
} from '../lib/domain';
import type { Command } from '../lib/command';
import { createHistory, execute, undo as hUndo, redo as hRedo, replaceCmd, batchCmd } from '../lib/command';

export interface Sel { kind: null | 'node' | 'edge'; id: ID | null; ids: ID[] }
export type SelInput = { kind: Sel['kind']; id?: ID | null; ids?: ID[] };
export type Tool = 'select' | NodeType;
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
  currentProcess: Process | null; projection: Projection;
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

  const value: ScopeCtx = {
    project, layouts, scope, scopeStack, currentProcess, projection,
    canUndo: hist.past.length > 0, canRedo: hist.future.length > 0, undo, redo,
    addNode, deleteSel, renameNode, moveNode, setNodeColor, setNodeType,
    createEdge, deleteEdge, setEdgeStyle, setEdgeLabel, autoLayout,
    enterScope, back, canBack: scopeStack.length > 1,
    gotoPage, gotoProcess,
    sel, setSel, tool, setTool, theme, setTheme,
    previewNodeId, setPreviewNodeId, toasts, toast,
    addPage, deletePage, renamePage,
    fitSignal, requestFit, savedAt, exportHandle,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export { serializeProject };
