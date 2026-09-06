/* ============================================================
 * ScopeCanvas —— FlowForge 画布
 *  - 只投影当前 Scope（绝不整体展开整个 Project，红线）
 *  - 双击 call 进入子流程；面包屑/返回退出；单击 call 弹 mini 预览
 *  - 四锚点(t/b/l/r)拖线；框选；拖拽移动(合并 Undo)；滚轮缩放/平移
 * ============================================================ */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useScope } from '../store/scopeStore';
import type { Tool } from '../store/scopeStore';
import { THEME, SHAPE_COLORS, readableOn, estWidth, wrapText, FONT_STACK } from '../lib/core';
import type { ThemeMode } from '../lib/core';
import type {
  RenderNode, ProjectedEdge, Handle, NodeType, Position, ID, CallNode, MiniLayout, Process,
} from '../lib/domain';
import { NODE_DEFAULTS, layoutMini, buildProjectCallGraph, OVERVIEW_CARD } from '../lib/domain';

interface View { x: number; y: number; k: number }
type Drag =
  | { mode: 'pan'; sx: number; sy: number; ox: number; oy: number }
  | { mode: 'marquee'; sx: number; sy: number; ex: number; ey: number }
  | { mode: 'move'; id: ID; swx: number; swy: number; ox: number; oy: number }
  | { mode: 'overview-move'; id: ID; swx: number; swy: number; ox: number; oy: number }
  | { mode: 'connect'; from: ID; fromHandle: Handle; x: number; y: number };

const HANDLE_IDS: Handle[] = ['t', 'r', 'b', 'l'];
function handlePos(n: RenderNode, h: Handle): Position {
  const cx = n.x + n.w / 2, cy = n.y + n.h / 2;
  if (h === 't') return { x: cx, y: n.y };
  if (h === 'b') return { x: cx, y: n.y + n.h };
  if (h === 'l') return { x: n.x, y: cy };
  return { x: n.x + n.w, y: cy };
}
function edgePath(sp: Position, tp: Position, sh: Handle, th: Handle, kind: 'straight' | 'step' | 'smoothstep') {
  if (kind === 'straight') {
    const ang = Math.atan2(tp.y - sp.y, tp.x - sp.x);
    return { d: `M ${sp.x} ${sp.y} L ${tp.x} ${tp.y}`, ax: tp.x, ay: tp.y, ang, labelX: (sp.x + tp.x) / 2, labelY: (sp.y + tp.y) / 2 };
  }
  // 正交：依据锚点方向走 step
  const horiz = sh === 'r' || sh === 'l';
  let pts: Position[];
  if (horiz) {
    const mx = (sp.x + tp.x) / 2;
    pts = [sp, { x: mx, y: sp.y }, { x: mx, y: tp.y }, tp];
  } else {
    const my = (sp.y + tp.y) / 2;
    pts = [sp, { x: sp.x, y: my }, { x: tp.x, y: my }, tp];
  }
  pts = pts.filter((p, i) => i === 0 || Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) > 0.5);
  const r = kind === 'smoothstep' ? 10 : 0;
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const v1x = p.x - pts[i - 1].x, v1y = p.y - pts[i - 1].y, l1 = Math.hypot(v1x, v1y) || 1;
    const v2x = pts[i + 1].x - p.x, v2y = pts[i + 1].y - p.y, l2 = Math.hypot(v2x, v2y) || 1;
    if (r <= 0) { d += ` L ${p.x} ${p.y}`; continue; }
    const r1 = Math.min(r, l1 / 2), r2 = Math.min(r, l2 / 2);
    d += ` L ${p.x - (v1x / l1) * r1} ${p.y - (v1y / l1) * r1} Q ${p.x} ${p.y} ${p.x + (v2x / l2) * r2} ${p.y + (v2y / l2) * r2}`;
  }
  const last = pts[pts.length - 1], prev = pts[pts.length - 2];
  d += ` L ${last.x} ${last.y}`;
  const mi = Math.floor(pts.length / 2);
  return {
    d, ax: last.x, ay: last.y, ang: Math.atan2(last.y - prev.y, last.x - prev.x),
    labelX: (pts[mi - 1].x + pts[mi].x) / 2, labelY: (pts[mi - 1].y + pts[mi].y) / 2,
  };
}
function arrowPts(ax: number, ay: number, ang: number, size: number): string {
  const p1 = { x: ax, y: ay };
  const p2 = { x: ax - size * Math.cos(ang - 0.42), y: ay - size * Math.sin(ang - 0.42) };
  const p3 = { x: ax - size * Math.cos(ang + 0.42), y: ay - size * Math.sin(ang + 0.42) };
  return `${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y}`;
}

