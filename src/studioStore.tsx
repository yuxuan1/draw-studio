/* ============================================================
 * 全局状态：多页面文档 + 历史 + 选择 + 工具 + Toast + 自动保存
 * ============================================================ */
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import type { ReactNode } from 'react';
import { useHistory } from './lib/boardkit';
import type { Page, PageType, StudioDoc } from './lib/studio';
import { loadStudio, makePage, pruneFlow, saveStudio } from './lib/studio';

export type SelKind = 'state' | 'transition' | 'flow' | 'flowEdge' | 'wb' | null;
export interface Sel { kind: SelKind; id: string | null }

export type Tool =
  | 'select'
  | 'sm-state' | 'sm-terminal' | 'sm-junction'
  | 'flow-start' | 'flow-process' | 'flow-decision' | 'flow-io' | 'flow-subprocess'
  | 'wb-rect' | 'wb-ellipse' | 'wb-arrow' | 'wb-line' | 'wb-text';

export interface Toast { id: number; msg: string; type: 'ok' | 'err' | 'info' }

interface StudioCtx {
  doc: StudioDoc;
  page: Page;
  set: (d: StudioDoc, commit?: boolean) => void;
  updatePage: (fn: (p: Page) => Page, commit?: boolean) => void;
  beginBatch: () => void;
  endBatch: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  sel: Sel;
  setSel: (s: Sel) => void;
  deleteSel: () => void;
  tool: Tool;
  setTool: (t: Tool) => void;
  fitSignal: number;
  requestFit: () => void;
  toasts: Toast[];
  toast: (msg: string, type?: Toast['type']) => void;
  theme: 'light' | 'dark';
  savedAt: number;
  /* 页面操作 */
  addPage: (type: PageType) => void;
  renamePage: (id: string, name: string) => void;
  deletePage: (id: string) => void;
  setActivePage: (id: string) => void;
  /** 画布注册的导出函数：返回自包含 SVG（1× 尺寸）+ 内容宽高 */
  exportHandle: { current: null | ((bg: 'white' | 'transparent' | 'theme') => { svg: string; w: number; h: number } | null) };
}

const Ctx = createContext<StudioCtx | null>(null);
export function useStudio(): StudioCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStudio outside provider');
  return v;
}

