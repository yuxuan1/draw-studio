/* ============================================================
 * 统一画布（多页面）
 * · 画布页：状态机 + 流程图（含可展开子流程容器），同类型自由连线
 * · 白板页：图片 + 叠加形状
 * · 共享：平移 / 缩放 / 网格 / 小地图 / 选择 / 拖拽 / 导出
 * ============================================================ */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStudio } from '../studioStore';
import { PALETTES, THEME, GRID_SNAP, FONT_STACK, actionLines } from '../lib/core';
import type { ProjectDoc, ProjectState, ProjectTransition } from '../lib/core';
import type { Page } from '../lib/studio';
import { shapesOf, computeEdgeGeoms, arrowPoints } from '../lib/geometry';
import type { EdgeGeom } from '../lib/geometry';
import {
  flattenFlow, mapFlowLevel, updateFlowNode, findFlowNode, layoutFlowGraph,
  makeFlowNode, makeWbShape, makeSmState, nid, C_HEADER,
} from '../lib/studio';
import type { FlowKind, FlatFlowNode, WbShape } from '../lib/studio';
import { wrapText, BkIcon, BI } from '../lib/boardkit';

interface View { x: number; y: number; k: number }

interface ConnEndpoint { family: 'state' | 'flow'; id: string; path: string[]; x: number; y: number }

type Drag =
  | { mode: 'pan'; sx: number; sy: number; ox: number; oy: number }
  | { mode: 'move-state'; id: string; swx: number; swy: number; base: Page }
  | { mode: 'move-flow'; id: string; path: string[]; swx: number; swy: number; base: Page }
  | { mode: 'move-wb'; id: string; swx: number; swy: number; base: Page }
  | { mode: 'connect'; from: ConnEndpoint; x: number; y: number }
  | { mode: 'wb-draw'; id: string; sx: number; sy: number };