export default function ScopeCanvas() {
  const app = useScope();
  const { projection, theme, sel, tool } = app;
  const th = THEME[theme];
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<View>({ x: 60, y: 40, k: 1 });
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [marquee, setMarquee] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [connect, setConnect] = useState<{ from: ID; fromHandle: Handle; x: number; y: number } | null>(null);
  const [hoverNode, setHoverNode] = useState<ID | null>(null);
  const [renaming, setRenaming] = useState<{ id: ID; x: number; y: number; w: number } | null>(null);
  const dragRef = useRef<Drag | null>(null);

  /* 尺寸自适应 */
  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const nodeMap = useMemo(() => new Map(projection.nodes.map((n) => [n.id, n])), [projection]);
  const editable = app.mode === 'edit';

  /* P 键面板的世界坐标换算器（注册给 store） */
  useEffect(() => {
    app.screenToWorldRef.current = (sx: number, sy: number) => {
      const r = svgRef.current!.getBoundingClientRect();
      return { x: (sx - r.left - view.x) / view.k, y: (sy - r.top - view.y) / view.k };
    };
  });

  /* 全局调用图数据 */
  const callGraph = useMemo(() => buildProjectCallGraph(app.project), [app.project]);
  const overviewPos = app.layouts['__overview']?.positions ?? {};
  const [ovSelected, setOvSelected] = useState<ID | null>(null);
  const [ovPreview, setOvPreview] = useState<ID | null>(null);

  /* ---------- 适应视图 ---------- */
  const fitView = useCallback(() => {
    if (app.viewKind === 'callgraph') {
      const items = callGraph.nodes.map((n) => ({ n, p: overviewPos[n.id] ?? { x: 0, y: 0 } }));
      if (!items.length) { setView({ x: 60, y: 40, k: 1 }); return; }
      const x1 = Math.min(...items.map((i) => i.p.x)), y1 = Math.min(...items.map((i) => i.p.y));
      const x2 = Math.max(...items.map((i) => i.p.x + OVERVIEW_CARD.w)), y2 = Math.max(...items.map((i) => i.p.y + OVERVIEW_CARD.h));
      const bw = x2 - x1, bh = y2 - y1;
      const k = Math.min(1.3, Math.max(0.2, Math.min((size.w - 120) / bw, (size.h - 160) / bh)));
      setView({ k, x: (size.w - bw * k) / 2 - x1 * k, y: (size.h - bh * k) / 2 - y1 * k + 24 });
      return;
    }
    const ns = projection.nodes;
    if (!ns.length) { setView({ x: 60, y: 40, k: 1 }); return; }
    const x1 = Math.min(...ns.map((n) => n.x)), y1 = Math.min(...ns.map((n) => n.y));
    const x2 = Math.max(...ns.map((n) => n.x + n.w)), y2 = Math.max(...ns.map((n) => n.y + n.h));
    const bw = x2 - x1, bh = y2 - y1;
    const k = Math.min(1.4, Math.max(0.2, Math.min((size.w - 100) / bw, (size.h - 140) / bh)));
    setView({ k, x: (size.w - bw * k) / 2 - x1 * k, y: (size.h - bh * k) / 2 - y1 * k + 20 });
  }, [projection, size, app.viewKind, callGraph, overviewPos]);
  const fittedScope = useRef<string>('');
  useEffect(() => {
    const key = app.scope.pageId + ':' + (app.scope.processId ?? '') + ':' + app.viewKind;
    if (fittedScope.current !== key) { fittedScope.current = key; fitView(); }
  }, [app.scope, app.viewKind, fitView]);
  useEffect(() => { if (app.fitSignal) fitView(); }, [app.fitSignal, fitView]);

  const toWorld = (sx: number, sy: number): Position => ({ x: (sx - view.x) / view.k, y: (sy - view.y) / view.k });
  const pt = (e: { clientX: number; clientY: number }) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const capture = (e: React.PointerEvent) => (e.target as Element).setPointerCapture?.(e.pointerId);

  /* ---------- 滚轮：缩放(居中到鼠标) / Ctrl 上下 / Shift 左右（设计 5.3） ---------- */
  useEffect(() => {
    const el = svgRef.current; if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const sx = e.clientX - r.left, sy = e.clientY - r.top;
      setView((v) => {
        if (e.ctrlKey || e.shiftKey) {
          const dy = e.deltaY !== 0 ? e.deltaY : e.deltaX;
          const dx = e.deltaX !== 0 ? e.deltaX : e.deltaY;
          const step = 60;
          if (e.ctrlKey) return { ...v, y: v.y + (dy > 0 ? -step : step) };
          return { ...v, x: v.x + (dx > 0 ? step : -step) };
        }
        const nk = Math.min(2.5, Math.max(0.2, v.k * (e.deltaY > 0 ? 0.85 : 1.18)));
        const fp = { x: (sx - v.x) / v.k, y: (sy - v.y) / v.k };
        return { x: sx - fp.x * nk, y: sy - fp.y * nk, k: nk };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  /* ---------- 指针手势 ---------- */
  const onSvgPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    const p = pt(e);
    // 工具落点（仅编辑模式）
    if (e.button === 0 && tool !== 'select' && editable) {
      const w = toWorld(p.x, p.y);
      app.addNode(tool as NodeType, w.x - 60, w.y - 20);
      app.setTool('select');
      return;
    }
    // 全局调用图：左键空白 = 平移（无框选）
    if (app.viewKind === 'callgraph') {
      setOvSelected(null); setOvPreview(null);
      dragRef.current = { mode: 'pan', sx: p.x, sy: p.y, ox: view.x, oy: view.y };
      capture(e);
      return;
    }
    // 中键 / Ctrl+左键 平移；左键空白 = 框选（设计 5.2）
    if (e.button === 1 || e.ctrlKey || e.metaKey) {
      dragRef.current = { mode: 'pan', sx: p.x, sy: p.y, ox: view.x, oy: view.y };
    } else {
      dragRef.current = { mode: 'marquee', sx: p.x, sy: p.y, ex: p.x, ey: p.y };
      setMarquee({ x1: p.x, y1: p.y, x2: p.x, y2: p.y });
    }
    capture(e);
  };

  const startOverviewMove = (e: React.PointerEvent, id: ID) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setOvSelected(id);
    if (!editable) return; // 阅读模式可选中查看，不可拖动
    const p = pt(e); const w = toWorld(p.x, p.y);
    const pos = overviewPos[id] ?? { x: 0, y: 0 };
    dragRef.current = { mode: 'overview-move', id, swx: w.x, swy: w.y, ox: pos.x, oy: pos.y };
    capture(e);
  };

  const startMove = (e: React.PointerEvent, id: ID) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const p = pt(e); const w = toWorld(p.x, p.y);
    const n = nodeMap.get(id); if (!n) return;
    if (!editable) { // 阅读模式：仅选中，不可拖动
      app.setSel({ kind: 'node', ids: [id] });
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      app.setSel({ kind: 'node', ids: sel.kind === 'node' && sel.ids.includes(id) ? sel.ids.filter((x) => x !== id) : [...(sel.kind === 'node' ? sel.ids : []), id] });
      return;
    }
    const ids = sel.kind === 'node' && sel.ids.includes(id) ? sel.ids : [id];
    app.setSel({ kind: 'node', ids });
    dragRef.current = { mode: 'move', id, swx: w.x, swy: w.y, ox: n.x, oy: n.y };
    capture(e);
  };

  const startConnect = (e: React.PointerEvent, id: ID, h: Handle) => {
    e.stopPropagation();
    const p = pt(e); const w = toWorld(p.x, p.y);
    dragRef.current = { mode: 'connect', from: id, fromHandle: h, x: w.x, y: w.y };
    setConnect({ from: id, fromHandle: h, x: w.x, y: w.y });
    capture(e);
  };

  const onSvgPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current; if (!d) return;
    const p = pt(e);
    if (d.mode === 'pan') {
      setView((v) => ({ ...v, x: d.ox + (p.x - d.sx), y: d.oy + (p.y - d.sy) }));
    } else if (d.mode === 'marquee') {
      dragRef.current = { ...d, ex: p.x, ey: p.y };
      setMarquee({ x1: d.sx, y1: d.sy, x2: p.x, y2: p.y });
    } else if (d.mode === 'move') {
      const w = toWorld(p.x, p.y);
      app.moveNode(d.id, { x: d.ox + (w.x - d.swx), y: d.oy + (w.y - d.swy) });
    } else if (d.mode === 'overview-move') {
      const w = toWorld(p.x, p.y);
      app.moveOverviewNode(d.id, { x: d.ox + (w.x - d.swx), y: d.oy + (w.y - d.swy) });
    } else if (d.mode === 'connect') {
      const w = toWorld(p.x, p.y);
      dragRef.current = { ...d, x: w.x, y: w.y };
      setConnect({ from: d.from, fromHandle: d.fromHandle, x: w.x, y: w.y });
    }
  };

  const onSvgPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current; dragRef.current = null;
    if (!d) return;
    if (d.mode === 'marquee') {
      setMarquee(null);
      const x1 = Math.min(d.sx, d.ex), x2 = Math.max(d.sx, d.ex);
      const y1 = Math.min(d.sy, d.ey), y2 = Math.max(d.sy, d.ey);
      if (Math.hypot(x2 - x1, y2 - y1) < 5) {
        app.setSel({ kind: null });
        app.setPreviewNodeId(null);
        return;
      }
      const w1 = toWorld(x1, y1), w2 = toWorld(x2, y2);
      const ids = projection.nodes
        .filter((n) => n.x < w2.x && n.x + n.w > w1.x && n.y < w2.y && n.y + n.h > w1.y)
        .map((n) => n.id);
      app.setSel({ kind: 'node', ids });
    } else if (d.mode === 'connect') {
      setConnect(null);
      const p = pt(e); const w = toWorld(p.x, p.y);
      const target = projection.nodes.find((n) => w.x >= n.x && w.x <= n.x + n.w && w.y >= n.y && w.y <= n.y + n.h);
      if (target && target.id !== d.from) app.createEdge(d.from, target.id, d.fromHandle, undefined);
    }
  };

  /* ---------- 节点交互 ---------- */
  const onNodeClick = (e: React.MouseEvent, n: RenderNode) => {
    e.stopPropagation();
    app.setSel({ kind: 'node', ids: [n.id] });
    if (n.type === 'call') app.setPreviewNodeId(app.previewNodeId === n.id ? null : n.id);
    else app.setPreviewNodeId(null);
  };
  const onNodeDblClick = (e: React.MouseEvent, n: RenderNode) => {
    e.stopPropagation();
    if (n.type === 'call') {
      app.setPreviewNodeId(null);
      app.enterScope((n as CallNode).targetProcessId);
    } else if (editable) {
      const r = svgRef.current!.getBoundingClientRect();
      setRenaming({ id: n.id, x: n.x * view.k + view.x, y: n.y * view.k + view.y, w: n.w * view.k });
    }
  };

  const previewNode = app.previewNodeId ? nodeMap.get(app.previewNodeId) : null;
  const previewLayout: MiniLayout | null = useMemo(() => {
    if (!previewNode || previewNode.type !== 'call') return null;
    const target = app.project.processes.find((p) => p.id === (previewNode as unknown as CallNode).targetProcessId);
    return target ? layoutMini(target) : null;
  }, [previewNode, app.project]);

  return (
    <div ref={wrapRef} className="relative flex-1 min-w-0 overflow-hidden" style={{ background: th.canvas }}>
      <svg ref={svgRef} className="w-full h-full block" style={{ cursor: tool === 'select' ? 'default' : 'crosshair', touchAction: 'none' }}
        onPointerDown={onSvgPointerDown} onPointerMove={onSvgPointerMove} onPointerUp={onSvgPointerUp}>
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          <GridBg theme={theme} />
          {app.viewKind === 'callgraph' ? (
            /* ---------- 全局调用图 ---------- */
            <OverviewLayer graph={callGraph} positions={overviewPos} theme={theme}
              selected={ovSelected} preview={ovPreview} processes={app.project.processes}
              onSelect={(id) => { setOvSelected(id); setOvPreview((p) => (p === id ? null : id)); }}
              onDbl={(id) => { setOvPreview(null); app.setPreviewNodeId(null); app.enterScope(id); }}
              onDown={startOverviewMove} />
          ) : (
            <>
              {/* 连线 */}
              {projection.edges.map((e) => {
                const s = nodeMap.get(e.source), t = nodeMap.get(e.target);
                if (!s || !t) return null;
                const selected = sel.kind === 'edge' && sel.id === e.id;
                return <EdgeView key={e.id} e={e} s={s} t={t} theme={theme} selected={selected}
                  onSelect={() => app.setSel({ kind: 'edge', ids: [e.id] })} />;
              })}
              {/* 连线预览 */}
              {connect && (() => {
                const s = nodeMap.get(connect.from); if (!s) return null;
                const sp = handlePos(s, connect.fromHandle);
                return <line x1={sp.x} y1={sp.y} x2={connect.x} y2={connect.y} stroke={th.sel} strokeWidth={2} strokeDasharray="6 4" />;
              })()}
              {/* 节点 */}
              {projection.nodes.map((n) => (
                <NodeView key={n.id} n={n} theme={theme} editable={editable}
                  selected={sel.kind === 'node' && sel.ids.includes(n.id)}
                  hovered={hoverNode === n.id}
                  previewOpen={app.previewNodeId === n.id}
                  onHover={(h) => setHoverNode(h ? n.id : null)}
                  onDown={(e) => startMove(e, n.id)}
                  onClick={(e) => onNodeClick(e, n)}
                  onDblClick={(e) => onNodeDblClick(e, n)}
                  onStartConnect={(e, h) => startConnect(e, n.id, h)} />
              ))}
            </>
          )}
        </g>
      </svg>

      {/* 视图切换：当前流程 / 全局调用 */}
      {app.page.type === 'flow' && (
        <div className="absolute left-1/2 top-3 -translate-x-1/2 seg" style={{ background: 'var(--panel)', boxShadow: 'var(--shadow)' }}>
          <button className={`seg-btn ${app.viewKind === 'flow' ? 'on' : ''}`} onClick={() => app.setViewKind('flow')}>当前流程</button>
          <button className={`seg-btn ${app.viewKind === 'callgraph' ? 'on' : ''}`} onClick={() => app.setViewKind('callgraph')}>全局调用</button>
        </div>
      )}

      {/* 框选 */}
      {marquee && (
        <div className="absolute pointer-events-none border rounded-sm"
          style={{
            left: Math.min(marquee.x1, marquee.x2), top: Math.min(marquee.y1, marquee.y2),
            width: Math.abs(marquee.x2 - marquee.x1), height: Math.abs(marquee.y2 - marquee.y1),
            borderColor: th.sel, background: 'color-mix(in srgb, var(--accent) 8%, transparent)',
          }} />
      )}

      {/* 面包屑 + 返回 */}
      <Breadcrumbs />

      {/* 缩放控件 */}
      <div className="absolute right-3 bottom-3 flex flex-col rounded-lg overflow-hidden" style={{ background: 'var(--panel)', border: '1px solid var(--border)', boxShadow: 'var(--shadow)' }}>
        <button className="zoom-btn" onClick={() => setView((v) => ({ ...v, k: Math.min(2.5, v.k * 1.2) }))} aria-label="放大">＋</button>
        <button className="zoom-btn" onClick={() => setView((v) => ({ ...v, k: Math.max(0.2, v.k / 1.2) }))} aria-label="缩小">－</button>
        <button className="zoom-btn" onClick={fitView} aria-label="适应视图" title="适应视图 (F)">⤢</button>
      </div>

      {/* mini 预览浮层 */}
      {previewNode && previewLayout && (
        <MiniPreview n={previewNode} layout={previewLayout} theme={theme}
          onClose={() => app.setPreviewNodeId(null)}
          onEnter={() => { app.setPreviewNodeId(null); app.enterScope((previewNode as unknown as CallNode).targetProcessId); }} />
      )}

      {/* 内联重命名 */}
      {renaming && (() => {
        const n = nodeMap.get(renaming.id); if (!n) return null;
        return (
          <input autoFocus className="absolute field-input" defaultValue={n.name}
            style={{ left: renaming.x, top: renaming.y + 4, width: Math.max(120, renaming.w), zIndex: 30 }}
            onBlur={(e) => { const v = e.target.value.trim(); if (v) app.renameNode(renaming.id, v); setRenaming(null); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { const v = (e.target as HTMLInputElement).value.trim(); if (v) app.renameNode(renaming.id, v); setRenaming(null); }
              if (e.key === 'Escape') setRenaming(null);
            }} />
        );
      })()}
    </div>
  );
}

