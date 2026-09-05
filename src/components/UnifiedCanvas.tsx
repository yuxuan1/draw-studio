/* ============================================================
 * 统一画布：状态机 + 流程图 + 白板 共存于同一 SVG
 * 共享平移 / 缩放 / 网格 / 小地图 / 选择 / 拖拽 / 连线
 * ============================================================ */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStudio } from '../studioStore';
import type { Sel } from '../studioStore';
import type { ProjectDoc, ProjectState, ProjectTransition } from '../lib/core';
import { PALETTES, THEME, GRID_SNAP, FONT_STACK, actionLines } from '../lib/core';
import { shapesOf, computeEdgeGeoms, arrowPoints } from '../lib/geometry';
import type { EdgeGeom } from '../lib/geometry';
import {
  hiddenDescendants, makeFlowNode, makeWbShape, makeSmState, nid, tidyFlow,
} from '../lib/studio';
import type { FlowNode, WbShape } from '../lib/studio';
import { wrapText, BkIcon, BI } from '../lib/boardkit';

interface View { x: number; y: number; k: number }

type Drag =
  | { mode: 'pan'; sx: number; sy: number; ox: number; oy: number }
  | { mode: 'move'; kind: 'state' | 'flow' | 'wb'; id: string; swx: number; swy: number; base: ReturnType<typeof useStudio>['doc'] }
  | { mode: 'connect'; from: string };

