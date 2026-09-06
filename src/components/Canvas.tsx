/* ============================================================
 * Canvas —— 统一画布：状态机 + 流程图（子流程浮动面板）+ 白板
 * 所有颜色按当前主题解析（theme-aware），文字用亮度对比保证可读。
 * ============================================================ */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStudio } from '../store';
import type { Tool } from '../store';
import {
  THEME, PALETTES, GRID_SNAP, FONT_STACK, START_ID,
  actionLines, nodeSize, readableOn, resolveShapeColor, ensureStartNode, makeSmState,
} from '../lib/core';
import type { ProjectState, ProjectTransition, FlowNode, WbShape } from '../lib/core';
import { shapesOf, computeEdgeGeoms, arrowPoints, bendFromPoint } from '../lib/geometry';
import type { EdgeGeom, NodeShape } from '../lib/geometry';
import {
  flattenFlow, findFlowNode, updateFlowNode, mapFlowLevel, toggleSubInDoc,
  C_PAD, C_HEADER,
} from '../lib/studio';
import { makeFlowNode, makeWbShape } from '../lib/core';
import type { FlatFlowNode, FlatPanel } from '../lib/studio';

interface View { x: number; y: number; k: number }
type ConnEndpoint = { family: 'state' | 'flow'; id: string; path: string[]; x: number; y: number };
type HoverTarget = { type: 'into' | 'out'; id: string } | null;
type Drag =
  | { mode: 'pan'; sx: number; sy: number; ox: number; oy: number }
  | { mode: 'marquee'; sx: number; sy: number; ex: number; ey: number }
  | { mode: 'move-state'; id: string; ids: string[]; swx: number; swy: number; base: typeof EMPTY_PAGE }
  | { mode: 'move-flow'; id: string; ids: string[]; path: string[]; swx: number; swy: number; base: typeof EMPTY_PAGE }
  | { mode: 'move-wb'; id: string; ids: string[]; swx: number; swy: number; base: typeof EMPTY_PAGE }
  | { mode: 'move-panel'; id: string; swx: number; swy: number; base: typeof EMPTY_PAGE }
  | { mode: 'connect'; from: ConnEndpoint; x: number; y: number }
  | { mode: 'bend'; id: string; isStep: boolean }
  | { mode: 'wb-draw'; id: string; sx: number; sy: number };

const EMPTY_PAGE = null as unknown as import('../lib/core').Page;