export function UnifiedCanvas() {
  const app = useStudio();
  const {
    doc, page, updatePage, beginBatch, endBatch, sel, setSel, tool, setTool,
    theme, fitSignal, toast,
  } = app;
  const settings = doc.settings;
  const th = THEME[theme];

  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [views, setViews] = useState<Record<string, View>>({});
  const view: View = views[page.id] ?? { x: 60, y: 40, k: 1 };
  const setView = (v: View) => setViews((m) => ({ ...m, [page.id]: v }));
  const [size, setSize] = useState({ w: 900, h: 600 });
  const [hoverEP, setHoverEP] = useState<ConnEndpoint | null>(null);
  const [connect, setConnect] = useState<null | { from: ConnEndpoint; x: number; y: number }>(null);
  const dragRef = useRef<Drag | null>(null);

  /* ---------- 尺寸监听 ---------- */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  /* ---------- 派生几何（画布页） ---------- */
  const smDoc = useMemo<ProjectDoc>(() => ({
    version: 1, name: page.name, settings,
    states: page.states,
    transitions: page.transitions.filter((t) => t.enabled),
  }), [page, settings]);
  const shapes = useMemo(() => shapesOf(smDoc, settings), [smDoc, settings]);
  const edges = useMemo(() => computeEdgeGeoms(smDoc, settings, theme), [smDoc, settings, theme]);
  const flat = useMemo(
    () => (page.type === 'canvas' ? flattenFlow(page.flowNodes, page.flowEdges) : { nodes: [] as FlatFlowNode[], edges: [] as ReturnType<typeof flattenFlow>['edges'] }),
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
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    const eat = (x: number, y: number, w: number, h: number) => {
      x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x + w); y2 = Math.max(y2, y + h);
    };
    if (page.type === 'canvas') {
      for (const s of page.states) { const sh = shapes.get(s.id); if (sh) eat(sh.x, sh.y, sh.w, sh.h); }
      for (const f of flat.nodes) eat(f.x, f.y, f.w, f.h);
    } else {
      for (const w of page.wbShapes) eat(w.x, w.y, Math.abs(w.w), Math.max(20, Math.abs(w.h)));
    }
    if (!isFinite(x1)) return { x: 0, y: 0, w: 800, h: 500 };
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }, [page, shapes, flat]);

  const fit = () => {
    const pad = 70;
    const k = Math.min(2, Math.max(0.15, Math.min((size.w - pad * 2) / Math.max(1, bounds.w), (size.h - pad * 2) / Math.max(1, bounds.h))));
    setView({ k, x: (size.w - bounds.w * k) / 2 - bounds.x * k, y: (size.h - bounds.h * k) / 2 - bounds.y * k });
  };
  const firstFit = useRef<string | null>(null);
  useEffect(() => {
    if (firstFit.current !== page.id && size.w > 0) { firstFit.current = page.id; fit(); }
    // eslint-disable-next-line
  }, [size.w, page.id]);
  useEffect(() => { if (fitSignal && size.w > 0) fit(); /* eslint-disable-next-line */ }, [fitSignal]);

  /* ---------- 注册导出 ---------- */
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

  /* ---------- 命中检测（连线目标） ---------- */
  const endpointAt = (w: { x: number; y: number }): ConnEndpoint | null => {
    if (page.type !== 'canvas') return null;
    for (const s of page.states) {
      const sh = shapes.get(s.id); if (!sh) continue;
      const hit = sh.isCircle
        ? Math.hypot(w.x - sh.cx, w.y - sh.cy) <= sh.r + 8
        : w.x >= sh.x - 4 && w.x <= sh.x + sh.w + 4 && w.y >= sh.y - 4 && w.y <= sh.y + sh.h + 4;
      if (hit) return { family: 'state', id: s.id, path: [], x: sh.cx, y: sh.cy };
    }
    for (let i = flat.nodes.length - 1; i >= 0; i--) {
      const f = flat.nodes[i];
      if (w.x >= f.x - 4 && w.x <= f.x + f.w + 4 && w.y >= f.y - 4 && w.y <= f.y + f.h + 4) {
        return { family: 'flow', id: f.n.id, path: f.path, x: f.x + f.w / 2, y: f.y + f.h / 2 };
      }
    }
    return null;
  };

  const connValid = (from: ConnEndpoint, to: ConnEndpoint | null): { ok: boolean; reason?: string } => {
    if (!to) return { ok: false };
    if (to.id === from.id) return { ok: false };
    if (to.family !== from.family) return { ok: false, reason: '状态机与流程图属于不同类型，不能连线' };
    if (to.family === 'flow' && to.path.join('/') !== from.path.join('/')) {
      return { ok: false, reason: '只能在同一层级（同一子流程内）连线' };
    }
    return { ok: true };
  };

  /* ---------- 缩放 ---------- */
  const onWheel = (e: React.WheelEvent) => {
    const p = pt(e);
    const wk = toWorld(p.x, p.y);
    const k = Math.min(2.5, Math.max(0.15, view.k * Math.exp(-e.deltaY * 0.0012)));
    setView({ k, x: p.x - wk.x * k, y: p.y - wk.y * k });
  };

  /* ---------- 工具落点 / 白板拖拽绘制 ---------- */
  const nextSmName = () => {
    const used = new Set(page.states.map((s) => s.name));
    let i = page.states.filter((s) => s.kind === 'state').length + 1;
    while (used.has(`State${i}`)) i++;
    return `State${i}`;
  };

  const place = (wx: number, wy: number) => {
    const snap = settings.snapToGrid ? GRID_SNAP : 1;
    const x = Math.round(wx / snap) * snap, y = Math.round(wy / snap) * snap;
    if (page.type === 'canvas' && tool.startsWith('sm-')) {
      const kind = tool === 'sm-terminal' ? 'terminal' : tool === 'sm-junction' ? 'junction' : 'state';
      const s = makeSmState(kind, x, y, kind === 'state' ? nextSmName() : kind === 'terminal' ? '结束' : '');
      updatePage((p) => ({ ...p, states: [...p.states, s] }));
      setSel({ kind: 'state', id: s.id });
    } else if (page.type === 'canvas' && tool.startsWith('flow-')) {
      const kindMap: Record<string, FlowKind> = {
        'flow-start': 'start', 'flow-process': 'process', 'flow-decision': 'decision',
        'flow-io': 'io', 'flow-subprocess': 'subprocess',
      };
      const n = makeFlowNode(kindMap[tool], x, y);
      updatePage((p) => ({ ...p, flowNodes: [...p.flowNodes, n] }));
      setSel({ kind: 'flow', id: n.id });
    } else if (page.type === 'whiteboard' && (tool === 'wb-text')) {
      const w = makeWbShape('text', x, y);
      updatePage((p) => ({ ...p, wbShapes: [...p.wbShapes, w] }));
      setSel({ kind: 'wb', id: w.id });
    }
    setTool('select');
  };

  const startWbDraw = (e: React.PointerEvent) => {
    const p = pt(e); const w = toWorld(p.x, p.y);
    const kindMap = { 'wb-rect': 'rect', 'wb-ellipse': 'ellipse', 'wb-arrow': 'arrow', 'wb-line': 'line' } as const;
    const shape = makeWbShape(kindMap[tool as keyof typeof kindMap], w.x, w.y);
    shape.w = 2; shape.h = kindMap[tool as keyof typeof kindMap] === 'arrow' || kindMap[tool as keyof typeof kindMap] === 'line' ? 0 : 2;
    updatePage((p) => ({ ...p, wbShapes: [...p.wbShapes, shape] }), false);
    setSel({ kind: 'wb', id: shape.id });
    dragRef.current = { mode: 'wb-draw', id: shape.id, sx: w.x, sy: w.y };
    capture(e);
  };

  /* ---------- 指针手势 ---------- */
  const onSvgPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const p = pt(e);
    if (tool !== 'select') {
      if (page.type === 'whiteboard' && tool !== 'wb-text') { startWbDraw(e); return; }
      const w = toWorld(p.x, p.y);
      place(w.x, w.y);
      return;
    }
    dragRef.current = { mode: 'pan', sx: p.x, sy: p.y, ox: view.x, oy: view.y };
    capture(e);
    setSel({ kind: null, id: null });
  };

  const startMove = (e: React.PointerEvent, d: Drag) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const p = pt(e); const w = toWorld(p.x, p.y);
    (d as { swx?: number }).swx = w.x;
    (d as { swy?: number }).swy = w.y;
    if (d.mode === 'move-state') setSel({ kind: 'state', id: d.id });
    if (d.mode === 'move-flow') setSel({ kind: 'flow', id: d.id });
    if (d.mode === 'move-wb') setSel({ kind: 'wb', id: d.id });
    beginBatch();
    dragRef.current = d;
    capture(e);
  };

  const startConnect = (e: React.PointerEvent, from: ConnEndpoint) => {
    e.stopPropagation();
    dragRef.current = { mode: 'connect', from, x: from.x, y: from.y };
    setConnect({ from, x: from.x, y: from.y });
    capture(e);
  };

  const onSvgPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current; if (!d) return;
    const p = pt(e);
    if (d.mode === 'pan') {
      setView({ ...view, x: d.ox + (p.x - d.sx), y: d.oy + (p.y - d.sy) });
    } else if (d.mode === 'move-state') {
      const w = toWorld(p.x, p.y);
      const snap = settings.snapToGrid ? GRID_SNAP : 1;
      const orig = d.base.states.find((s) => s.id === d.id); if (!orig) return;
      const nx = Math.round((orig.position.x + (w.x - d.swx)) / snap) * snap;
      const ny = Math.round((orig.position.y + (w.y - d.swy)) / snap) * snap;
      updatePage(() => ({ ...d.base, states: d.base.states.map((s) => (s.id === d.id ? { ...s, position: { x: nx, y: ny } } : s)) }), false);
    } else if (d.mode === 'move-flow') {
      const w = toWorld(p.x, p.y);
      const snap = settings.snapToGrid ? GRID_SNAP : 1;
      const r = mapFlowLevel(d.base.flowNodes, d.base.flowEdges, d.path, (f) => {
        const orig = f.nodes.find((n) => n.id === d.id); if (!orig) return f;
        const nx = Math.round((orig.x + (w.x - d.swx)) / snap) * snap;
        const ny = Math.round((orig.y + (w.y - d.swy)) / snap) * snap;
        return { ...f, nodes: f.nodes.map((n) => (n.id === d.id ? { ...n, x: nx, y: ny } : n)) };
      });
      updatePage(() => ({ ...d.base, flowNodes: r.nodes }), false);
    } else if (d.mode === 'move-wb') {
      const w = toWorld(p.x, p.y);
      const snap = settings.snapToGrid ? GRID_SNAP : 1;
      const orig = d.base.wbShapes.find((s) => s.id === d.id); if (!orig) return;
      const nx = Math.round((orig.x + (w.x - d.swx)) / snap) * snap;
      const ny = Math.round((orig.y + (w.y - d.swy)) / snap) * snap;
      updatePage(() => ({ ...d.base, wbShapes: d.base.wbShapes.map((s) => (s.id === d.id ? { ...s, x: nx, y: ny } : s)) }), false);
    } else if (d.mode === 'connect') {
      const w = toWorld(p.x, p.y);
      setConnect({ from: d.from, x: w.x, y: w.y });
    } else if (d.mode === 'wb-draw') {
      const w = toWorld(p.x, p.y);
      updatePage((pp) => ({
        ...pp,
        wbShapes: pp.wbShapes.map((s) => (s.id === d.id ? { ...s, w: w.x - d.sx, h: w.y - d.sy } : s)),
      }), false);
    }
  };

  const onSvgPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current; dragRef.current = null;
    if (!d) return;
    if (d.mode === 'move-state' || d.mode === 'move-flow' || d.mode === 'move-wb') endBatch();
    if (d.mode === 'wb-draw') {
      /* 规范化负尺寸；过小给默认值 */
      updatePage((pp) => ({
        ...pp,
        wbShapes: pp.wbShapes.map((s) => {
          if (s.id !== d.id) return s;
          let { x, y, w, h } = s;
          if (w < 0) { x += w; w = -w; }
          if (h < 0) { y += h; h = -h; }
          const isLine = s.kind === 'arrow' || s.kind === 'line';
          if (w < 12 && h < 12 && !isLine) { w = 160; h = 100; }
          if (isLine && Math.hypot(w, h) < 12) { w = 160; h = 0; }
          return { ...s, x, y, w, h };
        }),
      }));
      setTool('select');
    }
    if (d.mode === 'connect') {
      const p = pt(e); const w = toWorld(p.x, p.y);
      const target = endpointAt(w);
      const v = connValid(d.from, target);
      if (target && v.ok) {
        if (d.from.family === 'state') {
          const t: ProjectTransition = { id: nid('t'), source: d.from.id, target: target.id, enabled: true };
          updatePage((pp) => ({ ...pp, transitions: [...pp.transitions, t] }));
          setSel({ kind: 'transition', id: t.id });
        } else {
          const fe = { id: nid('fe'), source: d.from.id, target: target.id };
          const r = mapFlowLevel(page.flowNodes, page.flowEdges, d.from.path, (f) => ({ ...f, edges: [...f.edges, fe] }));
          updatePage((pp) => ({ ...pp, flowNodes: r.nodes, flowEdges: r.edges }));
          setSel({ kind: 'flowEdge', id: fe.id });
        }
      } else if (target && v.reason) {
        toast(v.reason, 'err');
      }
      setConnect(null);
    }
  };

  /* ---------- 双击：空白新建 / 子流程展开 ---------- */
  const onDblClick = (e: React.MouseEvent) => {
    if ((e.target as Element).closest('[data-el]')) return;
    if (tool !== 'select') return;
    const p = pt(e); const w = toWorld(p.x, p.y);
    if (page.type === 'canvas') {
      const s = makeSmState('state', Math.round(w.x), Math.round(w.y), nextSmName());
      updatePage((pp) => ({ ...pp, states: [...pp.states, s] }));
      setSel({ kind: 'state', id: s.id });
    } else {
      const t = makeWbShape('text', Math.round(w.x), Math.round(w.y));
      updatePage((pp) => ({ ...pp, wbShapes: [...pp.wbShapes, t] }));
      setSel({ kind: 'wb', id: t.id });
    }
  };

  const toggleSub = (id: string) => {
    const n = findFlowNode(page.flowNodes, id);
    if (!n || n.kind !== 'subprocess') return;
    const willExpand = !n.expanded;
    updatePage((p) => ({
      ...p,
      flowNodes: updateFlowNode(p.flowNodes, id, {
        expanded: willExpand,
        inner: willExpand && n.inner && n.inner.nodes.length
          ? { ...n.inner, nodes: layoutFlowGraph(n.inner.nodes, n.inner.edges, p.flowDir) }
          : n.inner,
      }),
    }));
  };

  /* ---------- 选中框 / 缩放手柄 ---------- */
  const selFlat = useMemo(
    () => (sel.kind === 'flow' && sel.id ? flat.nodes.find((f) => f.n.id === sel.id) ?? null : null),
    [sel, flat],
  );
  const resizeTarget = useMemo(() => {
    if (sel.kind === 'wb') return page.wbShapes.find((w) => w.id === sel.id) ?? null;
    if (sel.kind === 'flow') return selFlat;
    return null;
  }, [sel, page, selFlat]);

  const onResize = (dw: number, dh: number) => {
    if (!resizeTarget || !sel.id) return;
    const dwW = dw / view.k, dhW = dh / view.k;
    if (sel.kind === 'wb') {
      const wbKind = (resizeTarget as WbShape).kind;
      const isLine = wbKind === 'line' || wbKind === 'arrow';
      updatePage((p) => ({
        ...p,
        wbShapes: p.wbShapes.map((w) => (w.id === sel.id
          ? { ...w, w: Math.max(8, w.w + dwW), h: isLine ? w.h + dhW : Math.max(8, w.h + dhW) }
          : w)),
      }), false);
    } else if (sel.kind === 'flow' && selFlat) {
      const minW = selFlat.n.kind === 'subprocess' ? 150 : 40;
      const minH = selFlat.n.kind === 'subprocess' ? 90 : 28;
      const r = mapFlowLevel(page.flowNodes, page.flowEdges, selFlat.path, (f) => ({
        ...f,
        nodes: f.nodes.map((n) => (n.id === sel.id
          ? { ...n, w: Math.max(minW, n.w + dwW), h: Math.max(minH, n.h + dhW) }
          : n)),
      }));
      updatePage((p) => ({ ...p, flowNodes: r.nodes }), false);
    }
  };

  const selBox = useMemo(() => {
    if (sel.kind === 'state' && sel.id) { const sh = shapes.get(sel.id); return sh ? { x: sh.x, y: sh.y, w: sh.w, h: sh.h } : null; }
    if (sel.kind === 'flow' && selFlat) return { x: selFlat.x, y: selFlat.y, w: selFlat.w, h: selFlat.h };
    if (sel.kind === 'wb' && sel.id) {
      const w = page.wbShapes.find((x) => x.id === sel.id);
      return w ? { x: Math.min(w.x, w.x + w.w), y: Math.min(w.y, w.y + w.h), w: Math.abs(w.w), h: Math.max(10, Math.abs(w.h)) } : null;
    }
    return null;
  }, [sel, shapes, selFlat, page]);

  /* ---------- 连线手柄 ---------- */
  const handles = useMemo(() => {
    if (page.type !== 'canvas' || tool !== 'select') return [] as ConnEndpoint[];
    const out: ConnEndpoint[] = [];
    const push = (ep: ConnEndpoint) => {
      const active = (hoverEP && hoverEP.id === ep.id) || (sel.kind !== 'transition' && sel.kind !== 'flowEdge' && sel.id === ep.id);
      if (active) out.push(ep);
    };
    for (const s of page.states) {
      const sh = shapes.get(s.id); if (!sh) continue;
      push({ family: 'state', id: s.id, path: [], x: sh.x + sh.w + 2, y: sh.cy });
    }
    for (const f of flat.nodes) {
      const anchor = page.flowDir === 'LR'
        ? { x: f.x + f.w + 2, y: f.y + f.h / 2 }
        : { x: f.x + f.w / 2, y: f.y + f.h + 2 };
      push({ family: 'flow', id: f.n.id, path: f.path, ...anchor });
    }
    return out;
  }, [page, shapes, flat, hoverEP, sel, tool]);

  const connectTarget = connect ? endpointAt({ x: connect.x, y: connect.y }) : null;
  const connectOk = connect ? connValid(connect.from, connectTarget) : { ok: false };

  const isEmpty = page.type === 'canvas'
    ? !page.states.length && !page.flowNodes.length
    : !page.wbShapes.length;

  return (
    <div ref={wrapRef} className="relative flex-1 min-w-0 overflow-hidden" style={{ background: th.canvas }}>
      <svg
        ref={svgRef}
        className="w-full h-full block touch-none"
        style={{ cursor: tool === 'select' ? 'default' : 'crosshair' }}
        onPointerDown={onSvgPointerDown}
        onPointerMove={onSvgPointerMove}
        onPointerUp={onSvgPointerUp}
        onWheel={onWheel}
        onDoubleClick={onDblClick}
        onMouseLeave={() => setHoverEP(null)}
      >
        {settings.showGrid && (
          <>
            <defs>
              <pattern id="ugrid" width={24 * view.k} height={24 * view.k} patternUnits="userSpaceOnUse"
                patternTransform={`translate(${view.x} ${view.y})`}>
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
                onDown={(e) => startMove(e, { mode: 'move-wb', id: w.id, swx: 0, swy: 0, base: page })} />
            ))
          ) : (
            <>
              {/* 子流程容器（底层） */}
              {flat.nodes.filter((f) => f.n.kind === 'subprocess' && f.n.expanded).map((f) => (
                <ContainerView key={'c' + f.n.id} f={f} theme={theme}
                  selected={sel.kind === 'flow' && sel.id === f.n.id}
                  onDown={(e) => startMove(e, { mode: 'move-flow', id: f.n.id, path: f.path, swx: 0, swy: 0, base: page })}
                  onCollapse={() => toggleSub(f.n.id)}
                  onHover={(h) => setHoverEP(h ? { family: 'flow', id: f.n.id, path: f.path, x: f.x, y: f.y } : null)} />
              ))}
              {/* 流程连线 */}
              {flat.edges.map((fe) => (
                <FlowEdgeView key={fe.e.id} fe={fe} theme={theme}
                  selected={sel.kind === 'flowEdge' && sel.id === fe.e.id}
                  onSelect={() => setSel({ kind: 'flowEdge', id: fe.e.id })} />
              ))}
              {/* 流程结点（非展开容器） */}
              {flat.nodes.filter((f) => !(f.n.kind === 'subprocess' && f.n.expanded)).map((f) => (
                <FlowNodeView key={f.n.id} f={f} theme={theme}
                  selected={sel.kind === 'flow' && sel.id === f.n.id}
                  onDown={(e) => startMove(e, { mode: 'move-flow', id: f.n.id, path: f.path, swx: 0, swy: 0, base: page })}
                  onExpand={() => toggleSub(f.n.id)}
                  onHover={(h) => setHoverEP(h ? { family: 'flow', id: f.n.id, path: f.path, x: f.x, y: f.y } : null)} />
              ))}
              {/* 状态转移 */}
              {edges.map((g) => (
                <EdgeView key={g.id} g={g} theme={theme} arrowSize={settings.arrowSize}
                  selected={sel.kind === 'transition' && sel.id === g.id}
                  onSelect={() => setSel({ kind: 'transition', id: g.id })} />
              ))}
              {/* 状态结点 */}
              {page.states.map((s) => {
                const sh = shapes.get(s.id); if (!sh) return null;
                return (
                  <StateView key={s.id} s={s} sh={sh} theme={theme} showActions={settings.showActionText}
                    selected={sel.kind === 'state' && sel.id === s.id}
                    onDown={(e) => startMove(e, { mode: 'move-state', id: s.id, swx: 0, swy: 0, base: page })}
                    onHover={(h) => setHoverEP(h ? { family: 'state', id: s.id, path: [], x: sh.cx, y: sh.cy } : null)} />
                );
              })}
              {/* 连接手柄 */}
              {handles.map((h) => (
                <circle key={h.family + h.id} cx={h.x} cy={h.y} r={7} fill={th.sel}
                  stroke="#fff" strokeWidth={1.5} style={{ cursor: 'crosshair' }}
                  data-noexport="1"
                  onPointerDown={(e) => startConnect(e, h)} />
              ))}
              {/* 连线临时线 */}
              {connect && (
                <g data-noexport="1">
                  <line x1={connect.from.x} y1={connect.from.y} x2={connect.x} y2={connect.y}
                    stroke={connectTarget ? (connectOk.ok ? th.sel : '#ef4444') : th.sel}
                    strokeWidth={2} strokeDasharray="7 5" opacity={0.9} />
                  <circle cx={connect.x} cy={connect.y} r={4}
                    fill={connectTarget ? (connectOk.ok ? th.sel : '#ef4444') : th.sel} />
                </g>
              )}
            </>
          )}
        </g>

        {selBox && sel.kind !== 'transition' && sel.kind !== 'flowEdge' && (
          <SelOverlay box={selBox} toScreen={toScreen} k={view.k} color={th.sel}
            resizable={!!resizeTarget} onResizeBegin={beginBatch} onResize={onResize} onResizeEnd={endBatch} />
        )}
      </svg>

      {isEmpty && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center px-6 py-5 rounded-2xl" style={{ background: 'color-mix(in srgb, var(--panel) 82%, transparent)', border: '1px dashed var(--border-strong)' }}>
            <div className="text-[15px] font-bold mb-1" style={{ color: 'var(--text)' }}>
              {page.type === 'canvas' ? '空画布页' : '空白板页'}
            </div>
            <div className="text-[12px] leading-5" style={{ color: 'var(--muted)' }}>
              {page.type === 'canvas'
                ? <>双击空白新建状态 · 左侧选择工具放置流程图元素<br />悬停元素拖出圆点即可连线（同类型之间）</>
                : <>左侧点击「插入图片」作为底图<br />再用形状工具在图片上叠加标注 · 双击空白添加文字</>}
            </div>
          </div>
        </div>
      )}

      {settings.showMiniMap && (
        <MiniMap bounds={bounds} view={view} size={size} theme={theme} page={page}
          shapes={shapes} flat={flat.nodes}
          onJump={(wx, wy) => setView({ ...view, x: size.w / 2 - wx * view.k, y: size.h / 2 - wy * view.k })} />
      )}
      <ZoomCtl view={view} setView={setView} fit={fit} />
    </div>
  );
}