/* ---------------- 网格背景 ---------------- */
function GridBg({ theme }: { theme: ThemeMode }) {
  const th = THEME[theme];
  return (
    <g pointerEvents="none">
      <defs>
        <pattern id="ffgrid" width={24} height={24} patternUnits="userSpaceOnUse">
          <circle cx={1.2} cy={1.2} r={1.2} fill={th.dot} />
        </pattern>
      </defs>
      <rect x={-5000} y={-5000} width={12000} height={12000} fill="url(#ffgrid)" />
    </g>
  );
}

/* ---------------- 节点 ---------------- */
function NodeView({ n, theme, selected, hovered, previewOpen, editable, onHover, onDown, onClick, onDblClick, onStartConnect }: {
  n: RenderNode; theme: ThemeMode; selected: boolean; hovered: boolean; previewOpen: boolean; editable: boolean;
  onHover: (h: boolean) => void; onDown: (e: React.PointerEvent) => void;
  onClick: (e: React.MouseEvent) => void; onDblClick: (e: React.MouseEvent) => void;
  onStartConnect: (e: React.PointerEvent, h: Handle) => void;
}) {
  const th = THEME[theme];
  const colorKey = ((n.properties?.color as string) ?? NODE_DEFAULTS[n.type].color) as keyof typeof SHAPE_COLORS;
  const { fill, stroke } = SHAPE_COLORS[colorKey][theme];
  const text = readableOn(fill);
  const isDiamond = n.type === 'decision' || n.type === 'choice';
  const isStadium = n.type === 'start' || n.type === 'end';
  const cx = n.x + n.w / 2, cy = n.y + n.h / 2;
  const lines = wrapText(n.name, n.w - 20, 12.5);
  const startY = cy - ((lines.length - 1) * 15) / 2;
  const common = {
    onMouseEnter: () => onHover(true), onMouseLeave: () => onHover(false),
    onPointerDown: onDown, onClick, onDoubleClick: onDblClick,
    style: { cursor: editable ? 'move' : 'pointer' } as const,
  };
  let shape: React.ReactNode;
  if (isDiamond) {
    shape = <path d={`M ${cx} ${n.y} L ${n.x + n.w} ${cy} L ${cx} ${n.y + n.h} L ${n.x} ${cy} Z`}
      fill={fill} stroke={selected ? th.sel : stroke} strokeWidth={selected ? 2.4 : 1.6} />;
  } else {
    shape = <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={isStadium ? n.h / 2 : 10}
      fill={fill} stroke={selected ? th.sel : stroke} strokeWidth={selected ? 2.4 : 1.6}
      strokeDasharray={n.type === 'comment' ? '5 4' : undefined} />;
  }
  return (
    <g data-el="1" {...common}>
      {selected && <rect x={n.x - 5} y={n.y - 5} width={n.w + 10} height={n.h + 10} rx={12} fill="none" stroke={th.selGlow} strokeWidth={5} />}
      {shape}
      {n.type === 'call' && (
        <rect x={n.x + 6} y={n.y + 6} width={n.w - 12} height={n.h - 12} rx={isStadium ? n.h / 2 : 7} fill="none" stroke={stroke} strokeWidth={1.1} opacity={0.6} />
      )}
      {lines.map((l, i) => (
        <text key={i} x={cx} y={startY + i * 15} textAnchor="middle" dominantBaseline="middle"
          fontSize={12.5} fontWeight={n.type === 'call' ? 700 : 600} fill={text} fontFamily={FONT_STACK}>{l}</text>
      ))}
      {n.type === 'call' && (
        <text x={n.x + n.w - 14} y={n.y + 13} textAnchor="middle" fontSize={11} fontWeight={800} fill={text} opacity={0.75} fontFamily={FONT_STACK}>»</text>
      )}
      {/* 四锚点（仅编辑模式） */}
      {editable && (hovered || selected) && HANDLE_IDS.map((h) => {
        const p = handlePos(n, h);
        return (
          <circle key={h} cx={p.x} cy={p.y} r={5} fill={th.sel} stroke="#fff" strokeWidth={1.5}
            style={{ cursor: 'crosshair' }}
            onPointerDown={(e) => onStartConnect(e, h)} />
        );
      })}
      {previewOpen && <rect x={n.x - 3} y={n.y - 3} width={n.w + 6} height={n.h + 6} rx={12} fill="none" stroke={th.sel} strokeWidth={1.5} strokeDasharray="4 3" />}
    </g>
  );
}