export function Canvas() {
  const app = useStudio();
  const { page, theme, tool, setTool, sel, setSel, updatePage, beginBatch, endBatch, doc } = app;
  const th = THEME[theme];
  const settings = doc.settings;
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [views, setViews] = useState<Record<string, View>>({});
  const view: View = views[page.id] ?? { x: 60, y: 40, k: 1 };
  const setView = (v: View) => setViews((m) => ({ ...m, [page.id]: v }));
  const [size, setSize] = useState({ w: 900, h: 600 });
  const [connect, setConnect] = useState<null | { from: ConnEndpoint; x: number; y: number }>(null);
  const [hoverEP, setHoverEP] = useState<ConnEndpoint | null>(null);
  const [hoverTarget, setHoverTarget] = useState<HoverTarget>(null);
  const [marquee, setMarquee] = useState<null | { x1: number; y1: number; x2: number; y2: number }>(null);
  const [renaming, setRenaming] = useState<null | { family: 'state' | 'flow' | 'wb'; id: string }>(null);
  const dragRef = useRef<Drag | null>(null);
  const hoverTargetRef = useRef<HoverTarget>(null);
  const setHT = (ht: HoverTarget) => { hoverTargetRef.current = ht; setHoverTarget(ht); };

  /* ---------- 尺寸监听 ---------- */
  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el); setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  /* ---------- 派生数据 ---------- */
  const smDoc = useMemo(() => ({ states: page.states, transitions: page.transitions }), [page]);
  const shapes = useMemo(() => shapesOf(smDoc, settings), [smDoc, settings]);
  const edges = useMemo(() => computeEdgeGeoms(smDoc, settings, theme), [smDoc, settings, theme]);
  const flat = useMemo(
    () => (page.type === 'canvas' ? flattenFlow(page.flowNodes, page.flowEdges) : { nodes: [] as FlatFlowNode[], edges: [] as ReturnType<typeof flattenFlow>['edges'], panels: [] as FlatPanel[] }),
    [page],
  );

  /* ---------- 坐标换算 ---------- */
  const pt = (e: { clientX: number; clientY: number }) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const toWorld = (sx: number, sy: number) => ({ x: (sx - view.x) / view.k, y: (sy - view.y) / view.k });
  const toScreen = (wx: number, wy: number) => ({ x: wx * view.k + view.x, y: wy * view.k + view.y });
  const capture = (e: { pointerId: number }) => svgRef.current?.setPointerCapture(e.pointerId);

  /* ---------- 包围盒 / 适应视图 ---------- */
  const bounds = useMemo(() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const add = (x: number, y: number, w: number, h: number) => {
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h);
    };
    for (const s of page.states) { const sz = nodeSize(s, settings); add(s.position.x, s.position.y, sz.w, sz.h); }
    for (const f of flat.nodes) add(f.x, f.y, f.w, f.h);
    for (const pn of flat.panels) add(pn.x, pn.y, pn.w, pn.h);
    for (const w of page.wbShapes) add(Math.min(w.x, w.x + w.w), Math.min(w.y, w.y + w.h), Math.abs(w.w), Math.abs(w.h));
    if (!isFinite(minX)) return { x: 0, y: 0, w: 800, h: 500 };
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }, [page, flat, settings]);

  useEffect(() => {
    if (!app.fitSignal) return;
    const pad = 60;
    const k = Math.min(1.4, Math.max(0.2, Math.min((size.w - pad * 2) / (bounds.w || 1), (size.h - pad * 2) / (bounds.h || 1))));
    setView({ k, x: size.w / 2 - (bounds.x + bounds.w / 2) * k, y: size.h / 2 - (bounds.y + bounds.h / 2) * k });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.fitSignal]);

  /* ---------- 注册导出函数（克隆世界图层 → 自包含 SVG） ---------- */
  useEffect(() => {
    app.exportHandle.current = (bg) => {
      const g = svgRef.current?.querySelector('g[data-world]');
      if (!g) return null;
      const pad = 48;
      const bx = bounds.x - pad, by = bounds.y - pad, bw = bounds.w + pad * 2, bh = bounds.h + pad * 2;
      const clone = g.cloneNode(true) as SVGGElement;
      clone.setAttribute('transform', '');
      clone.querySelectorAll('[data-noexport]').forEach((n) => n.remove());
      const bgFill = bg === 'transparent' ? '' : bg === 'theme' ? th.canvas : '#ffffff';
      const bgRect = bgFill ? `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" fill="${bgFill}"/>` : '';
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bx} ${by} ${bw} ${bh}" width="${bw}" height="${bh}">${bgRect}${clone.outerHTML}</svg>`;
      return { svg, w: bw, h: bh };
    };
    return () => { app.exportHandle.current = null; };
  });

  /* ---------- 工具放置 ---------- */
  const nextSmName = () => {
    let n = page.states.filter((s) => s.kind === 'state').length + 1;
    while (page.states.some((s) => s.name === `State${n}`)) n++;
    return `State${n}`;
  };
  const place = (wx: number, wy: number, t: Tool = tool, center = false) => {
    const snap = settings.snapToGrid ? GRID_SNAP : 1;
    if (page.type === 'canvas' && t.startsWith('sm-')) {
      const kind = t === 'sm-terminal' ? 'terminal' : t === 'sm-junction' ? 'junction' : 'state';
      const s = makeSmState(kind, Math.round(wx / snap) * snap, Math.round(wy / snap) * snap, kind === 'state' ? nextSmName() : kind === 'terminal' ? '结束' : '');
      updatePage((p) => ensureStartNode({ ...p, states: [...p.states, s] }));
      setSel({ kind: 'state', id: s.id });
    } else if (page.type === 'canvas' && t.startsWith('flow-')) {
      const kindMap: Record<string, FlowNode['kind']> = { 'flow-start': 'start', 'flow-process': 'process', 'flow-decision': 'decision', 'flow-io': 'io', 'flow-subprocess': 'subprocess' };
      const n = makeFlowNode(kindMap[t], 0, 0);
      n.x = Math.round((wx - (center ? n.w / 2 : 0)) / snap) * snap;
      n.y = Math.round((wy - (center ? n.h / 2 : 0)) / snap) * snap;
      updatePage((p) => ({ ...p, flowNodes: [...p.flowNodes, n] }));
      setSel({ kind: 'flow', id: n.id });
    } else if (page.type === 'whiteboard' && t === 'wb-text') {
      const w = makeWbShape('text', Math.round(wx / snap) * snap, Math.round(wy / snap) * snap);
      updatePage((p) => ({ ...p, wbShapes: [...p.wbShapes, w] }));
      setSel({ kind: 'wb', id: w.id });
    }
    setTool('select');
  };

  /* ---------- 子流程展开/收纳 ---------- */
  const toggleSub = (id: string) => {
    const obstacles = page.states.map((s) => { const sz = nodeSize(s, settings); return { x: s.position.x, y: s.position.y, w: sz.w, h: sz.h }; });
    const r = toggleSubInDoc(page.flowNodes, page.flowEdges, id, page.flowDir, obstacles);
    updatePage((p) => ({ ...p, flowNodes: r.nodes, flowEdges: r.edges }));
    setSel({ kind: 'flow', id });
  };

  /* ---------- 指针手势 ---------- */
  const onSvgPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    const p = pt(e);
    if (e.button === 0 && tool !== 'select') {
      if (page.type === 'whiteboard' && tool !== 'wb-text') { startWbDraw(e); return; }
      const w = toWorld(p.x, p.y); place(w.x, w.y); return;
    }
    if (e.button === 1 || e.ctrlKey || e.metaKey) {
      dragRef.current = { mode: 'pan', sx: p.x, sy: p.y, ox: view.x, oy: view.y };
    } else {
      dragRef.current = { mode: 'marquee', sx: p.x, sy: p.y, ex: p.x, ey: p.y };
      setMarquee({ x1: p.x, y1: p.y, x2: p.x, y2: p.y });
    }
    capture(e);
  };
  const famOf = (m: string): 'state' | 'flow' | 'wb' => (m === 'move-state' ? 'state' : m === 'move-flow' ? 'flow' : 'wb');
  const startMove = (e: React.PointerEvent, d: Drag) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (d.mode !== 'move-state' && d.mode !== 'move-flow' && d.mode !== 'move-wb' && d.mode !== 'move-panel') return;
    if (d.mode === 'move-panel') { beginBatch(); dragRef.current = d; capture(e); return; }
    const fam = famOf(d.mode);
    const p = pt(e); const w = toWorld(p.x, p.y);
    (d as { swx?: number }).swx = w.x; (d as { swy?: number }).swy = w.y;
    const ids = sel.kind === fam && sel.ids.includes(d.id) ? sel.ids : [d.id];
    setSel({ kind: fam, ids });
    (d as { ids?: string[] }).ids = ids;
    beginBatch(); dragRef.current = d; capture(e);
  };
  const startConnect = (e: React.PointerEvent, from: ConnEndpoint) => {
    e.stopPropagation();
    dragRef.current = { mode: 'connect', from, x: from.x, y: from.y };
    setConnect({ from, x: from.x, y: from.y });
    capture(e);
  };
  const startBend = (e: React.PointerEvent, g: EdgeGeom) => {
    e.stopPropagation();
    const t = page.transitions.find((x) => x.id === g.id); if (!t) return;
    const style = t.lineStyle ?? settings.edgeStyle;
    dragRef.current = { mode: 'bend', id: g.id, isStep: style === 'smoothstep' || style === 'orthogonal' };
    beginBatch(); capture(e);
  };
  const startWbDraw = (e: React.PointerEvent) => {
    const p = pt(e); const w = toWorld(p.x, p.y);
    const kindMap = { 'wb-rect': 'rect', 'wb-ellipse': 'ellipse', 'wb-arrow': 'arrow', 'wb-line': 'line' } as const;
    const shape = makeWbShape(kindMap[tool as keyof typeof kindMap], w.x, w.y);
    shape.w = 2; shape.h = (tool === 'wb-arrow' || tool === 'wb-line') ? 0 : 2;
    updatePage((p) => ({ ...p, wbShapes: [...p.wbShapes, shape] }), false);
    setSel({ kind: 'wb', id: shape.id });
    dragRef.current = { mode: 'wb-draw', id: shape.id, sx: w.x, sy: w.y };
    capture(e);
  };

  /* ---------- 拖入/拖出子流程检测 ---------- */
  const detectHover = (d: Extract<Drag, { mode: 'move-flow' }>, w: { x: number; y: number }): HoverTarget => {
    const key = d.path.join('/');
    const into = flat.panels
      .filter((pn) => pn.id !== d.id && !d.path.includes(pn.id) && [...pn.path, pn.id].join('/') !== key)
      .sort((a, b) => b.path.length - a.path.length)
      .find((pn) => w.x >= pn.x && w.x <= pn.x + pn.w && w.y >= pn.y && w.y <= pn.y + pn.h);
    if (into) return { type: 'into', id: into.id };
    if (d.path.length) {
      const cont = flat.panels.find((pn) => [...pn.path, pn.id].join('/') === key);
      if (cont && (w.x < cont.x || w.x > cont.x + cont.w || w.y < cont.y || w.y > cont.y + cont.h)) return { type: 'out', id: cont.id };
    }
    return null;
  };

  const onSvgPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current; if (!d) return;
    const p = pt(e);
    if (d.mode === 'pan') {
      setView({ ...view, x: d.ox + (p.x - d.sx), y: d.oy + (p.y - d.sy) });
    } else if (d.mode === 'marquee') {
      dragRef.current = { ...d, ex: p.x, ey: p.y };
      setMarquee({ x1: d.sx, y1: d.sy, x2: p.x, y2: p.y });
    } else if (d.mode === 'move-state') {
      const w = toWorld(p.x, p.y);
      const snap = settings.snapToGrid ? GRID_SNAP : 1;
      const dx = w.x - d.swx, dy = w.y - d.swy;
      const idset = new Set(d.ids);
      updatePage(() => ({ ...d.base, states: d.base.states.map((s) => idset.has(s.id) ? { ...s, position: { x: Math.round((s.position.x + dx) / snap) * snap, y: Math.round((s.position.y + dy) / snap) * snap } } : s) }), false);
    } else if (d.mode === 'move-flow') {
      const w = toWorld(p.x, p.y);
      const snap = settings.snapToGrid ? GRID_SNAP : 1;
      const dx = w.x - d.swx, dy = w.y - d.swy;
      const idset = new Set(d.ids);
      const r = mapFlowLevel(d.base.flowNodes, d.base.flowEdges, d.path, (f) => ({
        ...f,
        nodes: f.nodes.map((n) => idset.has(n.id) ? { ...n, x: Math.round((n.x + dx) / snap) * snap, y: Math.round((n.y + dy) / snap) * snap } : n),
      }));
      updatePage(() => ({ ...d.base, flowNodes: r.nodes }), false);
      if (d.ids.length === 1) setHT(detectHover(d, w));
    } else if (d.mode === 'move-wb') {
      const w = toWorld(p.x, p.y);
      const snap = settings.snapToGrid ? GRID_SNAP : 1;
      const dx = w.x - d.swx, dy = w.y - d.swy;
      const idset = new Set(d.ids);
      updatePage(() => ({ ...d.base, wbShapes: d.base.wbShapes.map((s) => idset.has(s.id) ? { ...s, x: Math.round((s.x + dx) / snap) * snap, y: Math.round((s.y + dy) / snap) * snap } : s) }), false);
    } else if (d.mode === 'move-panel') {
      const w = toWorld(p.x, p.y);
      const snap = settings.snapToGrid ? GRID_SNAP : 1;
      const orig = findFlowNode(d.base.flowNodes, d.id); if (!orig || !orig.expandPos) return;
      const nx = Math.round((orig.expandPos.x + (w.x - d.swx)) / snap) * snap;
      const ny = Math.round((orig.expandPos.y + (w.y - d.swy)) / snap) * snap;
      updatePage(() => ({ ...d.base, flowNodes: updateFlowNode(d.base.flowNodes, d.id, { expandPos: { x: nx, y: ny } }) }), false);
    } else if (d.mode === 'connect') {
      const w = toWorld(p.x, p.y);
      setConnect({ from: d.from, x: w.x, y: w.y });
    } else if (d.mode === 'bend') {
      const w = toWorld(p.x, p.y);
      const g = edges.find((x) => x.id === d.id); if (!g) return;
      const bend = bendFromPoint(g.sx, g.sy, g.ex, g.ey, w.x, w.y, d.isStep);
      updatePage((pp) => ({ ...pp, transitions: pp.transitions.map((t) => (t.id === d.id ? { ...t, bend: Math.round(bend) } : t)) }), false);
    } else if (d.mode === 'wb-draw') {
      const w = toWorld(p.x, p.y);
      updatePage((pp) => ({ ...pp, wbShapes: pp.wbShapes.map((s) => (s.id === d.id ? { ...s, w: w.x - d.sx, h: w.y - d.sy } : s)) }), false);
    }
  };

  const onSvgPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current; dragRef.current = null;
    if (!d) return;
    if (d.mode === 'marquee') {
      setMarquee(null);
      const x1 = Math.min(d.sx, d.ex), x2 = Math.max(d.sx, d.ex);
      const y1 = Math.min(d.sy, d.ey), y2 = Math.max(d.sy, d.ey);
      if (Math.hypot(x2 - x1, y2 - y1) < 5) { setSel({ kind: null }); return; }
      const w1 = toWorld(x1, y1), w2 = toWorld(x2, y2);
      const hit = (r: { x: number; y: number; w: number; h: number }) => r.x < w2.x && r.x + r.w > w1.x && r.y < w2.y && r.y + r.h > w1.y;
      if (page.type === 'whiteboard') {
        const ids = page.wbShapes.filter((s) => hit({ x: Math.min(s.x, s.x + s.w), y: Math.min(s.y, s.y + s.h), w: Math.abs(s.w), h: Math.max(8, Math.abs(s.h)) })).map((s) => s.id);
        setSel({ kind: 'wb', ids });
      } else {
        const flowIds = flat.nodes.filter((f) => hit(f)).map((f) => f.n.id);
        if (flowIds.length) { setSel({ kind: 'flow', ids: flowIds }); return; }
        const stIds = page.states.filter((s) => { const sh = shapes.get(s.id); return sh ? hit(sh) : false; }).map((s) => s.id);
        setSel({ kind: 'state', ids: stIds });
      }
      return;
    }
    if (d.mode === 'move-flow') {
      const ht = hoverTargetRef.current;
      if (d.ids.length === 1 && ht) {
        const node = findFlowNode(d.base.flowNodes, d.id);
        if (node) {
          const p = pt(e); const w = toWorld(p.x, p.y);
          const snap = settings.snapToGrid ? GRID_SNAP : 1;
          const origin = (path: string[]) => {
            if (!path.length) return { x: 0, y: 0 };
            const pn = flat.panels.find((q) => q.id === path[path.length - 1] && q.path.join('/') === path.slice(0, -1).join('/'));
            return pn ? { x: pn.x + C_PAD, y: pn.y + C_HEADER } : { x: 0, y: 0 };
          };
          const fw = { x: Math.round((node.x + (w.x - d.swx)) / snap) * snap, y: Math.round((node.y + (w.y - d.swy)) / snap) * snap };
          const srcOrigin = origin(d.path);
          const world = { x: srcOrigin.x + node.x + (w.x - d.swx), y: srcOrigin.y + node.y + (w.y - d.swy) };
          const stripLevel = (f: { nodes: FlowNode[]; edges: typeof page.flowEdges }) => ({
            nodes: f.nodes.filter((n) => n.id !== d.id),
            edges: f.edges.filter((ed) => ed.source !== d.id && ed.target !== d.id),
          });
          if (ht.type === 'into') {
            const panel = flat.panels.find((pn) => pn.id === ht.id);
            if (panel) {
              const removed = mapFlowLevel(d.base.flowNodes, d.base.flowEdges, d.path, stripLevel);
              const added = mapFlowLevel(removed.nodes, removed.edges, [...panel.path, panel.id], (f) => ({
                ...f, nodes: [...f.nodes, { ...node, x: Math.round((world.x - (panel.x + C_PAD)) / snap) * snap, y: Math.round((world.y - (panel.y + C_HEADER)) / snap) * snap }],
              }));
              updatePage(() => ({ ...d.base, flowNodes: added.nodes, flowEdges: added.edges }), false);
              app.toast('已移入子流程');
            }
          } else {
            const cont = flat.panels.find((pn) => pn.id === ht.id);
            if (cont) {
              const o = origin(cont.path);
              const removed = mapFlowLevel(d.base.flowNodes, d.base.flowEdges, d.path, stripLevel);
              const added = mapFlowLevel(removed.nodes, removed.edges, cont.path, (f) => ({
                ...f, nodes: [...f.nodes, { ...node, x: Math.round((world.x - o.x) / snap) * snap, y: Math.round((world.y - o.y) / snap) * snap }],
              }));
              updatePage(() => ({ ...d.base, flowNodes: added.nodes, flowEdges: added.edges }), false);
              app.toast('已移出子流程');
            }
          }
          void fw;
        }
      }
      setHT(null);
    }
    if (d.mode === 'move-state' || d.mode === 'move-flow' || d.mode === 'move-wb' || d.mode === 'move-panel' || d.mode === 'bend') endBatch();
    if (d.mode === 'wb-draw') {
      updatePage((pp) => ({
        ...pp,
        wbShapes: pp.wbShapes.map((s) => {
          if (s.id !== d.id) return s;
          let { x, y, w, h } = s;
          if (w < 0) { x += w; w = -w; } if (h < 0) { y += h; h = -h; }
          const isLine = s.kind === 'arrow' || s.kind === 'line';
          if (!isLine && w < 12 && h < 12) { w = 160; h = 100; }
          if (isLine && Math.hypot(w, h) < 12) { w = 160; h = 0; }
          return { ...s, x, y, w, h };
        }),
      }));
      setTool('select');
    }
    if (d.mode === 'connect') {
      const p = pt(e); const w = toWorld(p.x, p.y);
      const target = endpointAt(w);
      const ok = connValid(d.from, target);
      if (target && ok.valid) {
        if (d.from.family === 'state') {
          const tr: ProjectTransition = { id: uidT(), source: d.from.id, target: target.id, enabled: true };
          updatePage((pp) => ensureStartNode({ ...pp, transitions: [...pp.transitions, tr] }));
          setSel({ kind: 'transition', id: tr.id });
        } else {
          updatePage((pp) => {
            const r = mapFlowLevel(pp.flowNodes, pp.flowEdges, d.from.path, (f) => ({ ...f, edges: [...f.edges, { id: uidT(), source: d.from.id, target: target.id }] }));
            return { ...pp, flowNodes: r.nodes, flowEdges: r.edges };
          });
        }
      } else if (target && !ok.valid) {
        app.toast(ok.reason ?? '无法连接', 'err');
      }
      setConnect(null);
    }
  };

  const uidT = () => `t_${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
  const endpointAt = (w: { x: number; y: number }): ConnEndpoint | null => {
    for (const f of flat.nodes) {
      if (w.x >= f.x && w.x <= f.x + f.w && w.y >= f.y && w.y <= f.y + f.h) return { family: 'flow', id: f.n.id, path: f.path, x: f.x + f.w / 2, y: f.y + f.h / 2 };
    }
    for (const s of page.states) {
      const sh = shapes.get(s.id); if (!sh) continue;
      if (w.x >= sh.x && w.x <= sh.x + sh.w && w.y >= sh.y && w.y <= sh.y + sh.h) return { family: 'state', id: s.id, path: [], x: sh.cx, y: sh.cy };
    }
    return null;
  };
  const connValid = (from: ConnEndpoint, to: ConnEndpoint | null): { valid: boolean; reason?: string } => {
    if (!to) return { valid: false };
    if (from.id === to.id) return { valid: false, reason: '不能连接到自身' };
    if (from.family !== to.family) return { valid: false, reason: '状态机与流程图元素之间不能连线' };
    if (from.family === 'flow' && from.path.join('/') !== to.path.join('/')) return { valid: false, reason: '只能在同一子流程层级内连线' };
    return { valid: true };
  };

  const onWheel = (e: React.WheelEvent) => {
    const p = pt(e);
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const k = Math.min(2.5, Math.max(0.15, view.k * factor));
    const w = toWorld(p.x, p.y);
    setView({ k, x: p.x - w.x * k, y: p.y - w.y * k });
  };
  const onDblClick = (e: React.MouseEvent) => {
    const p = pt(e); const w = toWorld(p.x, p.y);
    const ep = endpointAt(w);
    if (!ep) { place(w.x, w.y, page.type === 'whiteboard' ? 'wb-text' : 'sm-state', false); }
  };

  const onDrop = (e: React.DragEvent) => {
    const t = e.dataTransfer.getData('text/x-sf-tool') as Tool;
    if (!t) return;
    e.preventDefault();
    const r = svgRef.current!.getBoundingClientRect();
    const w = toWorld(e.clientX - r.left, e.clientY - r.top);
    place(w.x, w.y, t, true);
  };

  const isEmpty = page.type === 'canvas'
    ? !page.states.length && !page.flowNodes.length
    : !page.wbShapes.length;

  return (
    <div ref={wrapRef} className="relative flex-1 min-w-0 overflow-hidden" style={{ background: th.canvas }}
      onContextMenu={(e) => e.preventDefault()}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('text/x-sf-tool')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }}
      onDrop={onDrop}>
      <svg ref={svgRef} className="w-full h-full block touch-none"
        style={{ cursor: tool === 'select' ? 'default' : 'crosshair' }}
        onPointerDown={onSvgPointerDown} onPointerMove={onSvgPointerMove} onPointerUp={onSvgPointerUp}
        onWheel={onWheel} onDoubleClick={onDblClick} onMouseLeave={() => setHoverEP(null)}>
        {settings.showGrid && (
          <>
            <defs>
              <pattern id="ugrid" width={24 * view.k} height={24 * view.k} patternUnits="userSpaceOnUse" patternTransform={`translate(${view.x} ${view.y})`}>
                <circle cx={1.2} cy={1.2} r={1.2} fill={th.dot} />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#ugrid)" />
          </>
        )}
        <g data-world="1" transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          {page.type === 'whiteboard' ? (
            page.wbShapes.map((w) => (
              <WbShapeView key={w.id} w={w} theme={theme} selected={sel.kind === 'wb' && sel.id === w.id}
                onDown={(e) => startMove(e, { mode: 'move-wb', id: w.id, ids: [], swx: 0, swy: 0, base: page })}
                onRename={() => setRenaming({ family: 'wb', id: w.id })} />
            ))
          ) : (
            <>
              {/* 子流程面板（先画，位于底层） */}
              {flat.panels.map((pn) => (
                <PanelView key={'pn' + pn.id} pn={pn} theme={theme}
                  selected={sel.kind === 'flow' && sel.id === pn.id}
                  glow={hoverTarget !== null && hoverTarget.id === pn.id}
                  onDownPanel={(e) => { const wpt = pt(e); const ww = toWorld(wpt.x, wpt.y); startMove(e, { mode: 'move-panel', id: pn.id, swx: ww.x, swy: ww.y, base: page }); }}
                  onSelect={() => setSel({ kind: 'flow', id: pn.id })}
                  onCollapse={() => toggleSub(pn.id)} />
              ))}
              {/* 流程连线 */}
              {flat.edges.map((fe) => (
                <FlowEdgeView key={fe.e.id} fe={fe} theme={theme}
                  selected={sel.kind === 'flowEdge' && sel.id === fe.e.id}
                  onSelect={() => setSel({ kind: 'flowEdge', id: fe.e.id })} />
              ))}
              {/* 流程结点 */}
              {flat.nodes.map((f) => (
                <FlowNodeView key={f.n.id} f={f} theme={theme}
                  selected={sel.kind === 'flow' && sel.ids.includes(f.n.id)}
                  glow={hoverTarget !== null && sel.kind === 'flow' && sel.id === f.n.id && sel.ids.length === 1}
                  onDown={(e) => startMove(e, { mode: 'move-flow', id: f.n.id, ids: [], path: f.path, swx: 0, swy: 0, base: page })}
                  onExpand={() => toggleSub(f.n.id)}
                  onRename={() => setRenaming({ family: 'flow', id: f.n.id })}
                  onHover={(h) => setHoverEP(h ? { family: 'flow', id: f.n.id, path: f.path, x: f.x, y: f.y } : null)} />
              ))}
              {/* 状态转移 */}
              {edges.map((g) => (
                <EdgeView key={g.id} g={g} theme={theme} arrowSize={settings.arrowSize}
                  selected={sel.kind === 'transition' && sel.id === g.id}
                  onSelect={() => setSel({ kind: 'transition', id: g.id })}
                  onBendStart={(e, gg) => startBend(e, gg)} />
              ))}
              {/* 状态结点 */}
              {page.states.map((s) => {
                const sh = shapes.get(s.id); if (!sh) return null;
                return (
                  <StateNodeView key={s.id} s={s} sh={sh} theme={theme} settings={settings}
                    selected={sel.kind === 'state' && sel.ids.includes(s.id)}
                    onDown={(e) => startMove(e, { mode: 'move-state', id: s.id, ids: [], swx: 0, swy: 0, base: page })}
                    onRename={() => setRenaming({ family: 'state', id: s.id })}
                    onHover={(h) => setHoverEP(h ? { family: 'state', id: s.id, path: [], x: sh.cx, y: sh.cy } : null)} />
                );
              })}
            </>
          )}
          {/* 连接飞线 */}
          {connect && (
            <line x1={connect.from.x} y1={connect.from.y} x2={connect.x} y2={connect.y}
              stroke={th.sel} strokeWidth={2 / view.k} strokeDasharray={`${6 / view.k} ${4 / view.k}`} />
          )}
        </g>
      </svg>

      {/* 框选矩形 */}
      {marquee && (
        <div className="absolute pointer-events-none" style={{
          left: Math.min(marquee.x1, marquee.x2), top: Math.min(marquee.y1, marquee.y2),
          width: Math.abs(marquee.x2 - marquee.x1), height: Math.abs(marquee.y2 - marquee.y1),
          border: `1px solid ${th.sel}`, background: 'color-mix(in srgb, var(--accent) 10%, transparent)', borderRadius: 4,
        }} />
      )}

      {/* 重命名浮层 */}
      {renaming && (
        <RenameOverlay key={renaming.id + String(renaming.family)} fam={renaming.family} id={renaming.id}
          toScreen={toScreen} k={view.k}
          onDone={(name) => {
            if (name) {
              if (renaming.family === 'state') updatePage((p) => ({ ...p, states: p.states.map((s) => (s.id === renaming.id ? { ...s, name } : s)) }));
              else if (renaming.family === 'flow') updatePage((p) => ({ ...p, flowNodes: updateFlowNode(p.flowNodes, renaming.id, { text: name }) }));
              else updatePage((p) => ({ ...p, wbShapes: p.wbShapes.map((s) => (s.id === renaming.id ? { ...s, text: name } : s)) }));
            }
            setRenaming(null);
          }} />
      )}

      {/* 连接手柄（悬停时） */}
      {hoverEP && !connect && tool === 'select' && (() => {
        const sp = toScreen(hoverEP.x, hoverEP.y);
        return (
          <div className="absolute z-10" style={{ left: sp.x - 9, top: sp.y - 9 }}>
            <div className="w-[18px] h-[18px] rounded-full cursor-crosshair transition-transform hover:scale-125"
              style={{ background: th.sel, border: '2.5px solid #fff', boxShadow: '0 1px 6px rgba(0,0,0,.3)' }}
              title="拖到目标元素连线"
              onPointerDown={(e) => startConnect(e as unknown as React.PointerEvent, hoverEP)} />
          </div>
        );
      })()}

      {/* 空状态提示 */}
      {isEmpty && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center px-6 py-5 rounded-2xl" style={{ background: 'color-mix(in srgb, var(--panel) 82%, transparent)', border: '1px dashed var(--border-strong)' }}>
            <div className="text-[15px] font-bold mb-1" style={{ color: 'var(--text)' }}>
              {page.type === 'canvas' ? '从左侧拖入元素，或双击空白新建状态' : '从左侧插入图片、拖入形状开始标注'}
            </div>
            <div className="text-[12px]" style={{ color: 'var(--muted)' }}>悬停元素拖出圆点即可连线</div>
          </div>
        </div>
      )}

      {/* 缩放控件 */}
      <div className="absolute right-3 bottom-3 z-10 flex flex-col gap-1">
        <button className="icon-btn" style={{ background: 'var(--panel-2)', border: '1px solid var(--border)' }} onClick={() => zoomBy(1.2)} title="放大">＋</button>
        <button className="icon-btn" style={{ background: 'var(--panel-2)', border: '1px solid var(--border)' }} onClick={() => zoomBy(1 / 1.2)} title="缩小">－</button>
        <button className="icon-btn" style={{ background: 'var(--panel-2)', border: '1px solid var(--border)', fontSize: 10 }} onClick={() => app.requestFit()} title="适应视图 (F)">⤢</button>
      </div>
      <div className="absolute right-3 bottom-[128px] z-10 px-2 py-0.5 rounded-md text-[10.5px] font-code"
        style={{ background: 'var(--panel-2)', border: '1px solid var(--border)', color: 'var(--muted)' }}>
        {Math.round(view.k * 100)}%
      </div>
    </div>
  );

  function zoomBy(f: number) {
    const k = Math.min(2.5, Math.max(0.15, view.k * f));
    const cx = size.w / 2, cy = size.h / 2;
    const w = toWorld(cx, cy);
    setView({ k, x: cx - w.x * k, y: cy - w.y * k });
  }
}

/* ================= 重命名浮层 ================= */
function RenameOverlay({ fam, id, toScreen, k, onDone }: {
  fam: 'state' | 'flow' | 'wb'; id: string;
  toScreen: (x: number, y: number) => { x: number; y: number }; k: number;
  onDone: (name: string) => void;
}) {
  const app = useStudio();
  const { page } = app;
  let x = 0, y = 0, w = 140, val = '';
  if (fam === 'state') {
    const s = page.states.find((v) => v.id === id); if (!s) return null;
    x = s.position.x; y = s.position.y; w = 150; val = s.name;
  } else if (fam === 'flow') {
    const n = findFlowNode(page.flowNodes, id); if (!n) return null;
    x = n.x; y = n.y; w = n.w; val = n.text;
  } else {
    const s = page.wbShapes.find((v) => v.id === id); if (!s) return null;
    x = s.x; y = s.y; w = s.w; val = s.text ?? '';
  }
  const sp = toScreen(x, y);
  const [draft, setDraft] = useState(val);
  const cancelled = useRef(false);
  return (
    <input autoFocus className="absolute z-20 field-input"
      style={{ left: sp.x, top: sp.y - 34, width: Math.max(120, w * k), height: 28, fontSize: 12 }}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onDone(draft.trim());
        if (e.key === 'Escape') { cancelled.current = true; onDone(''); }
      }}
      onBlur={() => { if (!cancelled.current) onDone(draft.trim()); }} />
  );
}

/* ================= 状态结点 ================= */
function StateNodeView({ s, sh, theme, settings, selected, onDown, onRename, onHover }: {
  s: ProjectState; sh: NodeShape; theme: 'light' | 'dark'; settings: import('../lib/core').ProjectSettings;
  selected: boolean; onDown: (e: React.PointerEvent) => void; onRename: () => void; onHover: (h: boolean) => void;
}) {
  const th = THEME[theme];
  const pal = PALETTES[s.color][theme];
  if (s.kind === 'start') {
    return (
      <g data-el="1" onPointerDown={onDown} onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)} style={{ cursor: 'move' }}>
        {selected && <circle cx={sh.cx} cy={sh.cy} r={sh.r + 6} fill="none" stroke={th.selGlow} strokeWidth={5} />}
        <circle cx={sh.cx} cy={sh.cy} r={sh.r} fill={th.startFill} stroke={selected ? th.sel : 'none'} strokeWidth={2} />
        <circle cx={sh.cx} cy={sh.cy} r={3.5} fill={th.startDot} />
      </g>
    );
  }
  if (s.kind === 'junction') {
    return (
      <g data-el="1" onPointerDown={onDown} onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)} style={{ cursor: 'move' }}>
        {selected && <circle cx={sh.cx} cy={sh.cy} r={sh.r + 6} fill="none" stroke={th.selGlow} strokeWidth={5} />}
        <circle cx={sh.cx} cy={sh.cy} r={sh.r} fill={th.junctionFill} stroke={th.junctionBorder} strokeWidth={2} />
      </g>
    );
  }
  const lines = actionLines(s, settings.showActionText);
  return (
    <g data-el="1" onPointerDown={onDown} onDoubleClick={(e) => { e.stopPropagation(); onRename(); }}
      onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)} style={{ cursor: 'move' }}>
      {selected && <rect x={sh.x - 4} y={sh.y - 4} width={sh.w + 8} height={sh.h + 8} rx={14} fill="none" stroke={th.selGlow} strokeWidth={5} />}
      <rect x={sh.x} y={sh.y} width={sh.w} height={sh.h} rx={11}
        fill={pal.fill} stroke={selected ? th.sel : pal.border} strokeWidth={selected ? 2.2 : 1.5} />
      {s.kind === 'terminal' && <rect x={sh.x + 4} y={sh.y + 4} width={sh.w - 8} height={sh.h - 8} rx={8} fill="none" stroke={pal.border} strokeWidth={1.2} />}
      <rect x={sh.x + 7} y={sh.y + 8} width={4} height={Math.min(18, sh.h - 16)} rx={2} fill={pal.accent} />
      <text x={sh.x + 18} y={sh.y + 22} fontSize={13} fontWeight={700} fill={pal.text} fontFamily={FONT_STACK}>{s.name}</text>
      {lines.map((l, i) => (
        <text key={i} x={sh.x + 18} y={sh.y + 42 + i * 16} fontSize={10.5} fontStyle="italic" fill={th.actionText} fontFamily={FONT_STACK}>
          <tspan fill={th.muted}>{l.k} </tspan>{l.t}
        </text>
      ))}
    </g>
  );
}

/* ================= 状态转移 ================= */
function EdgeView({ g, theme, arrowSize, selected, onSelect, onBendStart }: {
  g: EdgeGeom; theme: 'light' | 'dark'; arrowSize: number; selected: boolean;
  onSelect: () => void; onBendStart: (e: React.PointerEvent, g: EdgeGeom) => void;
}) {
  const th = THEME[theme];
  const color = selected ? th.sel : g.color;
  return (
    <g data-el="1" style={{ cursor: 'pointer' }} onPointerDown={(e) => { e.stopPropagation(); onSelect(); }}>
      {selected && <path d={g.d} fill="none" stroke={th.selGlow} strokeWidth={g.width + 6} strokeLinecap="round" />}
      <path d={g.d} fill="none" stroke={color} strokeWidth={g.width} strokeDasharray={g.dash} strokeLinecap="round" />
      <path d={g.d} fill="none" stroke="transparent" strokeWidth={18} />
      <polygon points={arrowPoints(g.ax, g.ay, g.aa, arrowSize)} fill={color} />
      {g.lines.length > 0 && (
        <g>
          <rect x={g.labelX - g.labelW / 2} y={g.labelY - g.labelH / 2} width={g.labelW} height={g.labelH} rx={7}
            fill={th.edgeLabelBg} stroke={selected ? th.sel : th.edgeLabelBorder} strokeWidth={selected ? 1.5 : 1} />
          {g.lines.map((ln, i) => (
            <text key={i} x={g.labelX} y={g.labelY - ((g.lines.length - 1) * 15) / 2 + i * 15}
              textAnchor="middle" dominantBaseline="middle" fontSize={11}
              fontWeight={selected ? 700 : 500} fill={th.edgeLabelText} fontFamily={FONT_STACK}>{ln}</text>
          ))}
        </g>
      )}
      {selected && g.bendable && g.handle && (
        <circle data-noexport="1" cx={g.handle.x} cy={g.handle.y} r={7}
          fill="var(--panel-2)" stroke={th.sel} strokeWidth={2} style={{ cursor: 'grab' }}
          onPointerDown={(e) => onBendStart(e, g)}>
          <animate attributeName="r" values="6;8;6" dur="1.2s" repeatCount="indefinite" />
        </circle>
      )}
    </g>
  );
}

/* ================= 流程连线 ================= */
function FlowEdgeView({ fe, theme, selected, onSelect }: {
  fe: ReturnType<typeof flattenFlow>['edges'][number]; theme: 'light' | 'dark'; selected: boolean; onSelect: () => void;
}) {
  const th = THEME[theme];
  const color = selected ? th.sel : th.edge;
  const { a, b } = fe;
  const x1 = a.x + a.w / 2, y1 = a.y + a.h / 2, x2 = b.x + b.w / 2, y2 = b.y + b.h / 2;
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const sx = x1 + Math.cos(ang) * a.w / 2, sy = y1 + Math.sin(ang) * a.h / 2;
  const ex = x2 - Math.cos(ang) * (b.w / 2 + 6), ey = y2 - Math.sin(ang) * (b.h / 2 + 6);
  const mx = (sx + ex) / 2, my = (sy + ey) / 2;
  return (
    <g data-el="1" style={{ cursor: 'pointer' }} onPointerDown={(e) => { e.stopPropagation(); onSelect(); }}>
      {selected && <line x1={sx} y1={sy} x2={ex} y2={ey} stroke={th.selGlow} strokeWidth={7} strokeLinecap="round" />}
      <line x1={sx} y1={sy} x2={ex} y2={ey} stroke={color} strokeWidth={selected ? 2.4 : 1.8} strokeLinecap="round" />
      <line x1={sx} y1={sy} x2={ex} y2={ey} stroke="transparent" strokeWidth={16} />
      <polygon points={arrowPoints(ex, ey, ang, 13)} fill={color} />
      {fe.e.label && (
        <g>
          <rect x={mx - 30} y={my - 11} width={60} height={20} rx={6} fill={th.edgeLabelBg} stroke={selected ? th.sel : th.edgeLabelBorder} />
          <text x={mx} y={my + 1} textAnchor="middle" dominantBaseline="middle" fontSize={10.5} fill={th.edgeLabelText} fontFamily={FONT_STACK}>{fe.e.label}</text>
        </g>
      )}
    </g>
  );
}

/* ================= 流程结点 ================= */
function flowShapePath(f: FlatFlowNode): { d?: string; rect?: boolean } {
  const { x, y, w, h } = f; const n = f.n;
  if (n.kind === 'decision') return { d: `M ${x + w / 2} ${y} L ${x + w} ${y + h / 2} L ${x + w / 2} ${y + h} L ${x} ${y + h / 2} Z` };
  if (n.kind === 'start') return { d: `M ${x + h / 2} ${y} H ${x + w - h / 2} A ${h / 2} ${h / 2} 0 0 1 ${x + w - h / 2} ${y + h} H ${x + h / 2} A ${h / 2} ${h / 2} 0 0 1 ${x + h / 2} ${y} Z` };
  if (n.kind === 'io') { const o = Math.min(20, w * 0.18); return { d: `M ${x + o} ${y} H ${x + w} L ${x + w - o} ${y + h} H ${x} Z` }; }
  return { rect: true };
}
function FlowNodeView({ f, theme, selected, glow, onDown, onExpand, onRename, onHover }: {
  f: FlatFlowNode; theme: 'light' | 'dark'; selected: boolean; glow?: boolean;
  onDown: (e: React.PointerEvent) => void; onExpand: () => void; onRename: () => void; onHover: (h: boolean) => void;
}) {
  const th = THEME[theme];
  const n = f.n;
  const { fill, stroke } = resolveShapeColor(n.color, n.fill, n.stroke, theme);
  const textColor = readableOn(fill);
  const fp = flowShapePath(f);
  const isSub = n.kind === 'subprocess';
  const innerCount = n.inner?.nodes.length ?? 0;
  return (
    <g data-el="1" onPointerDown={onDown}
      onDoubleClick={(e) => { if (isSub) { e.stopPropagation(); onExpand(); } else { e.stopPropagation(); onRename(); } }}
      onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)} style={{ cursor: 'move' }}>
      {glow && (
        <rect x={f.x - 7} y={f.y - 7} width={f.w + 14} height={f.h + 14} rx={16} fill="none" stroke={th.sel} strokeWidth={9}>
          <animate attributeName="opacity" values="0.4;0.95;0.4" dur="0.9s" repeatCount="indefinite" />
        </rect>
      )}
      {selected && !glow && <rect x={f.x - 4} y={f.y - 4} width={f.w + 8} height={f.h + 8} rx={13} fill="none" stroke={th.selGlow} strokeWidth={5} />}
      {fp.rect
        ? <rect x={f.x} y={f.y} width={f.w} height={f.h} rx={10} fill={fill} stroke={selected ? th.sel : stroke} strokeWidth={selected ? 2.2 : 1.6} strokeDasharray={isSub ? '5 3' : undefined} />
        : <path d={fp.d} fill={fill} stroke={selected ? th.sel : stroke} strokeWidth={selected ? 2.2 : 1.6} strokeLinejoin="round" />}
      {isSub && <rect x={f.x + 4} y={f.y + 4} width={f.w - 8} height={f.h - 8} rx={7} fill="none" stroke={stroke} strokeWidth={1.1} opacity={0.75} />}
      <text x={f.x + f.w / 2} y={f.y + f.h / 2 + 1} textAnchor="middle" dominantBaseline="middle"
        fontSize={12.5} fontWeight={600} fill={textColor} fontFamily={FONT_STACK}>{n.text}</text>
      {isSub && (
        <g onPointerDown={(e) => { e.stopPropagation(); onExpand(); }} style={{ cursor: 'pointer' }}>
          <rect x={f.x + f.w - 34} y={f.y + 6} width={28} height={18} rx={9} fill={stroke} opacity={0.9} />
          <text x={f.x + f.w - 20} y={f.y + 16} textAnchor="middle" dominantBaseline="middle" fontSize={10} fontWeight={700} fill="#fff" fontFamily={FONT_STACK}>
            {n.expanded ? '−' : `+${innerCount}`}
          </text>
        </g>
      )}
    </g>
  );
}

/* ================= 子流程浮动面板 ================= */
function PanelView({ pn, theme, selected, glow, onDownPanel, onSelect, onCollapse }: {
  pn: FlatPanel; theme: 'light' | 'dark'; selected: boolean; glow?: boolean;
  onDownPanel: (e: React.PointerEvent) => void; onSelect: () => void; onCollapse: () => void;
}) {
  const th = THEME[theme];
  const n = pn.n;
  const { fill, stroke } = resolveShapeColor(n.color, n.fill, n.stroke, theme);
  const innerCount = n.inner?.nodes.length ?? 0;
  return (
    <g data-el="1">
      {glow && (
        <rect x={pn.x - 7} y={pn.y - 7} width={pn.w + 14} height={pn.h + 14} rx={17} fill="none" stroke={th.sel} strokeWidth={10}>
          <animate attributeName="opacity" values="0.35;0.9;0.35" dur="0.9s" repeatCount="indefinite" />
        </rect>
      )}
      {selected && !glow && <rect x={pn.x - 5} y={pn.y - 5} width={pn.w + 10} height={pn.h + 10} rx={15} fill="none" stroke={th.selGlow} strokeWidth={5} />}
      <rect x={pn.x} y={pn.y} width={pn.w} height={pn.h} rx={12} fill={fill} opacity={glow ? 0.30 : 0.16}
        stroke={glow || selected ? th.sel : stroke} strokeWidth={glow ? 2.6 : selected ? 2.2 : 1.4} strokeDasharray="6 4" pointerEvents="none" />
      <g onPointerDown={(e) => { onDownPanel(e); onSelect(); }} style={{ cursor: 'move' }}>
        <path d={`M ${pn.x + 12} ${pn.y} H ${pn.x + pn.w - 12} A 12 12 0 0 1 ${pn.x + pn.w} ${pn.y + 12} V ${pn.y + C_HEADER} H ${pn.x} V ${pn.y + 12} A 12 12 0 0 1 ${pn.x + 12} ${pn.y} Z`}
          fill={fill} stroke={selected ? th.sel : stroke} strokeWidth={selected ? 2.2 : 1.4} />
        <rect x={pn.x + 9} y={pn.y + 9} width={3} height={C_HEADER - 18} rx={1.5} fill={stroke} opacity={0.9} />
        <text x={pn.x + 18} y={pn.y + C_HEADER / 2 + 1} dominantBaseline="middle" fontSize={12.5} fontWeight={800}
          fill={readableOn(fill)} fontFamily={FONT_STACK}>{n.text || '子流程'}</text>
        <text x={pn.x + pn.w - 66} y={pn.y + C_HEADER / 2 + 1} dominantBaseline="middle" fontSize={10} fontWeight={600}
          fill={readableOn(fill)} opacity={0.8} fontFamily={FONT_STACK}>{innerCount} 节点</text>
        <g onPointerDown={(e) => { e.stopPropagation(); onCollapse(); }} style={{ cursor: 'pointer' }}>
          <rect x={pn.x + pn.w - 30} y={pn.y + 8} width={20} height={18} rx={6} fill={stroke} opacity={0.85} />
          <text x={pn.x + pn.w - 20} y={pn.y + 18} textAnchor="middle" dominantBaseline="middle" fontSize={12} fontWeight={700} fill="#fff">−</text>
        </g>
      </g>
    </g>
  );
}

/* ================= 白板形状 ================= */
function WbShapeView({ w, theme, selected, onDown, onRename }: {
  w: WbShape; theme: 'light' | 'dark'; selected: boolean;
  onDown: (e: React.PointerEvent) => void; onRename: () => void;
}) {
  const th = THEME[theme];
  const { fill, stroke } = resolveShapeColor(w.color, w.fill, w.stroke, theme);
  const strokeColor = selected ? th.sel : stroke;
  const common = { onPointerDown: onDown, style: { cursor: 'move' } as const };
  if (w.kind === 'image' && w.src) {
    return (
      <g data-el="1" {...common}>
        {selected && <rect x={w.x - 4} y={w.y - 4} width={w.w + 8} height={w.h + 8} rx={10} fill="none" stroke={th.selGlow} strokeWidth={5} />}
        <image href={w.src} x={w.x} y={w.y} width={Math.abs(w.w)} height={Math.abs(w.h)} preserveAspectRatio="none" />
        <rect x={w.x} y={w.y} width={Math.abs(w.w)} height={Math.abs(w.h)} fill="none" stroke={selected ? th.sel : 'transparent'} strokeWidth={2} rx={8} />
      </g>
    );
  }
  if (w.kind === 'rect') {
    return (
      <g data-el="1" {...common}>
        {selected && <rect x={w.x - 4} y={w.y - 4} width={Math.abs(w.w) + 8} height={Math.abs(w.h) + 8} rx={12} fill="none" stroke={th.selGlow} strokeWidth={5} />}
        <rect x={w.x} y={w.y} width={Math.abs(w.w)} height={Math.abs(w.h)} rx={9} fill={fill} stroke={strokeColor} strokeWidth={selected ? 2.2 : w.strokeWidth} />
      </g>
    );
  }
  if (w.kind === 'ellipse') {
    return (
      <g data-el="1" {...common}>
        {selected && <ellipse cx={w.x + w.w / 2} cy={w.y + w.h / 2} rx={Math.abs(w.w) / 2 + 4} ry={Math.abs(w.h) / 2 + 4} fill="none" stroke={th.selGlow} strokeWidth={5} />}
        <ellipse cx={w.x + w.w / 2} cy={w.y + w.h / 2} rx={Math.abs(w.w) / 2} ry={Math.abs(w.h) / 2} fill={fill} stroke={strokeColor} strokeWidth={selected ? 2.2 : w.strokeWidth} />
      </g>
    );
  }
  if (w.kind === 'arrow' || w.kind === 'line') {
    const x2 = w.x + w.w, y2 = w.y + w.h;
    const ang = Math.atan2(y2 - w.y, x2 - w.x);
    return (
      <g data-el="1" {...common}>
        <line x1={w.x} y1={w.y} x2={x2} y2={y2} stroke={strokeColor} strokeWidth={selected ? w.strokeWidth + 1 : w.strokeWidth} strokeLinecap="round" />
        <line x1={w.x} y1={w.y} x2={x2} y2={y2} stroke="transparent" strokeWidth={16} />
        {w.kind === 'arrow' && <polygon points={arrowPoints(x2, y2, ang, 14)} fill={strokeColor} />}
      </g>
    );
  }
  if (w.kind === 'text') {
    const lines = (w.text || '').split('\n');
    return (
      <g data-el="1" {...common} onDoubleClick={(e) => { e.stopPropagation(); onRename(); }}>
        {selected && <rect x={w.x - 4} y={w.y - 4} width={w.w + 8} height={w.h + 8} rx={8} fill="none" stroke={th.selGlow} strokeWidth={4} />}
        {lines.map((ln, i) => (
          <text key={i} x={w.x + w.w / 2} y={w.y + 18 + i * 18} textAnchor="middle" fontSize={13} fontWeight={600}
            fill={theme === 'dark' ? '#e5ebf3' : '#1b2430'} fontFamily={FONT_STACK}>{ln}</text>
        ))}
      </g>
    );
  }
  return null;
}