/* ============================================================
 * 子渲染组件
 * ============================================================ */

function StateView({ s, sh, theme, showActions, selected, onDown, onHover }: {
  s: ProjectState; sh: { x: number; y: number; w: number; h: number; cx: number; cy: number; isCircle: boolean; r: number };
  theme: 'light' | 'dark'; showActions: boolean; selected: boolean;
  onDown: (e: React.PointerEvent) => void; onHover: (h: boolean) => void;
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
        <circle cx={sh.cx} cy={sh.cy} r={sh.r} fill={th.junctionFill} stroke={selected ? th.sel : th.junctionBorder} strokeWidth={selected ? 2.5 : 2} />
      </g>
    );
  }
  const lines = actionLines(s, showActions);
  return (
    <g data-el="1" onPointerDown={onDown} onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)} style={{ cursor: 'move' }}>
      {selected && <rect x={sh.x - 4} y={sh.y - 4} width={sh.w + 8} height={sh.h + 8} rx={14} fill="none" stroke={th.selGlow} strokeWidth={5} />}
      <rect x={sh.x} y={sh.y} width={sh.w} height={sh.h} rx={11}
        fill={pal.fill} stroke={selected ? th.sel : pal.border} strokeWidth={selected ? 2.2 : 1.5} />
      {s.kind === 'terminal' && (
        <rect x={sh.x + 4} y={sh.y + 4} width={sh.w - 8} height={sh.h - 8} rx={8} fill="none" stroke={pal.border} strokeWidth={1.2} />
      )}
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