/* ---------------- 连线 ---------------- */
function EdgeView({ e, s, t, theme, selected, onSelect }: {
  e: ProjectedEdge; s: RenderNode; t: RenderNode; theme: ThemeMode; selected: boolean; onSelect: () => void;
}) {
  const th = THEME[theme];
  const sp = handlePos(s, e.sourceHandle), tp = handlePos(t, e.targetHandle);
  const g = edgePath(sp, tp, e.sourceHandle, e.targetHandle, e.kind);
  const color = e.style?.color || (selected ? th.sel : th.edge);
  const labelW = e.label ? Math.max(40, estWidth(e.label, 10.5) + 16) : 0;
  return (
    <g style={{ cursor: 'pointer' }} onPointerDown={(ev) => { ev.stopPropagation(); onSelect(); }}>
      {selected && <path d={g.d} fill="none" stroke={th.selGlow} strokeWidth={7} strokeLinecap="round" />}
      <path d={g.d} fill="none" stroke={color} strokeWidth={selected ? 2.4 : 1.8} strokeLinecap="round"
        strokeDasharray={e.dashed ? '7 5' : undefined} />
      <path d={g.d} fill="none" stroke="transparent" strokeWidth={16} />
      <polygon points={arrowPts(g.ax, g.ay, g.ang, 12)} fill={color} />
      {e.label && (
        <g>
          <rect x={g.labelX - labelW / 2} y={g.labelY - 11} width={labelW} height={20} rx={6} fill={th.edgeLabelBg} stroke={selected ? th.sel : th.edgeLabelBorder} />
          <text x={g.labelX} y={g.labelY + 1} textAnchor="middle" dominantBaseline="middle" fontSize={10.5} fill={th.edgeLabelText} fontFamily={FONT_STACK}>{e.label}</text>
        </g>
      )}
    </g>
  );
}