export function UnifiedCanvas() {
  const app = useStudio();
  const { doc, set, beginBatch, endBatch, sel, setSel, tool, setTool, theme, fitSignal } = app;
  const settings = doc.settings;

  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<View>({ x: 60, y: 40, k: 1 });
  const [size, setSize] = useState({ w: 900, h: 600 });
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [connect, setConnect] = useState<null | { from: string; x: number; y: number }>(null);
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

  /* ---------- 派生几何 ---------- */
  const smDoc = useMemo<ProjectDoc>(() => ({
    version: 1, name: doc.name, settings,
    states: doc.states,
    transitions: doc.transitions.filter((t) => t.enabled),
  }), [doc, settings]);

  const shapes = useMemo(() => shapesOf(smDoc, settings), [smDoc, settings]);
  const edges = useMemo(() => computeEdgeGeoms(smDoc, settings, theme), [smDoc, settings, theme]);

  const visibleFlow = useMemo(() => {
    const hidden = new Set<string>();
    const mark = (pid: string) => {
      for (const k of doc.flowNodes.filter((n) => n.parentId === pid)) { hidden.add(k.id); mark(k.id); }
    };
    for (const c of doc.flowNodes.filter((n) => n.collapsed)) mark(c.id);
    return new Set(doc.flowNodes.filter((n) => !hidden.has(n.id)).map((n) => n.id));
  }, [doc.flowNodes]);

  /* ---------- 坐标换算 ---------- */
  const pt = (e: { clientX: number; clientY: number }) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const toWorld = (sx: number, sy: number) => ({ x: (sx - view.x) / view.k, y: (sy - view.y) / view.k });
  const toScreen = (wx: number, wy: number) => ({ x: wx * view.k + view.x, y: wy * view.k + view.y });
  const capture = (e: { pointerId: number }) => svgRef.current?.setPointerCapture(e.pointerId);

  /* ---------- 全局包围盒 / 适应视图 ---------- */
  const bounds = useMemo(() => {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    const eat = (x: number, y: number, w: number, h: number) => {
      x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x + w); y2 = Math.max(y2, y + h);
    };
    for (const s of doc.states) { const sh = shapes.get(s.id); if (sh) eat(sh.x, sh.y, sh.w, sh.h); }
    for (const n of doc.flowNodes) eat(n.x, n.y, n.w, n.h);
    for (const w of doc.wbShapes) eat(w.x, w.y, Math.abs(w.w), Math.max(20, Math.abs(w.h)));
    if (!isFinite(x1)) return { x: 0, y: 0, w: 800, h: 500 };
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }, [doc, shapes]);

  const fit = () => {
    const pad = 70;
    const k = Math.min(2, Math.max(0.15, Math.min((size.w - pad * 2) / Math.max(1, bounds.w), (size.h - pad * 2) / Math.max(1, bounds.h))));
    setView({ k, x: (size.w - bounds.w * k) / 2 - bounds.x * k, y: (size.h - bounds.h * k) / 2 - bounds.y * k });
  };
  const firstFit = useRef(false);
  useEffect(() => { if (!firstFit.current) { firstFit.current = true; fit(); } /* eslint-disable-next-line */ }, [size.w]);
  useEffect(() => { if (fitSignal) fit(); /* eslint-disable-next-line */ }, [fitSignal]);

  /* ---------- 注册导出（克隆世界图层 → 自包含 SVG） ---------- */
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

  /* ---------- 缩放 ---------- */
  const onWheel = (e: React.WheelEvent) => {
    const p = pt(e);
    const wk = toWorld(p.x, p.y);
    const k = Math.min(2.5, Math.max(0.15, view.k * Math.exp(-e.deltaY * 0.0012)));
    setView({ k, x: p.x - wk.x * k, y: p.y - wk.y * k });
  };

  /* ---------- 创建元素（工具落点） ---------- */
  const place = (wx: number, wy: number) => {
    const x = settings.snapToGrid ? Math.round(wx / GRID_SNAP) * GRID_SNAP : Math.round(wx);
    const y = settings.snapToGrid ? Math.round(wy / GRID_SNAP) * GRID_SNAP : Math.round(wy);
    if (tool === 'sm-state' || tool === 'sm-terminal' || tool === 'sm-junction') {
      const kind = tool === 'sm-terminal' ? 'terminal' : tool === 'sm-junction' ? 'junction' : 'state';
      const name = kind === 'state' ? nextSmName() : kind === 'terminal' ? '结束' : '';
      const s = makeSmState(kind, x, y, name);
      set({ ...doc, states: [...doc.states, s] });
      setSel({ kind: 'state', id: s.id });
    } else if (tool.startsWith('flow-')) {
      const shapeMap = { 'flow-rect': 'rect', 'flow-diamond': 'diamond', 'flow-stadium': 'stadium', 'flow-io': 'parallelogram' } as const;
      const shape = shapeMap[tool as keyof typeof shapeMap];
      const parent = sel.kind === 'flow' && sel.id ? sel.id : null;
      const n = makeFlowNode(shape, parent ? 0 : x, parent ? 0 : y, parent);
      const nodes = parent
        ? doc.flowNodes.map((nn) => (nn.id === parent ? { ...nn, collapsed: false } : nn))
        : doc.flowNodes;
      set({ ...doc, flowNodes: tidyAfterAdd([...nodes, n]) });
      setSel({ kind: 'flow', id: n.id });
    } else if (tool.startsWith('wb-')) {
      const kindMap = { 'wb-rect': 'rect', 'wb-ellipse': 'ellipse', 'wb-arrow': 'arrow', 'wb-line': 'line', 'wb-text': 'text' } as const;
      const w = makeWbShape(kindMap[tool as keyof typeof kindMap], x, y);
      set({ ...doc, wbShapes: [...doc.wbShapes, w] });
      setSel({ kind: 'wb', id: w.id });
    }
    setTool('select');
  };

  const nextSmName = () => {
    const used = new Set(doc.states.map((s) => s.name));
    let i = doc.states.filter((s) => s.kind === 'state').length + 1;
    while (used.has(`State${i}`)) i++;
    return `State${i}`;
  };

  const tidyAfterAdd = (nodes: FlowNode[]) => tidyFlow(nodes, doc.flowDirection);

  /* ---------- 指针手势 ---------- */
  const onSvgPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const p = pt(e);
    if (tool !== 'select') { const w = toWorld(p.x, p.y); place(w.x, w.y); return; }
    dragRef.current = { mode: 'pan', sx: p.x, sy: p.y, ox: view.x, oy: view.y };
    capture(e);
    setSel({ kind: null, id: null });
  };

  const startMove = (e: React.PointerEvent, kind: 'state' | 'flow' | 'wb', id: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const p = pt(e); const w = toWorld(p.x, p.y);
    setSel({ kind, id });
    beginBatch();
    dragRef.current = { mode: 'move', kind, id, swx: w.x, swy: w.y, base: doc };
    capture(e);
  };

  const startConnect = (e: React.PointerEvent, fromId: string) => {
    e.stopPropagation();
    const sh = shapes.get(fromId); if (!sh) return;
    dragRef.current = { mode: 'connect', from: fromId };
    setConnect({ from: fromId, x: sh.cx, y: sh.cy });
    capture(e);
  };

  const onSvgPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current; if (!d) return;
    const p = pt(e);
    if (d.mode === 'pan') {
      setView((v) => ({ ...v, x: d.ox + (p.x - d.sx), y: d.oy + (p.y - d.sy) }));
    } else if (d.mode === 'move') {
      const w = toWorld(p.x, p.y);
      let dx = w.x - d.swx, dy = w.y - d.swy;
      const snap = settings.snapToGrid ? GRID_SNAP : 1;
      const base = d.base;
      if (d.kind === 'state') {
        const orig = base.states.find((s) => s.id === d.id); if (!orig) return;
        const nx = Math.round((orig.position.x + dx) / snap) * snap;
        const ny = Math.round((orig.position.y + dy) / snap) * snap;
        set({ ...base, states: base.states.map((s) => s.id === d.id ? { ...s, position: { x: nx, y: ny } } : s) }, false);
      } else if (d.kind === 'flow') {
        const orig = base.flowNodes.find((s) => s.id === d.id); if (!orig) return;
        const nx = Math.round((orig.x + dx) / snap) * snap, ny = Math.round((orig.y + dy) / snap) * snap;
        set({ ...base, flowNodes: base.flowNodes.map((s) => s.id === d.id ? { ...s, x: nx, y: ny } : s) }, false);
      } else {
        const orig = base.wbShapes.find((s) => s.id === d.id); if (!orig) return;
        const nx = Math.round((orig.x + dx) / snap) * snap, ny = Math.round((orig.y + dy) / snap) * snap;
        set({ ...base, wbShapes: base.wbShapes.map((s) => s.id === d.id ? { ...s, x: nx, y: ny } : s) }, false);
      }
    } else if (d.mode === 'connect') {
      const w = toWorld(p.x, p.y);
      setConnect({ from: d.from, x: w.x, y: w.y });
    }
  };

  const onSvgPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current; dragRef.current = null;
    if (!d) return;
    if (d.mode === 'move') endBatch();
    if (d.mode === 'connect') {
      const p = pt(e); const w = toWorld(p.x, p.y);
      const target = [...shapes.entries()].find(([, sh]) =>
        !sh.isCircle
          ? w.x >= sh.x && w.x <= sh.x + sh.w && w.y >= sh.y && w.y <= sh.y + sh.h
          : Math.hypot(w.x - sh.cx, w.y - sh.cy) <= sh.r + 6);
      if (target && target[0] !== d.from) {
        const t: ProjectTransition = { id: nid('t'), source: d.from, target: target[0], enabled: true };
        set({ ...doc, transitions: [...doc.transitions, t] });
        setSel({ kind: 'transition', id: t.id });
      }
      setConnect(null);
    }
  };

  /* ---------- 删除选中 ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.closest('input,textarea,select') || t.isContentEditable)) return;
      if (!sel.id || !sel.kind) return;
      e.preventDefault();
      deleteSel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line
  }, [sel, doc]);

  const deleteSel = () => {
    if (!sel.id) return;
    if (sel.kind === 'state') {
      const id = sel.id;
      set({
        ...doc,
        states: doc.states.filter((s) => s.id !== id),
        transitions: doc.transitions.filter((t) => t.source !== id && t.target !== id),
      });
    } else if (sel.kind === 'transition') {
      set({ ...doc, transitions: doc.transitions.filter((t) => t.id !== sel.id) });
    } else if (sel.kind === 'flow') {
      const id = sel.id;
      const doomed = new Set<string>([id]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const n of doc.flowNodes) if (n.parentId && doomed.has(n.parentId) && !doomed.has(n.id)) { doomed.add(n.id); grew = true; }
      }
      set({ ...doc, flowNodes: doc.flowNodes.filter((n) => !doomed.has(n.id)) });
    } else if (sel.kind === 'wb') {
      set({ ...doc, wbShapes: doc.wbShapes.filter((w) => w.id !== sel.id) });
    }
    setSel({ kind: null, id: null });
  };

  /* ---------- 缩放飞线元素 ---------- */
  const resizeTarget = useMemo(() => {
    if (sel.kind === 'wb') return doc.wbShapes.find((w) => w.id === sel.id) ?? null;
    if (sel.kind === 'flow') return doc.flowNodes.find((n) => n.id === sel.id) ?? null;
    return null;
  }, [sel, doc]);

  const onResize = (dw: number, dh: number) => {
    if (!resizeTarget || !sel.id) return;
    const wbKind = sel.kind === 'wb' ? (resizeTarget as WbShape).kind : undefined;
    const isLine = wbKind === 'line' || wbKind === 'arrow';
    const nw = Math.max(24, resizeTarget.w + dw / view.k);
    const nh = Math.max(isLine ? resizeTarget.h : 24, resizeTarget.h + dh / view.k);
    if (sel.kind === 'wb') set({ ...doc, wbShapes: doc.wbShapes.map((w) => w.id === sel.id ? { ...w, w: nw, h: nh } : w) }, false);
    else set({ ...doc, flowNodes: doc.flowNodes.map((n) => n.id === sel.id ? { ...n, w: nw, h: nh } : n) }, false);
  };

  const th = THEME[theme];
  const selStroke = th.sel;

  /* ---------- 选中元素的世界包围盒（用于屏幕空间覆盖层） ---------- */
  const selBox = useMemo(() => {
    if (sel.kind === 'state' && sel.id) { const sh = shapes.get(sel.id); return sh ? { x: sh.x, y: sh.y, w: sh.w, h: sh.h } : null; }
    if (sel.kind === 'flow' && sel.id) { const n = doc.flowNodes.find((x) => x.id === sel.id); return n ? { x: n.x, y: n.y, w: n.w, h: n.h } : null; }
    if (sel.kind === 'wb' && sel.id) { const w = doc.wbShapes.find((x) => x.id === sel.id); return w ? { x: w.x, y: w.y, w: w.w, h: Math.max(10, w.h) } : null; }
    return null;
  }, [sel, shapes, doc]);

  const isEmpty = !doc.states.length && !doc.flowNodes.length && !doc.wbShapes.length;

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
        onMouseLeave={() => setHoverId(null)}
      >
        {/* 网格 */}
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
          {/* ===== 白板层 ===== */}
          {doc.wbShapes.map((w) => (
            <WbShapeView key={w.id} w={w} theme={theme} selected={sel.kind === 'wb' && sel.id === w.id}
              onDown={(e) => startMove(e, 'wb', w.id)} onSelect={() => setSel({ kind: 'wb', id: w.id })} />
          ))}

          {/* ===== 流程图层 ===== */}
          {doc.flowNodes.filter((n) => n.parentId && visibleFlow.has(n.id) && visibleFlow.has(n.parentId!)).map((n) => {
            const p = doc.flowNodes.find((x) => x.id === n.parentId)!;
            return <FlowEdge key={'e' + n.id} p={p} c={n} dir={doc.flowDirection} color={th.edge} />;
          })}
          {doc.flowNodes.filter((n) => visibleFlow.has(n.id)).map((n) => (
            <FlowNodeView key={n.id} n={n} nodes={doc.flowNodes} dir={doc.flowDirection} theme={theme}
              selected={sel.kind === 'flow' && sel.id === n.id}
              onDown={(e) => startMove(e, 'flow', n.id)}
              onToggle={() => toggleFlow(n.id)} />
          ))}

          {/* ===== 状态机层 ===== */}
          {edges.map((g) => (
            <EdgeView key={g.id} g={g} theme={theme} arrowSize={settings.arrowSize}
              selected={sel.kind === 'transition' && sel.id === g.id}
              onSelect={() => setSel({ kind: 'transition', id: g.id })} />
          ))}
          {doc.states.map((s) => {
            const sh = shapes.get(s.id); if (!sh) return null;
            return (
              <StateView key={s.id} s={s} sh={sh} theme={theme} showActions={settings.showActionText}
                selected={sel.kind === 'state' && sel.id === s.id}
                onDown={(e) => startMove(e, 'state', s.id)}
                onHover={(h) => setHoverId(h ? s.id : null)} />
            );
          })}

          {/* 连接手柄（悬停状态时） */}
          {hoverId && tool === 'select' && (() => {
            const sh = shapes.get(hoverId); if (!sh) return null;
            return (
              <circle cx={sh.x + sh.w + 2} cy={sh.cy} r={7 / view.k * 1} fill={selStroke}
                stroke="#fff" strokeWidth={1.5 / view.k} style={{ cursor: 'crosshair' }}
                onPointerDown={(e) => startConnect(e, hoverId)} />
            );
          })()}

          {/* 连接临时线 */}
          {connect && (() => {
            const sh = shapes.get(connect.from); if (!sh) return null;
            return <line x1={sh.x + sh.w} y1={sh.cy} x2={connect.x} y2={connect.y}
              stroke={selStroke} strokeWidth={2 / view.k} strokeDasharray={`${6 / view.k} ${5 / view.k}`} />;
          })()}
        </g>

        {/* ===== 屏幕空间：选中框 + 缩放手柄 ===== */}
        {selBox && sel.kind !== 'transition' && (
          <SelOverlay box={selBox} toScreen={toScreen} k={view.k} color={selStroke}
            resizable={!!resizeTarget} onResizeBegin={beginBatch} onResize={onResize} onResizeEnd={endBatch} />
        )}
      </svg>

      {/* 空态提示 */}
      {isEmpty && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center px-6 py-5 rounded-2xl" style={{ background: 'color-mix(in srgb, var(--panel) 82%, transparent)', border: '1px dashed var(--border-strong)' }}>
            <div className="text-[15px] font-bold mb-1" style={{ color: 'var(--text)' }}>空画布</div>
            <div className="text-[12px]" style={{ color: 'var(--muted)' }}>
              从左侧选择工具后点击画布放置元素<br />状态机 · 流程图 · 白板 共存于此
            </div>
          </div>
        </div>
      )}

      {/* 小地图 + 缩放控件 */}
      {settings.showMiniMap && <MiniMap bounds={bounds} view={view} size={size} theme={theme}
        doc={doc} shapes={shapes} visibleFlow={visibleFlow}
        onJump={(wx, wy) => setView((v) => ({ ...v, x: size.w / 2 - wx * v.k, y: size.h / 2 - wy * v.k }))} />}
      <ZoomCtl view={view} setView={setView} fit={fit} />
    </div>
  );

  function toggleFlow(id: string) {
    const n = doc.flowNodes.find((x) => x.id === id); if (!n) return;
    const flipped = doc.flowNodes.map((x) => x.id === id ? { ...x, collapsed: !x.collapsed } : x);
    set({ ...doc, flowNodes: tidyFlow(flipped, doc.flowDirection) });
  }
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
      <g onPointerDown={onDown} onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)} style={{ cursor: 'move' }}>
        {selected && <circle cx={sh.cx} cy={sh.cy} r={sh.r + 6} fill="none" stroke={th.selGlow} strokeWidth={5} />}
        <circle cx={sh.cx} cy={sh.cy} r={sh.r} fill={th.startFill} stroke={selected ? th.sel : 'none'} strokeWidth={2} />
        <circle cx={sh.cx} cy={sh.cy} r={3.5} fill={th.startDot} />
      </g>
    );
  }
  if (s.kind === 'junction') {
    return (
      <g onPointerDown={onDown} onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)} style={{ cursor: 'move' }}>
        {selected && <circle cx={sh.cx} cy={sh.cy} r={sh.r + 6} fill="none" stroke={th.selGlow} strokeWidth={5} />}
        <circle cx={sh.cx} cy={sh.cy} r={sh.r} fill={th.junctionFill} stroke={selected ? th.sel : th.junctionBorder} strokeWidth={selected ? 2.5 : 2} />
      </g>
    );
  }
  const lines = actionLines(s, showActions);
  return (
    <g onPointerDown={onDown} onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)} style={{ cursor: 'move' }}>
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
    <g style={{ cursor: 'pointer' }} onPointerDown={(e) => { e.stopPropagation(); onSelect(); }}>
      {selected && <path d={g.d} fill="none" stroke={th.selGlow} strokeWidth={g.width + 6} strokeLinecap="round" />}
      <path d={g.d} fill="none" stroke={color} strokeWidth={g.width} strokeDasharray={g.dash} strokeLinecap="round" />
      {/* 18px 命中热区 */}
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