function EdgeView({ g, theme, arrowSize, selected, onSelect }: {
  g: EdgeGeom; theme: 'light' | 'dark'; arrowSize: number; selected: boolean; onSelect: () => void;
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
    </g>
  );
}

/* ---------- 流程结点形状路径 ---------- */
function flowShapePath(f: FlatFlowNode): { d?: string; rect?: boolean } {
  const { x, y, w, h } = f;
  const n = f.n;
  if (n.kind === 'decision') {
    return { d: `M ${x + w / 2} ${y} L ${x + w} ${y + h / 2} L ${x + w / 2} ${y + h} L ${x} ${y + h / 2} Z` };
  }
  if (n.kind === 'start') {
    return { d: `M ${x + h / 2} ${y} H ${x + w - h / 2} A ${h / 2} ${h / 2} 0 0 1 ${x + w - h / 2} ${y + h} H ${x + h / 2} A ${h / 2} ${h / 2} 0 0 1 ${x + h / 2} ${y} Z` };
  }
  if (n.kind === 'io') {
    const o = Math.min(20, w * 0.18);
    return { d: `M ${x + o} ${y} H ${x + w} L ${x + w - o} ${y + h} H ${x} Z` };
  }
  return { rect: true };
}

function FlowNodeView({ f, theme, selected, onDown, onExpand, onHover }: {
  f: FlatFlowNode; theme: 'light' | 'dark'; selected: boolean;
  onDown: (e: React.PointerEvent) => void; onExpand: () => void; onHover: (h: boolean) => void;
}) {
  const th = THEME[theme];
  const n = f.n;
  const fp = flowShapePath(f);
  const lines = wrapText(n.text || ' ', Math.max(40, f.w - 24), 12.5);
  const cx = f.x + f.w / 2, cy = f.y + f.h / 2;
  const startY = cy - ((lines.length - 1) * 16) / 2;
  const innerCount = n.inner ? n.inner.nodes.length : 0;
  return (
    <g data-el="1" onPointerDown={onDown} onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)} style={{ cursor: 'move' }}
      onDoubleClick={(e) => { if (n.kind === 'subprocess') { e.stopPropagation(); onExpand(); } }}>
      {selected && <rect x={f.x - 4} y={f.y - 4} width={f.w + 8} height={f.h + 8} rx={13} fill="none" stroke={th.selGlow} strokeWidth={5} />}
      {fp.rect
        ? <rect x={f.x} y={f.y} width={f.w} height={f.h} rx={10} fill={n.fill} stroke={selected ? th.sel : n.stroke} strokeWidth={selected ? 2.2 : 1.6} />
        : <path d={fp.d} fill={n.fill} stroke={selected ? th.sel : n.stroke} strokeWidth={selected ? 2.2 : 1.6} strokeLinejoin="round" />}
      {n.kind === 'subprocess' && (
        <rect x={f.x + 4} y={f.y + 4} width={f.w - 8} height={f.h - 8} rx={7} fill="none" stroke={n.stroke} strokeWidth={1.1} opacity={0.75} />
      )}
      {lines.map((ln, i) => (
        <text key={i} x={cx} y={startY + i * 16} textAnchor="middle" dominantBaseline="middle"
          fontSize={12.5} fontWeight={600} fill={th.edgeLabelText} fontFamily={FONT_STACK}>{ln}</text>
      ))}
      {n.kind === 'subprocess' && (
        <g style={{ cursor: 'pointer' }} onPointerDown={(e) => { e.stopPropagation(); onExpand(); }} data-noexport="1">
          <circle cx={f.x + f.w - 2} cy={f.y + 2} r={9} fill={n.stroke} stroke="#fff" strokeWidth={1.2} />
          <text x={f.x + f.w - 2} y={f.y + 2.5} textAnchor="middle" dominantBaseline="middle" fontSize={10} fontWeight={800} fill="#fff">
            {innerCount > 0 ? `+${innerCount}` : '+'}
          </text>
        </g>
      )}
    </g>
  );
}