/* ---------------- 面包屑 ---------------- */
function Breadcrumbs() {
  const app = useScope();
  const th = THEME[app.theme];
  const page = app.project.pages.find((p) => p.id === app.scope.pageId);
  const names = app.scopeStack.map((s) => app.project.processes.find((p) => p.id === s.processId)?.name).filter(Boolean) as string[];
  return (
    <div className="absolute left-3 top-3 flex items-center gap-1 rounded-lg px-2 py-1.5"
      style={{ background: 'var(--panel)', border: '1px solid var(--border)', boxShadow: 'var(--shadow)', maxWidth: '70%' }}>
      {app.canBack && (
        <button onClick={app.back} className="px-1.5 py-0.5 rounded text-[12px] font-bold transition-colors hover:bg-[var(--panel-2)]"
          style={{ color: 'var(--accent)' }} title="返回上级 (Alt+←)">←</button>
      )}
      <span className="text-[11.5px] font-semibold truncate" style={{ color: 'var(--muted)' }}>{page?.name}</span>
      {names.map((nm, i) => (
        <span key={i} className="flex items-center gap-1 min-w-0">
          <span style={{ color: 'var(--muted)' }}>/</span>
          <button
            className="text-[11.5px] font-bold truncate transition-colors hover:underline"
            style={{ color: i === names.length - 1 ? th.sel : 'var(--text)' }}
            onClick={() => { const pid = app.scopeStack[i].processId; if (pid) app.gotoProcess(pid); }}>
            {nm}
          </button>
        </span>
      ))}
    </div>
  );
}

