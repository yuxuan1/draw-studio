/* ============================================================
 * 全局状态：工程文档 + 历史栈（撤销/重做）+ 自动保存 + 选择/视图
 * FR-6.x：数据操作进历史（上限 100），视图状态不进历史
 * ============================================================ */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  ProjectDoc, ProjectState, ProjectTransition, ProjectSettings,
  PaletteColor, LayoutKind, LabelParts,
} from './lib/core';
import {
  defaultDoc, defaultSettings, normalizeDoc, ensureStartNode, uid, START_ID,
  nextStateName, parseLabel, parseBulkTransitions, sanitizeFilename, cloneDoc,
  SAMPLES, COLOR_ORDER, GRID_SNAP, nodeSize,
} from './lib/core';
import { shapesOf, docBounds } from './lib/geometry';
import type { NodeShape } from './lib/geometry';
import { runLayout } from './lib/layout';

const STORAGE_KEY = 'stateflow-studio.project.v1';
const HISTORY_LIMIT = 100;

export interface Selection { states: string[]; transitions: string[] }
export interface ViewTransform { x: number; y: number; k: number }
export interface Toast { id: number; msg: string; type: 'ok' | 'err' | 'info' }
export type ModalKind = null | 'export' | 'help';

interface AppContextValue {
  doc: ProjectDoc;
  canUndo: boolean;
  canRedo: boolean;
  sel: Selection;
  view: ViewTransform;
  fitSignal: number;
  toasts: Toast[];
  modal: ModalKind;
  helpTab: string;
  renamingId: string | null;
  savedAt: number;
  focusReq: { id: string; n: number } | null;

  setView: (v: ViewTransform) => void;
  requestFit: () => void;
  setModal: (m: ModalKind) => void;
  setHelpTab: (t: string) => void;
  setRenamingId: (id: string | null) => void;
  setSel: (s: Selection) => void;
  toast: (msg: string, type?: Toast['type']) => void;

  undo: () => void;
  redo: () => void;
  commit: (next: ProjectDoc) => void;
  live: (next: ProjectDoc) => void;
  beginGesture: () => void;
  endGesture: () => void;

  renameProject: (name: string) => void;
  addState: (name?: string, pos?: { x: number; y: number }) => string;
  addStatesBulk: (names: string[]) => number;
  updateState: (id: string, patch: Partial<ProjectState>) => void;
  deleteStates: (ids: string[]) => void;
  setStatesColor: (ids: string[], color: PaletteColor) => void;
  alignStates: (ids: string[], mode: string) => void;
  distributeStates: (ids: string[], dir: 'h' | 'v') => void;

  addTransition: (source: string, target: string, label: string) => string;
  updateTransition: (id: string, patch: Partial<ProjectTransition> & { label?: string }) => void;
  updateTransitionsBulk: (ids: string[], patch: Partial<ProjectTransition>) => void;
  deleteTransitions: (ids: string[]) => void;

  applyLayout: (kind: LayoutKind) => void;
  updateSettings: (patch: Partial<ProjectSettings>) => void;
  setViewSettings: (patch: Partial<ProjectSettings>) => void;

  focusOn: (id: string) => void;
  importBulkTransitions: (text: string) => void;
  newProject: () => void;
  importRaw: (raw: unknown, viaOpen?: boolean) => boolean;
  loadSample: (i: number) => void;
  saveProjectFile: () => void;
  deleteSelection: () => void;
}

const AppCtx = createContext<AppContextValue>(null!);
export const useApp = () => useContext(AppCtx);

function loadInitial(): ProjectDoc {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalizeDoc(JSON.parse(raw));
  } catch { /* 损坏时回退示例 */ }
  return cloneDoc(SAMPLES[0]);
}

let toastSeq = 0;

