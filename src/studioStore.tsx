/* ============================================================
 * 统一画布全局状态：文档 + 历史 + 选择 + 工具 + 视图 + Toast
 * ============================================================ */
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import type { ReactNode } from 'react';
import { useHistory } from './lib/boardkit';
import type { StudioDoc } from './lib/studio';
import { loadStudio, saveStudio } from './lib/studio';

export type SelKind = 'state' | 'transition' | 'flow' | 'wb' | null;
export interface Sel { kind: SelKind; id: string | null }

export type Tool =
  | 'select'
  | 'sm-state' | 'sm-terminal' | 'sm-junction'
  | 'flow-rect' | 'flow-diamond' | 'flow-stadium' | 'flow-io'
  | 'wb-rect' | 'wb-ellipse' | 'wb-arrow' | 'wb-line' | 'wb-text';

export interface Toast { id: number; msg: string; type: 'ok' | 'err' | 'info' }

interface StudioCtx {
  doc: StudioDoc;
  set: (d: StudioDoc, commit?: boolean) => void;
  beginBatch: () => void;
  endBatch: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  sel: Sel;
  setSel: (s: Sel) => void;
  tool: Tool;
  setTool: (t: Tool) => void;
  fitSignal: number;
  requestFit: () => void;
  toasts: Toast[];
  toast: (msg: string, type?: Toast['type']) => void;
  theme: 'light' | 'dark';
  savedAt: number;
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

  const toast = useCallback((msg: string, type: Toast['type'] = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, msg, type }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2200);
  }, []);

  const requestFit = useCallback(() => setFitSignal((n) => n + 1), []);

  /* 自动保存（600ms 防抖） */
  useEffect(() => {
    const t = window.setTimeout(() => {
      saveStudio(docRef.current);
      setSavedAt(Date.now());
    }, 600);
    return () => window.clearTimeout(t);
  }, [hist.value]);

  /* 主题应用到 <html> */
  const theme = hist.value.settings.theme;
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  /* 全局快捷键（输入框聚焦时不触发） */
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
      else if (k === 'escape') { setSel({ kind: null, id: null }); setTool('select'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hist.undo, hist.redo, requestFit]);

  const value = useMemo<StudioCtx>(() => ({
    doc: hist.value,
    set: hist.set,
    beginBatch: hist.beginBatch,
    endBatch: hist.endBatch,
    undo: hist.undo,
    redo: hist.redo,
    canUndo: hist.canUndo,
    canRedo: hist.canRedo,
    sel, setSel, tool, setTool,
    fitSignal, requestFit,
    toasts, toast,
    theme, savedAt,
    exportHandle,
  }), [hist, sel, tool, fitSignal, toasts, toast, theme, savedAt, requestFit]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
