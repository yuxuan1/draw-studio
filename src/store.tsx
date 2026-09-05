/* ============================================================
 * store —— 全局状态：文档 / 历史 / 页面 / 选择 / 工具 / 主题同步 / 自动保存
 * 主题修复核心：
 *  1) 主题真实来源是 <html> 上的 .dark 类（由环境 bootstrap 或应用内切换设置）；
 *  2) MutationObserver 监听 <html> class 变化，环境切换主题时同步 React 状态；
 *  3) 应用内切换主题时同步写回 <html>，CSS 变量与画布颜色一并响应。
 * ============================================================ */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Page, PageType, ProjectSettings, StudioDoc, ThemeMode, WbShape } from './lib/core';
import { defaultDoc, uid } from './lib/core';
import { loadStudio, saveStudio } from './lib/studio';

export interface Sel { kind: null | 'state' | 'transition' | 'flow' | 'flowEdge' | 'wb'; id: string | null; ids: string[] }
export type SelInput = { kind: Sel['kind']; id?: string | null; ids?: string[] };
export type Tool =
  | 'select'
  | 'sm-state' | 'sm-terminal' | 'sm-junction'
  | 'flow-start' | 'flow-process' | 'flow-decision' | 'flow-io' | 'flow-subprocess'
  | 'wb-rect' | 'wb-ellipse' | 'wb-arrow' | 'wb-line' | 'wb-text';

interface Toast { id: number; msg: string; type: 'ok' | 'err' }

function useHistory<T>(initial: T) {
  const [st, setSt] = useState({ past: [] as T[], present: initial, future: [] as T[] });
  const batch = useRef<T | null>(null);
  const set = useCallback((next: T, commit = true) => {
    setSt((s) => (commit ? { past: [...s.past.slice(-99), s.present], present: next, future: [] } : { ...s, present: next }));
  }, []);
  const beginBatch = useCallback(() => { setSt((s) => { batch.current = s.present; return s; }); }, []);
  const endBatch = useCallback(() => {
    const snap = batch.current; batch.current = null;
    if (snap !== null) setSt((s) => ({ past: [...s.past.slice(-99), snap], present: s.present, future: [] }));
  }, []);
  const undo = useCallback(() => setSt((s) => (s.past.length ? { past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future] } : s)), []);
  const redo = useCallback(() => setSt((s) => (s.future.length ? { past: [...s.past, s.present], present: s.future[0], future: s.future.slice(1) } : s)), []);
  return { value: st.present, set, beginBatch, endBatch, undo, redo, canUndo: st.past.length > 0, canRedo: st.future.length > 0 };
}

/** 从 <html> 读取当前主题（环境 bootstrap 已先行设置） */
function readDomTheme(): ThemeMode {
  const el = document.documentElement;
  if (el.classList.contains('dark') || el.getAttribute('data-theme') === 'dark') return 'dark';
  return 'light';
}

interface StudioCtx {
  doc: StudioDoc; page: Page;
  set: (d: StudioDoc, commit?: boolean) => void;
  updatePage: (fn: (p: Page) => Page, commit?: boolean) => void;
  sel: Sel; setSel: (s: SelInput) => void; deleteSel: () => void;
  tool: Tool; setTool: (t: Tool) => void;
  canUndo: boolean; canRedo: boolean; undo: () => void; redo: () => void;
  beginBatch: () => void; endBatch: () => void;
  theme: ThemeMode; setTheme: (t: ThemeMode) => void;
  fitSignal: number; requestFit: () => void;
  toasts: Toast[]; toast: (msg: string, type?: Toast['type']) => void;
  savedAt: number;
  addPage: (type: PageType) => void; deletePage: (id: string) => void; setActivePage: (id: string) => void;
  renamePageSafe: (id: string, name: string) => void;
  exportHandle: { current: null | ((bg: 'white' | 'transparent' | 'theme') => { svg: string; w: number; h: number } | null) };
}
const Ctx = createContext<StudioCtx | null>(null);
export function useStudio(): StudioCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStudio outside provider');
  return v;
}