export function AppProvider({ children }: { children: ReactNode }) {
  const [doc, setDoc] = useState<ProjectDoc>(loadInitial);
  const docRef = useRef(doc);
  docRef.current = doc;

  const [, bumpHist] = useState(0);
  const past = useRef<ProjectDoc[]>([]);
  const future = useRef<ProjectDoc[]>([]);
  const gestureSnap = useRef<ProjectDoc | null>(null);

  const [sel, setSel] = useState<Selection>({ states: [], transitions: [] });
  const [view, setView] = useState<ViewTransform>({ x: 60, y: 40, k: 1 });
  const [fitSignal, setFitSignal] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [modal, setModal] = useState<ModalKind>(null);
  const [helpTab, setHelpTab] = useState('keys');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState(0);
  const [focusReq, setFocusReq] = useState<{ id: string; n: number } | null>(null);
  const focusOn = useCallback((id: string) => {
    setFocusReq((f) => ({ id, n: (f?.n ?? 0) + 1 }));
  }, []);

  /* ---------- 自动保存（500ms 防抖） ---------- */
  const saveTimer = useRef<number | undefined>(undefined);
  const scheduleSave = useCallback(() => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(docRef.current));
        setSavedAt(Date.now());
      } catch { /* 存储满时静默 */ }
    }, 500);
  }, []);

  /* ---------- 历史栈 ---------- */
  const commit = useCallback((next: ProjectDoc) => {
    past.current = [...past.current.slice(-(HISTORY_LIMIT - 1)), docRef.current];
    future.current = [];
    setDoc(next);
    scheduleSave();
    bumpHist((x) => x + 1);
  }, [scheduleSave]);

  const live = useCallback((next: ProjectDoc) => setDoc(next), []);

  const beginGesture = useCallback(() => { gestureSnap.current = docRef.current; }, []);
  const endGesture = useCallback(() => {
    const snap = gestureSnap.current;
    gestureSnap.current = null;
    if (snap && snap !== docRef.current) {
      past.current = [...past.current.slice(-(HISTORY_LIMIT - 1)), snap];
      future.current = [];
      scheduleSave();
      bumpHist((x) => x + 1);
    }
  }, [scheduleSave]);

  const undo = useCallback(() => {
    if (!past.current.length) return;
    const prev = past.current[past.current.length - 1];
    past.current = past.current.slice(0, -1);
    future.current = [...future.current, docRef.current];
    setDoc(prev);
    scheduleSave();
    bumpHist((x) => x + 1);
  }, [scheduleSave]);

  const redo = useCallback(() => {
    if (!future.current.length) return;
    const next = future.current[future.current.length - 1];
    future.current = future.current.slice(0, -1);
    past.current = [...past.current, docRef.current];
    setDoc(next);
    scheduleSave();
    bumpHist((x) => x + 1);
  }, [scheduleSave]);

  /* ---------- toast ---------- */
  const toast = useCallback((msg: string, type: Toast['type'] = 'ok') => {
    const id = ++toastSeq;
    setToasts((ts) => [...ts.slice(-3), { id, msg, type }]);
    window.setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 2200);
  }, []);

  const requestFit = useCallback(() => setFitSignal((x) => x + 1), []);

  /* ---------- 状态操作 ---------- */
  const addState = useCallback((name?: string, pos?: { x: number; y: number }): string => {
    const d = docRef.current;
    const nm = (name ?? '').trim() || nextStateName(d);
    let position = pos;
    if (!position) {
      const normals = d.states.filter((s) => s.kind !== 'start');
      const last = normals[normals.length - 1];
      position = last
        ? { x: last.position.x + 60, y: last.position.y + 60 }
        : { x: 160, y: 140 };
      if (d.settings.snapToGrid) {
        position = {
          x: Math.round(position.x / GRID_SNAP) * GRID_SNAP,
          y: Math.round(position.y / GRID_SNAP) * GRID_SNAP,
        };
      }
    }
    const st: ProjectState = {
      id: uid('s'), name: nm, kind: 'state',
      color: COLOR_ORDER[d.states.filter((s) => s.kind !== 'start').length % COLOR_ORDER.length],
      position,
    };
    let transitions = d.transitions;
    const firstNormal = !d.states.some((s) => s.kind === 'state');
    if (firstNormal) {
      transitions = [...transitions, { id: uid('t'), source: START_ID, target: st.id, enabled: true }];
    }
    commit(ensureStartNode({ ...d, states: [...d.states, st], transitions }));
    setSel({ states: [st.id], transitions: [] });
    return st.id;
  }, [commit]);

  const addStatesBulk = useCallback((names: string[]): number => {
    const d = docRef.current;
    const bounds = docBounds(d, d.settings);
    const clean = names.map((n) => n.trim()).filter(Boolean);
    if (!clean.length) return 0;
    const cols = Math.max(1, Math.ceil(Math.sqrt(clean.length)));
    const hadNormal = d.states.some((s) => s.kind === 'state');
    const added: ProjectState[] = clean.map((nm, i) => ({
      id: uid('s'), name: nm, kind: 'state' as const,
      color: COLOR_ORDER[(d.states.length + i) % COLOR_ORDER.length],
      position: {
        x: bounds.x + 40 + (i % cols) * 230,
        y: bounds.y + bounds.h + 100 + Math.floor(i / cols) * 130,
      },
    }));
    let transitions = d.transitions;
    if (!hadNormal && added.length) {
      transitions = [...transitions, { id: uid('t'), source: START_ID, target: added[0].id, enabled: true }];
    }
    commit(ensureStartNode({ ...d, states: [...d.states, ...added], transitions }));
    setSel({ states: added.map((a) => a.id), transitions: [] });
    requestFit();
    return added.length;
  }, [commit, requestFit]);

  const updateState = useCallback((id: string, patch: Partial<ProjectState>) => {
    const d = docRef.current;
    if (id === START_ID && (patch.name !== undefined || patch.kind !== undefined)) return;
    commit({
      ...d,
      states: d.states.map((s) => (s.id === id ? { ...s, ...patch, id } : s)),
    });
  }, [commit]);

  const deleteStates = useCallback((ids: string[]) => {
    const d = docRef.current;
    const doomed = new Set(ids.filter((id) => id !== START_ID));
    if (!doomed.size) return;
    const next = ensureStartNode({
      ...d,
      states: d.states.filter((s) => !doomed.has(s.id)),
      transitions: d.transitions.filter((t) => !doomed.has(t.source) && !doomed.has(t.target)),
    });
    commit(next);
    setSel((s) => ({
      states: s.states.filter((x) => !doomed.has(x)),
      transitions: s.transitions.filter((tid) =>
        next.transitions.some((t) => t.id === tid)),
    }));
  }, [commit]);

  const setStatesColor = useCallback((ids: string[], color: PaletteColor) => {
    const d = docRef.current;
    const set = new Set(ids);
    commit({ ...d, states: d.states.map((s) => (set.has(s.id) ? { ...s, color } : s)) });
  }, [commit]);

  const alignStates = useCallback((ids: string[], mode: string) => {
    const d = docRef.current;
    const shapes = shapesOf(d, d.settings);
    const targets = ids.map((id) => shapes.get(id)).filter((s): s is NodeShape => !!s);
    if (targets.length < 2) return;
    const minX = Math.min(...targets.map((s) => s.x));
    const maxX = Math.max(...targets.map((s) => s.x + s.w));
    const minY = Math.min(...targets.map((s) => s.y));
    const maxY = Math.max(...targets.map((s) => s.y + s.h));
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const set = new Set(ids);
    commit({
      ...d,
      states: d.states.map((s) => {
        if (!set.has(s.id)) return s;
        const sh = shapes.get(s.id)!;
        let { x, y } = s.position;
        if (mode === 'left') x = minX;
        if (mode === 'hcenter') x = cx - sh.w / 2;
        if (mode === 'right') x = maxX - sh.w;
        if (mode === 'top') y = minY;
        if (mode === 'vcenter') y = cy - sh.h / 2;
        if (mode === 'bottom') y = maxY - sh.h;
        return { ...s, position: { x: Math.round(x), y: Math.round(y) } };
      }),
    });
  }, [commit]);

  const distributeStates = useCallback((ids: string[], dir: 'h' | 'v') => {
    const d = docRef.current;
    const shapes = shapesOf(d, d.settings);
    const items = ids
      .map((id) => ({ id, sh: shapes.get(id)! }))
      .filter((it) => it.sh)
      .sort((a, b) => (dir === 'h' ? a.sh.x - b.sh.x : a.sh.y - b.sh.y));
    if (items.length < 3) return;
    const first = items[0], last = items[items.length - 1];
    const totalSpan = dir === 'h'
      ? (last.sh.x + last.sh.w) - first.sh.x
      : (last.sh.y + last.sh.h) - first.sh.y;
    const totalSize = items.reduce((acc, it) => acc + (dir === 'h' ? it.sh.w : it.sh.h), 0);
    const gap = (totalSpan - totalSize) / (items.length - 1);
    const newPos = new Map<string, { x: number; y: number }>();
    let cursor = dir === 'h' ? first.sh.x : first.sh.y;
    items.forEach((it, i) => {
      if (i === 0) { cursor += dir === 'h' ? it.sh.w : it.sh.h; return; }
      if (i === items.length - 1) return;
      cursor += gap;
      newPos.set(it.id, dir === 'h'
        ? { x: Math.round(cursor), y: it.sh.y }
        : { x: it.sh.x, y: Math.round(cursor) });
      cursor += dir === 'h' ? it.sh.w : it.sh.h;
    });
    commit({
      ...d,
      states: d.states.map((s) => (newPos.has(s.id) ? { ...s, position: newPos.get(s.id)! } : s)),
    });
  }, [commit]);

  /* ---------- 转移操作 ---------- */
  const addTransition = useCallback((source: string, target: string, label: string): string => {
    const d = docRef.current;
    const parts = parseLabel(label);
    const t: ProjectTransition = { id: uid('t'), source, target, enabled: true, ...parts };
    commit(ensureStartNode({ ...d, transitions: [...d.transitions, t] }));
    setSel({ states: [], transitions: [t.id] });
    return t.id;
  }, [commit]);

  const updateTransition = useCallback((id: string, patch: Partial<ProjectTransition> & { label?: string }) => {
    const d = docRef.current;
    let labelParts: LabelParts = {};
    if (patch.label !== undefined) {
      labelParts = parseLabel(patch.label);
      delete patch.label;
      patch = {
        ...patch,
        event: labelParts.event, condition: labelParts.condition,
        conditionAction: labelParts.conditionAction, transitionAction: labelParts.transitionAction,
      };
    }
    const next = ensureStartNode({
      ...d,
      transitions: d.transitions.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    });
    commit(next);
    if (patch.enabled === false) {
      setSel((s) => ({ ...s, transitions: s.transitions.filter((x) => x !== id) }));
    }
  }, [commit]);

  const updateTransitionsBulk = useCallback((ids: string[], patch: Partial<ProjectTransition>) => {
    const d = docRef.current;
    const set = new Set(ids);
    const next = ensureStartNode({
      ...d,
      transitions: d.transitions.map((t) => (set.has(t.id) ? { ...t, ...patch } : t)),
    });
    commit(next);
    if (patch.enabled === false) {
      setSel((s) => ({ ...s, transitions: s.transitions.filter((x) => !set.has(x)) }));
    }
  }, [commit]);

  const deleteTransitions = useCallback((ids: string[]) => {
    const d = docRef.current;
    const doomed = new Set(ids);
    const next = ensureStartNode({
      ...d,
      transitions: d.transitions.filter((t) => !doomed.has(t.id)),
    });
    commit(next);
    setSel((s) => ({ ...s, transitions: s.transitions.filter((x) => !doomed.has(x)) }));
  }, [commit]);

  /* ---------- 布局 / 设置 ---------- */
  const applyLayout = useCallback((kind: LayoutKind) => {
    const d = docRef.current;
    const positions = runLayout(d, kind, d.settings);
    commit({
      ...d,
      states: d.states.map((s) => (positions.has(s.id)
        ? { ...s, position: positions.get(s.id)! } : s)),
      settings: { ...d.settings, layout: kind },
    });
    requestFit();
  }, [commit, requestFit]);

  const updateSettings = useCallback((patch: Partial<ProjectSettings>) => {
    const d = docRef.current;
    commit({ ...d, settings: { ...d.settings, ...patch } });
  }, [commit]);

  /** 视图类设置：不进撤销历史（主题 / 网格 / 小地图） */
  const setViewSettings = useCallback((patch: Partial<ProjectSettings>) => {
    setDoc((d) => ({ ...d, settings: { ...d.settings, ...patch } }));
    scheduleSave();
  }, [scheduleSave]);

  /* ---------- 工程文件 ---------- */
  const renameProject = useCallback((name: string) => {
    setDoc((d) => ({ ...d, name }));
    scheduleSave();
  }, [scheduleSave]);

  const newProject = useCallback(() => {
    const d = defaultDoc('未命名状态机');
    d.settings.theme = docRef.current.settings.theme;
    commit(d);
    setSel({ states: [], transitions: [] });
    requestFit();
    toast('已新建空白工程');
  }, [commit, requestFit, toast]);

  const importRaw = useCallback((raw: unknown, viaOpen = false): boolean => {
    try {
      const next = normalizeDoc(raw);
      commit(next);
      setSel({ states: [], transitions: [] });
      requestFit();
      toast(viaOpen ? `已打开「${next.name}」` : `已载入「${next.name}」`);
      return true;
    } catch {
      toast('文件解析失败：不是有效的 .smflow.json 工程', 'err');
      return false;
    }
  }, [commit, requestFit, toast]);

  const loadSample = useCallback((i: number) => {
    const sample = SAMPLES[i];
    if (!sample) return;
    const next = cloneDoc(sample);
    next.settings.theme = docRef.current.settings.theme;
    commit(next);
    setSel({ states: [], transitions: [] });
    requestFit();
    toast(`已载入示例「${next.name}」`);
  }, [commit, requestFit, toast]);

  const saveProjectFile = useCallback(() => {
    const d = docRef.current;
    const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${sanitizeFilename(d.name)}.smflow.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('工程文件已保存');
  }, [toast]);

  const importBulkTransitions = useCallback((text: string) => {
    const d = docRef.current;
    const { ok, skipped } = parseBulkTransitions(text, d);
    if (!ok.length) {
      toast(skipped ? `没有可导入的有效行（跳过 ${skipped} 行）` : '内容为空', 'err');
      return;
    }
    commit(ensureStartNode({ ...d, transitions: [...d.transitions, ...ok] }));
    setSel({ states: [], transitions: ok.map((t) => t.id) });
    toast(`已导入 ${ok.length} 条转移${skipped ? `，跳过 ${skipped} 行` : ''}`);
  }, [commit, toast]);

  const deleteSelection = useCallback(() => {
    const s = selRef.current;
    if (s.transitions.length) deleteTransitions(s.transitions);
    if (s.states.length) deleteStates(s.states);
  }, [deleteStates, deleteTransitions]);

  const selRef = useRef(sel);
  selRef.current = sel;

  const value = useMemo<AppContextValue>(() => ({
    doc, canUndo: past.current.length > 0, canRedo: future.current.length > 0,
    sel, view, fitSignal, toasts, modal, helpTab, renamingId, savedAt, focusReq,
    setView, requestFit, setModal, setHelpTab, setRenamingId, setSel, toast,
    undo, redo, commit, live, beginGesture, endGesture,
    renameProject, addState, addStatesBulk, updateState, deleteStates, setStatesColor,
    alignStates, distributeStates, addTransition, updateTransition, updateTransitionsBulk,
    deleteTransitions, applyLayout, updateSettings, setViewSettings, focusOn,
    importBulkTransitions, newProject, importRaw, loadSample, saveProjectFile, deleteSelection,
  }), [
    doc, sel, view, fitSignal, toasts, modal, helpTab, renamingId, savedAt, focusReq,
    requestFit, toast, undo, redo, commit, live, beginGesture, endGesture,
    renameProject, addState, addStatesBulk, updateState, deleteStates, setStatesColor,
    alignStates, distributeStates, addTransition, updateTransition, updateTransitionsBulk,
    deleteTransitions, applyLayout, updateSettings, setViewSettings, focusOn,
    importBulkTransitions, newProject, importRaw, loadSample, saveProjectFile, deleteSelection,
  ]);

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export { defaultSettings, nodeSize };