function FlowEdge({ p, c, dir, color }: { p: FlowNode; c: FlowNode; dir: 'LR' | 'TB'; color: string }) {
  let d: string;
  if (dir === 'LR') {
    const x1 = p.x + p.w, y1 = p.y + p.h / 2, x2 = c.x, y2 = c.y + c.h / 2;
    const mx = (x1 + x2) / 2;
    d = `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
  } else {
    const x1 = p.x + p.w / 2, y1 = p.y + p.h, x2 = c.x + c.w / 2, y2 = c.y;
    const my = (y1 + y2) / 2;
    d = `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`;
  }
  return <path d={d} fill="none" stroke={color} strokeWidth={1.6} opacity={0.75} />;
}

function flowPath(n: FlowNode): { d?: string; rect?: boolean } {
  const { x, y, w, h } = n;
  if (n.shape === 'diamond') {
    return { d: `M ${x + w / 2} ${y} L ${x + w} ${y + h / 2} L ${x + w / 2} ${y + h} L ${x} ${y + h / 2} Z` };
  }
  if (n.shape === 'stadium') {
    return { d: `M ${x + h / 2} ${y} H ${x + w - h / 2} A ${h / 2} ${h / 2} 0 0 1 ${x + w - h / 2} ${y + h} H ${x + h / 2} A ${h / 2} ${h / 2} 0 0 1 ${x + h / 2} ${y} Z` };
  }
  if (n.shape === 'parallelogram') {
    const o = Math.min(20, w * 0.18);
    return { d: `M ${x + o} ${y} H ${x + w} L ${x + w - o} ${y + h} H ${x} Z` };
  }
  return { rect: true };
}

function FlowNodeView({ n, nodes, dir, theme, selected, onDown, onToggle }: {
  n: FlowNode; nodes: FlowNode[]; dir: 'LR' | 'TB'; theme: 'light' | 'dark'; selected: boolean;
  onDown: (e: React.PointerEvent) => void; onToggle: () => void;
}) {
  const th = THEME[theme];
  const fp = flowPath(n);
  const lines = wrapText(n.text || ' ', Math.max(40, n.w - 20), 12.5);
  const hidden = n.collapsed ? hiddenDescendants(nodes, n.id) : 0;
  const cx = n.x + n.w / 2, cy = n.y + n.h / 2;
  const startY = cy - ((lines.length - 1) * 16) / 2;
  return (
    <g onPointerDown={onDown} style={{ cursor: 'move' }}>
      {selected && (fp.rect
        ? <rect x={n.x - 4} y={n.y - 4} width={n.w + 8} height={n.h + 8} rx={13} fill="none" stroke={th.selGlow} strokeWidth={5} />
        : <rect x={n.x - 4} y={n.y - 4} width={n.w + 8} height={n.h + 8} rx={13} fill="none" stroke={th.selGlow} strokeWidth={5} />)}
      {fp.rect
        ? <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={10} fill={n.fill} stroke={selected ? th.sel : n.stroke} strokeWidth={selected ? 2.2 : 1.6} />
        : <path d={fp.d} fill={n.fill} stroke={selected ? th.sel : n.stroke} strokeWidth={selected ? 2.2 : 1.6} strokeLinejoin="round" />}
      {lines.map((ln, i) => (
        <text key={i} x={cx} y={startY + i * 16} textAnchor="middle" dominantBaseline="middle"
          fontSize={12.5} fontWeight={600} fill={th.edgeLabelText} fontFamily={FONT_STACK}>{ln}</text>
      ))}
      {n.collapsed && hidden > 0 && (
        <g style={{ cursor: 'pointer' }} onPointerDown={(e) => { e.stopPropagation(); onToggle(); }}>
          {dir === 'LR'
            ? <><circle cx={n.x + n.w + 13} cy={cy} r={9} fill={n.stroke} /><text x={n.x + n.w + 13} y={cy} textAnchor="middle" dominantBaseline="middle" fontSize={9} fontWeight={700} fill="#fff">+{hidden}</text></>
            : <><circle cx={cx} cy={n.y + n.h + 13} r={9} fill={n.stroke} /><text x={cx} y={n.y + n.h + 13} textAnchor="middle" dominantBaseline="middle" fontSize={9} fontWeight={700} fill="#fff">+{hidden}</text></>}
        </g>
      )}
      {/* 展开/收起开关（有子级时） */}
      {!n.collapsed && nodes.some((k) => k.parentId === n.id) && (
        <g style={{ cursor: 'pointer' }} onPointerDown={(e) => { e.stopPropagation(); onToggle(); }}>
          {dir === 'LR'
            ? <><circle cx={n.x + n.w + 13} cy={cy} r={8} fill={th.edgeLabelBg} stroke={n.stroke} /><text x={n.x + n.w + 13} y={cy + 0.5} textAnchor="middle" dominantBaseline="middle" fontSize={10} fontWeight={700} fill={n.stroke}>−</text></>
            : <><circle cx={cx} cy={n.y + n.h + 13} r={8} fill={th.edgeLabelBg} stroke={n.stroke} /><text x={cx} y={n.y + n.h + 13.5} textAnchor="middle" dominantBaseline="middle" fontSize={10} fontWeight={700} fill={n.stroke}>−</text></>}
        </g>
      )}
    </g>
  );
}

function WbShapeView({ w, theme, selected, onDown }: {
  w: WbShape; theme: 'light' | 'dark'; selected: boolean;
  onDown: (e: React.PointerEvent) => void; onSelect: () => void;
}) {
  const th = THEME[theme];
  const stroke = selected ? th.sel : w.stroke;
  const common = { onPointerDown: onDown, style: { cursor: 'move' as const } };
  if (w.kind === 'image') {
    return (
      <g {...common}>
        {selected && <rect x={w.x - 4} y={w.y - 4} width={w.w + 8} height={w.h + 8} fill="none" stroke={th.selGlow} strokeWidth={5} />}
        <image href={w.src} x={w.x} y={w.y} width={w.w} height={w.h} preserveAspectRatio="none"
          style={{ borderRadius: 8 }} />
        <rect x={w.x} y={w.y} width={w.w} height={w.h} fill="none" stroke={stroke} strokeWidth={selected ? 2.2 : 1.2} rx={8} />
      </g>
    );
  }
  if (w.kind === 'rect') {
    const lines = w.text ? wrapText(w.text, Math.max(30, w.w - 16), 12) : [];
    const startY = w.y + w.h / 2 - ((lines.length - 1) * 15) / 2;
    return (
      <g {...common}>
        {selected && <rect x={w.x - 4} y={w.y - 4} width={w.w + 8} height={w.h + 8} rx={12} fill="none" stroke={th.selGlow} strokeWidth={5} />}
        <rect x={w.x} y={w.y} width={w.w} height={w.h} rx={9} fill={w.fill} stroke={stroke} strokeWidth={selected ? 2.2 : w.strokeWidth} />
        {lines.map((ln, i) => (
          <text key={i} x={w.x + w.w / 2} y={startY + i * 15} textAnchor="middle" dominantBaseline="middle"
            fontSize={12} fontWeight={600} fill={th.edgeLabelText} fontFamily={FONT_STACK}>{ln}</text>
        ))}
      </g>
    );
  }
  if (w.kind === 'ellipse') {
    return (
      <g {...common}>
        {selected && <ellipse cx={w.x + w.w / 2} cy={w.y + w.h / 2} rx={w.w / 2 + 4} ry={w.h / 2 + 4} fill="none" stroke={th.selGlow} strokeWidth={5} />}
        <ellipse cx={w.x + w.w / 2} cy={w.y + w.h / 2} rx={w.w / 2} ry={w.h / 2} fill={w.fill} stroke={stroke} strokeWidth={selected ? 2.2 : w.strokeWidth} />
      </g>
    );
  }
  if (w.kind === 'arrow' || w.kind === 'line') {
    const x1 = w.x, y1 = w.y, x2 = w.x + w.w, y2 = w.y + w.h;
    const ang = Math.atan2(y2 - y1, x2 - x1);
    return (
      <g {...common}>
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={stroke} strokeWidth={selected ? w.strokeWidth + 1 : w.strokeWidth} strokeLinecap="round" />
        {w.kind === 'arrow' && <polygon points={arrowPoints(x2, y2, ang, 14)} fill={stroke} />}
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={16} />
      </g>
    );
  }
  // text
  const lines = wrapText(w.text || ' ', Math.max(30, w.w), 13);
  return (
    <g {...common}>
      {selected && <rect x={w.x - 4} y={w.y - 4} width={w.w + 8} height={w.h + 8} rx={8} fill="none" stroke={th.selGlow} strokeWidth={4} />}
      {lines.map((ln, i) => (
        <text key={i} x={w.x} y={w.y + 14 + i * 17} fontSize={13} fontWeight={600} fill={th.edgeLabelText} fontFamily={FONT_STACK}>{ln}</text>
      ))}
    </g>
  );
}

/* ---------- 选中覆盖层（屏幕空间） ---------- */
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
function MiniMap({ bounds, view, size, theme, doc, shapes, visibleFlow, onJump }: {
  bounds: { x: number; y: number; w: number; h: number }; view: View; size: { w: number; h: number };
  theme: 'light' | 'dark'; doc: ReturnType<typeof useStudio>['doc'];
  shapes: Map<string, { x: number; y: number; w: number; h: number }>;
  visibleFlow: Set<string>; onJump: (wx: number, wy: number) => void;
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
        {doc.wbShapes.map((w) => <rect key={w.id} x={ox + w.x * k} y={oy + w.y * k} width={Math.max(2, w.w * k)} height={Math.max(2, w.h * k)} fill={w.stroke} opacity={0.5} />)}
        {doc.flowNodes.filter((n) => visibleFlow.has(n.id)).map((n) => <rect key={n.id} x={ox + n.x * k} y={oy + n.y * k} width={Math.max(2, n.w * k)} height={Math.max(2, n.h * k)} rx={2} fill={n.stroke} opacity={0.7} />)}
        {doc.states.map((s) => { const sh = shapes.get(s.id); if (!sh) return null; return <rect key={s.id} x={ox + sh.x * k} y={oy + sh.y * k} width={Math.max(2, sh.w * k)} height={Math.max(2, sh.h * k)} rx={2} fill={th.edge} opacity={0.8} />; })}
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