export function StudioProvider({ children }: { children: ReactNode }) {
  const [initial] = useState(() => {
    const domTheme = readDomTheme();
    const doc = loadStudio(domTheme);
    // 让文档主题与 DOM 初始主题一致
    return { ...doc, settings: { ...doc.settings, theme: domTheme } };
  });
  const hist = useHistory<StudioDoc>(initial);
  const doc = hist.value;
  const docRef = useRef(doc); docRef.current = doc;

  const page = useMemo(
    () => doc.pages.find((p) => p.id === doc.activePageId) ?? doc.pages[0],
    [doc],
  );

  const [sel, _setSel] = useState<Sel>({ kind: null, id: null, ids: [] });
  const setSel = useCallback((s: SelInput) => {
    const id = s.id ?? (s.ids && s.ids.length ? s.ids[0] : null);
    const ids = s.ids ?? (id ? [id] : []);
    _setSel({ kind: ids.length ? s.kind : null, id: ids.length ? id : null, ids });
  }, []);
  const [tool, setTool] = useState<Tool>('select');
  const [fitSignal, setFitSignal] = useState(0);
  const requestFit = useCallback(() => setFitSignal((n) => n + 1), []);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);
  const toast = useCallback((msg: string, type: Toast['type'] = 'ok') => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-3), { id, msg, type }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2200);
  }, []);
  const [savedAt, setSavedAt] = useState(0);

  /* ---------- 主题：与 <html> 双向同步 ---------- */
  const theme: ThemeMode = doc.settings.theme;
  const suppressObserver = useRef(false);

  const applyThemeToDom = useCallback((t: ThemeMode) => {
    suppressObserver.current = true;
    const el = document.documentElement;
    el.classList.remove('light', 'dark');
    el.classList.add(t);
    el.setAttribute('data-theme', t);
    el.style.colorScheme = t;
    // 下一个 tick 再恢复监听，避免自己的写入触发回环
    window.setTimeout(() => { suppressObserver.current = false; }, 0);
  }, []);

  const setTheme = useCallback((t: ThemeMode) => {
    applyThemeToDom(t);
    hist.set({ ...docRef.current, settings: { ...docRef.current.settings, theme: t } }, false);
  }, [applyThemeToDom, hist]);

  // 初始挂载：把文档主题应用到 DOM（确保一致）
  useEffect(() => { applyThemeToDom(docRef.current.settings.theme); }, [applyThemeToDom]);

  // 监听环境（postMessage bootstrap）对 <html> class 的修改 → 同步 React 状态
  useEffect(() => {
    const el = document.documentElement;
    const sync = () => {
      if (suppressObserver.current) return;
      const t = readDomTheme();
      if (t !== docRef.current.settings.theme) {
        hist.set({ ...docRef.current, settings: { ...docRef.current.settings, theme: t } }, false);
      }
    };
    const mo = new MutationObserver(sync);
    mo.observe(el, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    const onMsg = (e: MessageEvent) => {
      const t = (e.data && typeof e.data === 'object') ? (e.data.theme as ThemeMode | undefined) : undefined;
      if (t === 'light' || t === 'dark') window.setTimeout(sync, 0);
    };
    window.addEventListener('message', onMsg);
    return () => { mo.disconnect(); window.removeEventListener('message', onMsg); };
  }, [hist]);

  /* ---------- 自动保存（500ms 防抖） ---------- */
  const saveTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => { saveStudio(doc); setSavedAt(Date.now()); }, 500);
    return () => window.clearTimeout(saveTimer.current);
  }, [doc]);

  const updatePage = useCallback((fn: (p: Page) => Page, commit = true) => {
    const d = docRef.current;
    hist.set({ ...d, pages: d.pages.map((p) => (p.id === d.activePageId ? fn(p) : p)) }, commit);
  }, [hist]);

  const deleteSel = useCallback(() => {
    const s = sel; if (!s.ids.length) return;
    const d = docRef.current; const p = d.pages.find((x) => x.id === d.activePageId); if (!p) return;
    const ids = new Set(s.ids);
    let next: Page = p;
    if (s.kind === 'state') {
      next = { ...p, states: p.states.filter((x) => !ids.has(x.id)), transitions: p.transitions.filter((t) => !ids.has(t.source) && !ids.has(t.target)) };
    } else if (s.kind === 'transition') {
      next = { ...p, transitions: p.transitions.filter((x) => !ids.has(x.id)) };
    } else if (s.kind === 'wb') {
      next = { ...p, wbShapes: p.wbShapes.filter((x) => !ids.has(x.id)) };
    } else if (s.kind === 'flow' || s.kind === 'flowEdge') {
      const strip = (ns: typeof p.flowNodes, es: typeof p.flowEdges): { nodes: typeof p.flowNodes; edges: typeof p.flowEdges } => ({
        nodes: ns.filter((n) => !ids.has(n.id)).map((n) => (n.inner ? { ...n, inner: strip(n.inner.nodes, n.inner.edges) } : n)),
        edges: es.filter((e) => !ids.has(e.id) && !ids.has(e.source) && !ids.has(e.target)),
      });
      const r = strip(p.flowNodes, p.flowEdges);
      next = { ...p, flowNodes: r.nodes, flowEdges: r.edges };
    }
    hist.set({ ...d, pages: d.pages.map((x) => (x.id === p.id ? next : x)) });
    setSel({ kind: null });
  }, [sel, hist, setSel]);

  const addPage = useCallback((type: PageType) => {
    const d = docRef.current;
    const count = d.pages.filter((p) => p.type === type).length;
    const p = { ...defaultPageStub(type), name: type === 'canvas' ? `画布 ${count + 1}` : `白板 ${count + 1}` };
    hist.set({ ...d, pages: [...d.pages, p], activePageId: p.id });
    setSel({ kind: null }); requestFit();
    toast(`已新建${type === 'canvas' ? '画布' : '白板'}页`);
  }, [hist, requestFit, toast]);

  const deletePage = useCallback((id: string) => {
    const d = docRef.current;
    if (d.pages.length <= 1) { toast('至少保留一个页面', 'err'); return; }
    const pages = d.pages.filter((p) => p.id !== id);
    hist.set({ ...d, pages, activePageId: d.activePageId === id ? pages[0].id : d.activePageId });
    setSel({ kind: null });
  }, [hist, setSel, toast]);

  const setActivePage = useCallback((id: string) => {
    hist.set({ ...docRef.current, activePageId: id }, false);
    setSel({ kind: null }); requestFit();
  }, [hist, setSel, requestFit]);

  const renamePageSafe = useCallback((id: string, name: string) => {
    const n = name.trim(); if (!n) return;
    hist.set({ ...docRef.current, pages: docRef.current.pages.map((p) => (p.id === id ? { ...p, name: n } : p)) }, false);
  }, [hist]);

  /* ---------- 全局快捷键 ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement;
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT' || tgt.isContentEditable)) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z' && !e.shiftKey) { e.preventDefault(); hist.undo(); }
      else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); hist.redo(); }
      else if (k === 'f') { e.preventDefault(); requestFit(); }
      else if (k === 'v') { setTool('select'); }
      else if (k === 'delete' || k === 'backspace') { e.preventDefault(); deleteSel(); }
      else if (k === 'escape') { setSel({ kind: null }); setTool('select'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hist, requestFit, deleteSel, setSel]);

  const exportHandle = useRef<StudioCtx['exportHandle']['current']>(null);

  const value = useMemo<StudioCtx>(() => ({
    doc, page,
    set: hist.set, updatePage,
    sel, setSel, deleteSel,
    tool, setTool,
    canUndo: hist.canUndo, canRedo: hist.canRedo, undo: hist.undo, redo: hist.redo,
    beginBatch: hist.beginBatch, endBatch: hist.endBatch,
    theme, setTheme,
    fitSignal, requestFit,
    toasts, toast, savedAt,
    addPage, deletePage, setActivePage, renamePageSafe,
    exportHandle,
  }), [doc, page, hist, updatePage, sel, setSel, deleteSel, tool, theme, setTheme, fitSignal, requestFit, toasts, toast, savedAt, addPage, deletePage, setActivePage, renamePageSafe]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function defaultPageStub(type: PageType): Page {
  return { id: uid('p'), type, name: '', states: [], transitions: [], flowNodes: [], flowEdges: [], flowDir: 'TB', wbShapes: [] };
}

export type { WbShape };