function ContainerView({ f, theme, selected, onDown, onCollapse, onHover }: {
  f: FlatFlowNode; theme: 'light' | 'dark'; selected: boolean;
  onDown: (e: React.PointerEvent) => void; onCollapse: () => void; onHover: (h: boolean) => void;
}) {
  const th = THEME[theme];
  const n = f.n;
  const innerCount = n.inner ? n.inner.nodes.length : 0;
  return (
    <g data-el="1" onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)}>
      {selected && <rect x={f.x - 4} y={f.y - 4} width={f.w + 8} height={f.h + 8} rx={14} fill="none" stroke={th.selGlow} strokeWidth={5} />}
      {/* 容器主体（可拖拽） */}
      <g onPointerDown={onDown} style={{ cursor: 'move' }}>
        <rect x={f.x} y={f.y} width={f.w} height={f.h} rx={12} fill={n.fill} opacity={0.32}
          stroke={selected ? th.sel : n.stroke} strokeWidth={selected ? 2.2 : 1.4} strokeDasharray="6 4" />
        <rect x={f.x + 3} y={f.y + 3} width={f.w - 6} height={f.h - 6} rx={9} fill="none" stroke={n.stroke} strokeWidth={1} opacity={0.5} />
        {/* 头部 */}
        <path d={`M ${f.x + 12} ${f.y} H ${f.x + f.w - 12} A 12 12 0 0 1 ${f.x + f.w} ${f.y + 12} V ${f.y + C_HEADER} H ${f.x} V ${f.y + 12} A 12 12 0 0 1 ${f.x + 12} ${f.y} Z`}
          fill={n.fill} stroke={selected ? th.sel : n.stroke} strokeWidth={selected ? 2.2 : 1.4} />
        <rect x={f.x + 9} y={f.y + 9} width={3} height={C_HEADER - 18} rx={1.5} fill={n.stroke} opacity={0.9} />
        <text x={f.x + 18} y={f.y + C_HEADER / 2 + 1} dominantBaseline="middle" fontSize={12.5} fontWeight={800}
          fill={th.edgeLabelText} fontFamily={FONT_STACK}>
          {n.text || '子流程'}
        </text>
        <text x={f.x + f.w - 66} y={f.y + C_HEADER / 2 + 1} dominantBaseline="middle" fontSize={10} fontWeight={600}
          fill={th.muted} fontFamily={FONT_STACK}>{innerCount} 节点</text>
      </g>
      {/* 收纳按钮 */}
      <g style={{ cursor: 'pointer' }} onPointerDown={(e) => { e.stopPropagation(); onCollapse(); }} data-noexport="1">
        <circle cx={f.x + f.w - 16} cy={f.y + C_HEADER / 2} r={9} fill={n.stroke} stroke="#fff" strokeWidth={1.2} />
        <text x={f.x + f.w - 16} y={f.y + C_HEADER / 2 + 0.5} textAnchor="middle" dominantBaseline="middle" fontSize={11} fontWeight={800} fill="#fff">−</text>
      </g>
    </g>
  );
}