/* ---------------- mini 预览浮层 ---------------- */
function MiniPreview({ n, layout, theme, onClose, onEnter }: {
  n: RenderNode; layout: MiniLayout; theme: ThemeMode; onClose: () => void; onEnter: () => void;
}) {
  const th = THEME[theme];
  const target = (n as CallNode).targetProcessId;
  const W = Math.min(420, layout.width), H = Math.min(300, layout.height);
  return (
    <div className="absolute rounded-xl overflow-hidden z-20"
      style={{
        left: n.x, top: n.y, width: W + 2, maxHeight: 340,
        background: 'var(--panel)', border: `1.5px solid ${th.sel}`, boxShadow: '0 8px 28px rgba(0,0,0,.28)',
      }}>
      <div className="flex items-center justify-between px-3 py-1.5" style={{ background: 'var(--panel-2)', borderBottom: '1px solid var(--border)' }}>
        <span className="text-[11.5px] font-bold truncate" style={{ color: 'var(--text)' }}>{n.name}</span>
        <button onClick={onClose} className="text-[13px] leading-none px-1" style={{ color: 'var(--muted)' }} aria-label="关闭预览">✕</button>
      </div>
      <svg width={W} height={Math.min(280, layout.height)} className="block">
        {layout.edges.map((e, i) => (
          <g key={i}>
            <line x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} stroke={th.edge} strokeWidth={1.2} />
            <polygon points={arrowPts(e.x2, e.y2, Math.atan2(e.y2 - e.y1, e.x2 - e.x1), 7)} fill={th.edge} />
          </g>
        ))}
        {layout.nodes.map((mn) => {
          const key = (NODE_DEFAULTS[mn.type]?.color ?? 'indigo') as keyof typeof SHAPE_COLORS;
          const { fill, stroke } = SHAPE_COLORS[key][theme];
          return (
            <g key={mn.id}>
              <rect x={mn.x} y={mn.y} width={mn.w} height={mn.h} rx={7} fill={fill} stroke={stroke} strokeWidth={1.2} />
              <text x={mn.x + mn.w / 2} y={mn.y + mn.h / 2 + 1} textAnchor="middle" dominantBaseline="middle"
                fontSize={10} fontWeight={600} fill={readableOn(fill)} fontFamily={FONT_STACK}>{mn.name}</text>
            </g>
          );
        })}
      </svg>
      <button onClick={onEnter} className="w-full py-1.5 text-[11.5px] font-bold transition-colors hover:opacity-90"
        style={{ background: th.sel, color: '#fff' }}>
        进入此子流程 →
      </button>
    </div>
  );
}