export function StudioProvider({ children }: { children: ReactNode }) {
  const [initialDoc] = useState(() => loadStudio());
  const hist = useHistory<StudioDoc>(initialDoc);
  const docRef = useRef(hist.value);
  docRef.current = hist.value;

  const [sel, setSel] = useState<Sel>({ kind: null, id: null });
  const [tool, setTool] = useState<Tool>('select');
  const [fitSignal, setFitSignal] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [savedAt, setSavedAt] = useState(0);
  const exportHandle = useRef<StudioCtx['exportHandle']['current']>(null);

  const doc = hist.value;
  const page = useMemo(
    () => doc.pages.find((p) => p.id === doc.activePageId) ?? doc.pages[0],
    [doc],
  );

  const toast = useCallback((msg: string, type: Toast['type'] = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, msg, type }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2200);
  }, []);

  const requestFit = useCallback(() => setFitSignal((n) => n + 1), []);

  /* ---------- 页面操作 ---------- */
  const updatePage = useCallback((fn: (p: Page) => Page, commit = true) => {
    const d = docRef.current;
    hist.set({ ...d, pages: d.pages.map((p) => (p.id === d.activePageId ? fn(p) : p)) }, commit);
  }, [hist]);

  const addPage = useCallback((type: PageType) => {
    const d = docRef.current;
    const count = d.pages.filter((p) => p.type === type).length + 1;
    const p = makePage(type, type === 'canvas' ? `画布 ${count}` : `白板 ${count}`);
    hist.set({ ...d, pages: [...d.pages, p], activePageId: p.id });
    setSel({ kind: null, id: null });
    setFitSignal((n) => n + 1);
    toast(`已新建${type === 'canvas' ? '画布' : '白板'}页「${p.name}」`);
  }, [hist, toast]);

  const renamePage = useCallback((id: string, name: string) => {
    const d = docRef.current;
    const nm = name.trim();
    if (!nm) return;
    hist.set({ ...d, pages: d.pages.map((p) => (p.id === id ? { ...p, name: nm } : p)) });
  }, [hist]);

  const deletePage = useCallback((id: string) => {
    const d = docRef.current;
    if (d.pages.length <= 1) { toast('至少保留一个页面', 'err'); return; }
    const pages = d.pages.filter((p) => p.id !== id);
    const activePageId = d.activePageId === id ? pages[0].id : d.activePageId;
    hist.set({ ...d, pages, activePageId });
    setSel({ kind: null, id: null });
    setFitSignal((n) => n + 1);
    toast('页面已删除');
  }, [hist, toast]);

  const setActivePage = useCallback((id: string) => {
    const d = docRef.current;
    if (d.activePageId === id) return;
    hist.set({ ...d, activePageId: id }, false);
    setSel({ kind: null, id: null });
    setTool('select');
    setFitSignal((n) => n + 1);
  }, [hist]);

  /* ---------- 删除选中（级联 / 递归） ---------- */
  const deleteSel = useCallback(() => {
    const s = sel;
    if (!s.id) return;
    const d = docRef.current;
    const p = d.pages.find((x) => x.id === d.activePageId);
    if (!p) return;
    let next: Page = p;
    if (s.kind === 'state') {
      next = {
        ...p,
        states: p.states.filter((x) => x.id !== s.id),
        transitions: p.transitions.filter((t) => t.source !== s.id && t.target !== s.id),
      };
    } else if (s.kind === 'transition') {
      next = { ...p, transitions: p.transitions.filter((t) => t.id !== s.id) };
    } else if (s.kind === 'flow') {
      const r = pruneFlow(p.flowNodes, p.flowEdges, s.id);
      next = { ...p, flowNodes: r.nodes, flowEdges: r.edges };
    } else if (s.kind === 'flowEdge') {
      const r = pruneFlow(p.flowNodes, p.flowEdges, s.id);
      next = { ...p, flowNodes: r.nodes, flowEdges: r.edges };
    } else if (s.kind === 'wb') {
      next = { ...p, wbShapes: p.wbShapes.filter((w) => w.id !== s.id) };
    }
    hist.set({ ...d, pages: d.pages.map((x) => (x.id === p.id ? next : x)) });
    setSel({ kind: null, id: null });
  }, [sel, hist]);

  /* ---------- 自动保存（600ms 防抖） ---------- */
  useEffect(() => {
    const t = window.setTimeout(() => {
      saveStudio(docRef.current);
      setSavedAt(Date.now());
    }, 600);
    return () => window.clearTimeout(t);
  }, [hist.value]);

  /* ---------- 主题应用到 <html> ---------- */
  const theme = hist.value.settings.theme;
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  /* ---------- 全局快捷键（输入框聚焦时不触发） ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.closest('input,textarea,select') || t.isContentEditable)) {
        if (e.key === 'Escape') (t as HTMLElement).blur?.();
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) hist.redo(); else hist.undo(); }
      else if (mod && k === 'y') { e.preventDefault(); hist.redo(); }
      else if (k === 'f') { e.preventDefault(); requestFit(); }
      else if (k === 'v') { setTool('select'); }
      else if (k === 'delete' || k === 'backspace') { e.preventDefault(); deleteSel(); }
      else if (k === 'escape') { setSel({ kind: null, id: null }); setTool('select'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hist.undo, hist.redo, requestFit, deleteSel]);

  const value = useMemo<StudioCtx>(() => ({
    doc, page,
    set: hist.set, updatePage,
    beginBatch: hist.beginBatch, endBatch: hist.endBatch,
    undo: hist.undo, redo: hist.redo,
    canUndo: hist.canUndo, canRedo: hist.canRedo,
    sel, setSel, deleteSel,
    tool, setTool,
    fitSignal, requestFit,
    toasts, toast,
    theme, savedAt,
    addPage, renamePage, deletePage, setActivePage,
    exportHandle,
  }), [doc, page, hist, updatePage, sel, deleteSel, tool, fitSignal, toasts, toast, theme, savedAt, addPage, renamePage, deletePage, setActivePage, requestFit]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