function FlowEdgeView({ fe, theme, selected, onSelect }: {
  fe: { e: { id: string; source: string; target: string; label?: string }; a: FlatFlowNode; b: FlatFlowNode };
  theme: 'light' | 'dark'; selected: boolean; onSelect: () => void;
}) {
  const th = THEME[theme];
  const color = selected ? th.sel : th.edge;
  const ac = { x: fe.a.x + fe.a.w / 2, y: fe.a.y + fe.a.h / 2 };
  const bc = { x: fe.b.x + fe.b.w / 2, y: fe.b.y + fe.b.h / 2 };
  const anchor = (f: FlatFlowNode, toward: { x: number; y: number }) => {
    const cx = f.x + f.w / 2, cy = f.y + f.h / 2;
    const dx = toward.x - cx, dy = toward.y - cy;
    if (!dx && !dy) return { x: cx, y: cy };
    const t = Math.min(
      Math.abs(dx) < 1e-6 ? 1e6 : (f.w / 2) / Math.abs(dx),
      Math.abs(dy) < 1e-6 ? 1e6 : (f.h / 2) / Math.abs(dy),
    );
    return { x: cx + dx * t, y: cy + dy * t };
  };
  const a = anchor(fe.a, bc);
  const b = anchor(fe.b, ac);
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const self = fe.e.source === fe.e.target;
  const d = self
    ? `M ${fe.a.x + 14} ${fe.a.y} C ${fe.a.x - 34} ${fe.a.y - 60}, ${fe.a.x + fe.a.w + 34} ${fe.a.y - 60}, ${fe.a.x + fe.a.w - 14} ${fe.a.y}`
    : `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
  const arrow = self
    ? arrowPoints(fe.a.x + fe.a.w - 14, fe.a.y, Math.atan2(1, 0.3), 12)
    : arrowPoints(b.x, b.y, ang, 12);
  const label = fe.e.label;
  return (
    <g data-el="1" style={{ cursor: 'pointer' }} onPointerDown={(e) => { e.stopPropagation(); onSelect(); }}>
      {selected && <path d={d} fill="none" stroke={th.selGlow} strokeWidth={7} strokeLinecap="round" />}
      <path d={d} fill="none" stroke={color} strokeWidth={selected ? 2.2 : 1.6} />
      <path d={d} fill="none" stroke="transparent" strokeWidth={16} />
      <polygon points={arrow} fill={color} />
      {label && (
        <g>
          <rect x={mx - (label.length * 7 + 14)} y={my - 11} width={label.length * 14 + 28} height={22} rx={7}
            fill={th.edgeLabelBg} stroke={selected ? th.sel : th.edgeLabelBorder} strokeWidth={selected ? 1.4 : 1} />
          <text x={mx} y={my + 1} textAnchor="middle" dominantBaseline="middle" fontSize={11}
            fontWeight={selected ? 700 : 500} fill={th.edgeLabelText} fontFamily={FONT_STACK}>{label}</text>
        </g>
      )}
    </g>
  );
}

function WbShapeView({ w, theme, selected, onDown }: {
  w: WbShape; theme: 'light' | 'dark'; selected: boolean;
  onDown: (e: React.PointerEvent) => void;
}) {
  const th = THEME[theme];
  const stroke = selected ? th.sel : w.stroke;
  const common = { onPointerDown: onDown, style: { cursor: 'move' as const } };
  if (w.kind === 'image') {
    return (
      <g data-el="1" {...common}>
        {selected && <rect x={w.x - 4} y={w.y - 4} width={w.w + 8} height={w.h + 8} fill="none" stroke={th.selGlow} strokeWidth={5} />}
        <image href={w.src} x={w.x} y={w.y} width={Math.abs(w.w)} height={Math.abs(w.h)} preserveAspectRatio="none" />
        <rect x={w.x} y={w.y} width={Math.abs(w.w)} height={Math.abs(w.h)} fill="none" stroke={stroke} strokeWidth={selected ? 2.2 : 1.2} rx={8} />
      </g>
    );
  }
  if (w.kind === 'rect') {
    const lines = w.text ? wrapText(w.text, Math.max(30, Math.abs(w.w) - 16), 12) : [];
    const startY = w.y + w.h / 2 - ((lines.length - 1) * 15) / 2;
    return (
      <g data-el="1" {...common}>
        {selected && <rect x={w.x - 4} y={w.y - 4} width={Math.abs(w.w) + 8} height={Math.abs(w.h) + 8} rx={12} fill="none" stroke={th.selGlow} strokeWidth={5} />}
        <rect x={w.x} y={w.y} width={Math.abs(w.w)} height={Math.abs(w.h)} rx={9} fill={w.fill} stroke={stroke} strokeWidth={selected ? 2.2 : w.strokeWidth} />
        {lines.map((ln, i) => (
          <text key={i} x={w.x + w.w / 2} y={startY + i * 15} textAnchor="middle" dominantBaseline="middle"
            fontSize={12} fontWeight={600} fill={th.edgeLabelText} fontFamily={FONT_STACK}>{ln}</text>
        ))}
      </g>
    );
  }
  if (w.kind === 'ellipse') {
    return (
      <g data-el="1" {...common}>
        {selected && <ellipse cx={w.x + w.w / 2} cy={w.y + w.h / 2} rx={Math.abs(w.w) / 2 + 4} ry={Math.abs(w.h) / 2 + 4} fill="none" stroke={th.selGlow} strokeWidth={5} />}
        <ellipse cx={w.x + w.w / 2} cy={w.y + w.h / 2} rx={Math.abs(w.w) / 2} ry={Math.abs(w.h) / 2} fill={w.fill} stroke={stroke} strokeWidth={selected ? 2.2 : w.strokeWidth} />
      </g>
    );
  }
  if (w.kind === 'arrow' || w.kind === 'line') {
    const x1 = w.x, y1 = w.y, x2 = w.x + w.w, y2 = w.y + w.h;
    const ang = Math.atan2(y2 - y1, x2 - x1);
    return (
      <g data-el="1" {...common}>
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={stroke} strokeWidth={selected ? w.strokeWidth + 1 : w.strokeWidth} strokeLinecap="round" />
        {w.kind === 'arrow' && <polygon points={arrowPoints(x2, y2, ang, 14)} fill={stroke} />}
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={16} />
      </g>
    );
  }
  const lines = wrapText(w.text || ' ', Math.max(30, Math.abs(w.w)), 13);
  return (
    <g data-el="1" {...common}>
      {selected && <rect x={w.x - 4} y={w.y - 4} width={Math.abs(w.w) + 8} height={Math.abs(w.h) + 8} rx={8} fill="none" stroke={th.selGlow} strokeWidth={4} />}
      {lines.map((ln, i) => (
        <text key={i} x={w.x} y={w.y + 14 + i * 17} fontSize={13} fontWeight={600} fill={th.edgeLabelText} fontFamily={FONT_STACK}>{ln}</text>
      ))}
    </g>
  );
}

/* ---------- 选中覆盖层 ---------- */
function SelOverlay({ box, toScreen, k, color, resizable, onResizeBegin, onResize, onResizeEnd }: {
  box: { x: number; y: number; w: number; h: number };
  toScreen: (x: number, y: number) => { x: number; y: number };
  k: number; color: string; resizable: boolean;
  onResizeBegin: () => void; onResize: (dw: number, dh: number) => void; onResizeEnd: () => void;
}) {
  const a = toScreen(box.x, box.y);
  const b = toScreen(box.x + box.w, box.y + box.h);
  const ref = useRef<null | { sx: number; sy: number }>(null);
  return (
    <g>
      <rect x={a.x - 3} y={a.y - 3} width={b.x - a.x + 6} height={b.y - a.y + 6} fill="none"
        stroke={color} strokeWidth={1.5} strokeDasharray="5 4" rx={4} pointerEvents="none" />
      {resizable && (
        <rect x={b.x - 5} y={b.y - 5} width={11} height={11} rx={3} fill="#fff" stroke={color} strokeWidth={1.5}
          style={{ cursor: 'nwse-resize' }}
          onPointerDown={(e) => {
            e.stopPropagation();
            (e.target as Element).setPointerCapture(e.pointerId);
            ref.current = { sx: e.clientX, sy: e.clientY };
            onResizeBegin();
          }}
          onPointerMove={(e) => {
            if (!ref.current) return;
            onResize(e.clientX - ref.current.sx, e.clientY - ref.current.sy);
            ref.current = { sx: e.clientX, sy: e.clientY };
          }}
          onPointerUp={() => { ref.current = null; onResizeEnd(); }}
        />
      )}
    </g>
  );
}

/* ---------- 小地图 ---------- */
function MiniMap({ bounds, view, size, theme, page, shapes, flat, onJump }: {
  bounds: { x: number; y: number; w: number; h: number }; view: View; size: { w: number; h: number };
  theme: 'light' | 'dark'; page: Page;
  shapes: Map<string, { x: number; y: number; w: number; h: number }>;
  flat: FlatFlowNode[]; onJump: (wx: number, wy: number) => void;
}) {
  const th = THEME[theme];
  const W = 150, H = 104, PAD = 10;
  const k = Math.min((W - PAD * 2) / Math.max(1, bounds.w), (H - PAD * 2) / Math.max(1, bounds.h));
  const ox = (W - bounds.w * k) / 2 - bounds.x * k;
  const oy = (H - bounds.h * k) / 2 - bounds.y * k;
  const vp = {
    x: ox + (-view.x / view.k) * k, y: oy + (-view.y / view.k) * k,
    w: (size.w / view.k) * k, h: (size.h / view.k) * k,
  };
  return (
    <div className="absolute left-3 bottom-3 rounded-xl overflow-hidden"
      style={{ background: 'color-mix(in srgb, var(--panel) 88%, transparent)', border: '1px solid var(--border)', boxShadow: 'var(--shadow)' }}>
      <svg width={W} height={H} style={{ display: 'block', cursor: 'pointer' }}
        onPointerDown={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          onJump((e.clientX - r.left - ox) / k, (e.clientY - r.top - oy) / k);
        }}>
        {page.type === 'canvas' ? (
          <>
            {flat.map((f) => <rect key={f.n.id} x={ox + f.x * k} y={oy + f.y * k} width={Math.max(2, f.w * k)} height={Math.max(2, f.h * k)} rx={2} fill={f.n.stroke} opacity={0.7} />)}
            {page.states.map((s) => { const sh = shapes.get(s.id); if (!sh) return null; return <rect key={s.id} x={ox + sh.x * k} y={oy + sh.y * k} width={Math.max(2, sh.w * k)} height={Math.max(2, sh.h * k)} rx={2} fill={th.edge} opacity={0.8} />; })}
          </>
        ) : (
          page.wbShapes.map((w) => <rect key={w.id} x={ox + w.x * k} y={oy + w.y * k} width={Math.max(2, Math.abs(w.w) * k)} height={Math.max(2, Math.abs(w.h) * k)} fill={w.stroke} opacity={0.5} />)
        )}
        <rect x={vp.x} y={vp.y} width={vp.w} height={vp.h} fill="none" stroke={th.sel} strokeWidth={1.5} rx={2} />
      </svg>
    </div>
  );
}

/* ---------- 缩放控件 ---------- */
function ZoomCtl({ view, setView, fit }: { view: View; setView: (v: View) => void; fit: () => void }) {
  const zoom = (f: number) => setView({ ...view, k: Math.min(2.5, Math.max(0.15, view.k * f)) });
  const btn = 'w-7 h-7 flex items-center justify-center rounded-md text-[13px] font-bold transition-colors hover:bg-[var(--panel)]';
  return (
    <div className="absolute right-3 bottom-3 flex items-center gap-0.5 px-1 py-1 rounded-xl"
      style={{ background: 'color-mix(in srgb, var(--panel) 88%, transparent)', border: '1px solid var(--border)', boxShadow: 'var(--shadow)', color: 'var(--text)' }}>
      <button className={btn} onClick={() => zoom(1 / 1.25)} title="缩小" aria-label="缩小">−</button>
      <button className="min-w-[46px] h-7 px-1 rounded-md text-[11px] font-semibold hover:bg-[var(--panel)]" onClick={fit} title="适应视图 (F)">
        {Math.round(view.k * 100)}%
      </button>
      <button className={btn} onClick={() => zoom(1.25)} title="放大" aria-label="放大">+</button>
      <div className="w-px h-4 mx-0.5" style={{ background: 'var(--border)' }} />
      <button className={btn} onClick={fit} title="适应视图" aria-label="适应视图"><BkIcon d={BI.fit} size={15} /></button>
    </div>
  );
}