/* ---------------- 全局调用图层（Overview） ---------------- */
const OV_COLORS: (keyof typeof SHAPE_COLORS)[] = ['indigo', 'green', 'amber', 'sky', 'violet', 'rose', 'slate'];
function rectBorderPoint(cx: number, cy: number, w: number, h: number, tx: number, ty: number): Position {
  const dx = tx - cx, dy = ty - cy;
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return { x: cx, y: cy };
  const sx = dx !== 0 ? (w / 2) / Math.abs(dx) : Infinity;
  const sy = dy !== 0 ? (h / 2) / Math.abs(dy) : Infinity;
  const t = Math.min(sx, sy);
  return { x: cx + dx * t, y: cy + dy * t };
}
function OverviewLayer({ graph, positions, theme, selected, preview, processes, onSelect, onDbl, onDown }: {
  graph: { nodes: { id: ID; name: string; nodeCount: number; callCount: number }[]; edges: { source: ID; target: ID }[] };
  positions: Record<ID, Position>; theme: ThemeMode; selected: ID | null; preview: ID | null;
  processes: Process[];
  onSelect: (id: ID) => void; onDbl: (id: ID) => void; onDown: (e: React.PointerEvent, id: ID) => void;
}) {
  const th = THEME[theme];
  const W = OVERVIEW_CARD.w, H = OVERVIEW_CARD.h;
  const center = (id: ID): Position => {
    const p = positions[id] ?? { x: 0, y: 0 };
    return { x: p.x + W / 2, y: p.y + H / 2 };
  };
  return (
    <g>
      {/* 调用边 */}
      {graph.edges.map((e, i) => {
        const sc = center(e.source), tc = center(e.target);
        const sp = rectBorderPoint(sc.x, sc.y, W, H, tc.x, tc.y);
        const tp = rectBorderPoint(tc.x, tc.y, W, H, sc.x, sc.y);
        const ang = Math.atan2(tp.y - sp.y, tp.x - sp.x);
        return (
          <g key={i}>
            <line x1={sp.x} y1={sp.y} x2={tp.x} y2={tp.y} stroke={th.edge} strokeWidth={1.6} strokeDasharray="6 4" opacity={0.7} />
            <polygon points={arrowPts(tp.x, tp.y, ang, 11)} fill={th.edge} opacity={0.85} />
          </g>
        );
      })}
      {/* 流程卡片 */}
      {graph.nodes.map((n, idx) => {
        const p = positions[n.id] ?? { x: 0, y: 0 };
        const key = OV_COLORS[idx % OV_COLORS.length];
        const { fill, stroke } = SHAPE_COLORS[key][theme];
        const isSel = selected === n.id, isPrev = preview === n.id;
        const text = readableOn(fill);
        return (
          <g key={n.id} data-el="1" style={{ cursor: 'pointer' }}
            onPointerDown={(e) => onDown(e, n.id)}
            onClick={(e) => { e.stopPropagation(); onSelect(n.id); }}
            onDoubleClick={(e) => { e.stopPropagation(); onDbl(n.id); }}>
            {(isSel || isPrev) && <rect x={p.x - 5} y={p.y - 5} width={W + 10} height={H + 10} rx={15} fill="none" stroke={th.selGlow} strokeWidth={5} />}
            <rect x={p.x} y={p.y} width={W} height={H} rx={12} fill={fill}
              stroke={isSel || isPrev ? th.sel : stroke} strokeWidth={isSel || isPrev ? 2.4 : 1.6} />
            <rect x={p.x} y={p.y} width={5} height={H} rx={2.5} fill={stroke} />
            <text x={p.x + 16} y={p.y + 26} fontSize={13} fontWeight={700} fill={text} fontFamily={FONT_STACK}>{n.name}</text>
            <text x={p.x + 16} y={p.y + 46} fontSize={10.5} fill={text} opacity={0.75} fontFamily={FONT_STACK}>
              {n.nodeCount} 节点 · {n.callCount} 调用
            </text>
            <text x={p.x + W - 14} y={p.y + 16} textAnchor="middle" fontSize={12} fontWeight={800} fill={text} opacity={0.7} fontFamily={FONT_STACK}>»</text>
          </g>
        );
      })}
    </g>
  );
}
