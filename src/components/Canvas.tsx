/* ============================================================
 * 画布：平移 / 缩放 / 拖拽 / 连线 / 多选 / 重命名 / 小地图 / 缩放控件
 * ============================================================ */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../store';
import { GraphLayer } from './GraphLayer';
import type { ThemeMode } from '../lib/core';
import { PALETTES, START_ID } from '../lib/core';
import { shapesOf, docBounds } from '../lib/geometry';
import type { NodeShape } from '../lib/geometry';

type Gesture =
  | { mode: 'pan'; sx: number; sy: number; vx: number; vy: number }
  | { mode: 'nodes'; ids: string[]; startX: number; startY: number; orig: Map<string, { x: number; y: number }>; moved: boolean }
  | { mode: 'connect'; source: string }
  | { mode: 'band'; x0: number; y0: number };

export function Canvas() {
  const app = useApp();
  const { doc, sel, view } = app;
  const settings = doc.settings;
  const theme = settings.theme;

  const containerRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const sizeRef = useRef({ w: 900, h: 600 });

  const [hoverId, setHoverId] = useState<string | null>(null);
  const [pending, setPending] = useState<{ source: string; x: number; y: number } | null>(null);
  const [connectTarget, setConnectTarget] = useState<string | null>(null);
  const [band, setBand] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [panning, setPanning] = useState(false);

  const selectedStates = useMemo(() => new Set(sel.states), [sel.states]);
  const selectedTransitions = useMemo(() => new Set(sel.transitions), [sel.transitions]);
  const shapes = useMemo(() => shapesOf(doc, settings), [doc, settings]);

  /* ---------- 尺寸跟踪 ---------- */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      sizeRef.current = { w: el.clientWidth, h: el.clientHeight };
    });
    ro.observe(el);
    sizeRef.current = { w: el.clientWidth, h: el.clientHeight };
    return () => ro.disconnect();
  }, []);

  /* ---------- 视图动画 / 适应视图 ---------- */
  const animRef = useRef<number | null>(null);
  const animateView = useCallback((target: { x: number; y: number; k: number }) => {
    if (animRef.current) cancelAnimationFrame(animRef.current);
    const from = { ...viewRef.current };
    const t0 = performance.now();
    const DUR = 300;
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / DUR);
      const e = 1 - Math.pow(1 - t, 3);
      app.setView({
        x: from.x + (target.x - from.x) * e,
        y: from.y + (target.y - from.y) * e,
        k: from.k + (target.k - from.k) * e,
      });
      if (t < 1) animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
  }, [app]);

  const viewRef = useRef(view);
  viewRef.current = view;

  const fitView = useCallback((animate = true) => {
    const d = app.doc;
    const { w: cw, h: ch } = sizeRef.current;
    if (!d.states.length) {
      const target = { x: cw / 2 - 200, y: ch / 2 - 120, k: 1 };
      if (animate) animateView(target); else app.setView(target);
      return;
    }
    const b = docBounds(d, d.settings);
    const pad = 70;
    const k = Math.max(0.15, Math.min(1.4,
      Math.min((cw - pad) / Math.max(b.w, 80), (ch - pad) / Math.max(b.h, 80))));
    const target = {
      k,
      x: cw / 2 - (b.x + b.w / 2) * k,
      y: ch / 2 - (b.y + b.h / 2) * k,
    };
    if (animate) animateView(target); else app.setView(target);
  }, [app, animateView]);

  useEffect(() => {
    fitView(app.fitSignal > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.fitSignal]);

  /* ---------- 从列表定位结点 ---------- */
  useEffect(() => {
    if (!app.focusReq) return;
    const sh = shapes.get(app.focusReq.id);
    if (!sh) return;
    const { w: cw, h: ch } = sizeRef.current;
    const k = Math.max(viewRef.current.k, 0.85);
    animateView({ k, x: cw / 2 - sh.cx * k, y: ch / 2 - sh.cy * k });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.focusReq]);

  /* ---------- 滚轮缩放（原生监听，阻止被动滚动） ---------- */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const v = viewRef.current;
      const factor = Math.exp(-e.deltaY * 0.0012);
      const k = Math.max(0.15, Math.min(2.5, v.k * factor));
      const wx = (mx - v.x) / v.k, wy = (my - v.y) / v.k;
      app.setView({ k, x: mx - wx * k, y: my - wy * k });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [app]);

  /* ---------- 坐标换算 ---------- */
  const toWorld = useCallback((clientX: number, clientY: number) => {
    const rect = containerRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (clientX - rect.left - v.x) / v.k, y: (clientY - rect.top - v.y) / v.k };
  }, []);

  /* ---------- 指针交互 ---------- */
  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 && e.button !== 1) return;
    (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
    const el = e.target as Element;
    const handleEl = el.closest?.('[data-handle]');
    const nodeEl = el.closest?.('[data-node-id]');
    const edgeEl = el.closest?.('[data-edge-id]');
    const w = toWorld(e.clientX, e.clientY);

    if (handleEl && nodeEl) {
      gestureRef.current = { mode: 'connect', source: nodeEl.getAttribute('data-node-id')! };
      setPending({ source: nodeEl.getAttribute('data-node-id')!, x: w.x, y: w.y });
      return;
    }
    if (nodeEl) {
      const id = nodeEl.getAttribute('data-node-id')!;
      let ids: string[];
      if (e.shiftKey) {
        ids = sel.states.includes(id)
          ? sel.states.filter((x) => x !== id)
          : [...sel.states, id];
        app.setSel({ states: ids, transitions: [] });
      } else {
        ids = sel.states.includes(id) ? sel.states : [id];
        if (!sel.states.includes(id)) app.setSel({ states: [id], transitions: [] });
      }
      const orig = new Map<string, { x: number; y: number }>();
      ids.forEach((sid) => {
        const st = app.doc.states.find((s) => s.id === sid);
        if (st) orig.set(sid, { ...st.position });
      });
      app.beginGesture();
      gestureRef.current = { mode: 'nodes', ids, startX: w.x, startY: w.y, orig, moved: false };
      return;
    }
    if (edgeEl) {
      const id = edgeEl.getAttribute('data-edge-id')!;
      if (e.shiftKey) {
        const next = sel.transitions.includes(id)
          ? sel.transitions.filter((x) => x !== id)
          : [...sel.transitions, id];
        app.setSel({ states: [], transitions: next });
      } else {
        app.setSel({ states: [], transitions: [id] });
      }
      return;
    }
    // 空白：Shift 框选，否则平移
    if (e.shiftKey) {
      gestureRef.current = { mode: 'band', x0: w.x, y0: w.y };
      setBand({ x0: w.x, y0: w.y, x1: w.x, y1: w.y });
    } else {
      gestureRef.current = { mode: 'pan', sx: e.clientX, sy: e.clientY, vx: viewRef.current.x, vy: viewRef.current.y };
      setPanning(true);
    }
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const g = gestureRef.current;
    if (!g) {
      const nodeEl = (e.target as Element).closest?.('[data-node-id]');
      const id = nodeEl?.getAttribute('data-node-id') ?? null;
      if (id !== hoverId) setHoverId(id);
      return;
    }
    const w = toWorld(e.clientX, e.clientY);
    if (g.mode === 'pan') {
      app.setView({
        k: viewRef.current.k,
        x: g.vx + (e.clientX - g.sx),
        y: g.vy + (e.clientY - g.sy),
      });
    } else if (g.mode === 'nodes') {
      const dx = w.x - g.startX, dy = w.y - g.startY;
      if (Math.abs(dx) + Math.abs(dy) > 0.5) g.moved = true;
      const snap = app.doc.settings.snapToGrid ? 16 : 1;
      const idSet = new Set(g.ids);
      app.live({
        ...app.doc,
        states: app.doc.states.map((s) => {
          const o = g.orig.get(s.id);
          if (!o) return s;
          return {
            ...s,
            position: {
              x: Math.round((o.x + dx) / snap) * snap,
              y: Math.round((o.y + dy) / snap) * snap,
            },
          };
        }),
      });
    } else if (g.mode === 'connect') {
      setPending({ source: g.source, x: w.x, y: w.y });
      let target: string | null = null;
      for (const [id, sh] of shapes) {
        const pad = 6;
        if (w.x >= sh.x - pad && w.x <= sh.x + sh.w + pad &&
            w.y >= sh.y - pad && w.y <= sh.y + sh.h + pad) {
          target = id; break;
        }
      }
      setConnectTarget(target);
    } else if (g.mode === 'band') {
      setBand({ x0: g.x0, y0: g.y0, x1: w.x, y1: w.y });
    }
  };

  const onPointerUp = () => {
    const g = gestureRef.current;
    gestureRef.current = null;
    setPanning(false);
    if (!g) return;
    if (g.mode === 'nodes') {
      app.endGesture();
    } else if (g.mode === 'connect') {
      if (connectTarget) {
        app.addTransition(g.source, connectTarget, '');
      }
      setPending(null);
      setConnectTarget(null);
    } else if (g.mode === 'band' && band) {
      const minX = Math.min(band.x0, band.x1), maxX = Math.max(band.x0, band.x1);
      const minY = Math.min(band.y0, band.y1), maxY = Math.max(band.y0, band.y1);
      const ids: string[] = [];
      for (const [id, sh] of shapes) {
        if (sh.x + sh.w >= minX && sh.x <= maxX && sh.y + sh.h >= minY && sh.y <= maxY) ids.push(id);
      }
      app.setSel({ states: ids, transitions: [] });
      setBand(null);
    }
  };

  const onDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const el = e.target as Element;
    const nodeEl = el.closest?.('[data-node-id]');
    if (nodeEl) {
      const id = nodeEl.getAttribute('data-node-id')!;
      if (id !== START_ID) app.setRenamingId(id);
      return;
    }
    if (el.closest?.('[data-edge-id]')) return;
    const w = toWorld(e.clientX, e.clientY);
    app.addState(undefined, {
      x: Math.round((w.x - 66) / 16) * 16,
      y: Math.round((w.y - 26) / 16) * 16,
    });
  };

  /* ---------- 重命名浮层 ---------- */
  const renamingState = app.renamingId ? doc.states.find((s) => s.id === app.renamingId) : null;

  /* ---------- 缩放按钮 ---------- */
  const zoomBy = (factor: number) => {
    const v = viewRef.current;
    const { w: cw, h: ch } = sizeRef.current;
    const k = Math.max(0.15, Math.min(2.5, v.k * factor));
    const cx = cw / 2, cy = ch / 2;
    const wx = (cx - v.x) / v.k, wy = (cy - v.y) / v.k;
    animateView({ k, x: cx - wx * k, y: cy - wy * k });
  };

  const quickAdd = () => {
    const v = viewRef.current;
    const { w: cw, h: ch } = sizeRef.current;
    const wx = (cw / 2 - v.x) / v.k, wy = (ch / 2 - v.y) / v.k;
    const jitter = (doc.states.length % 5) * 24;
    app.addState(undefined, {
      x: Math.round((wx - 66 + jitter) / 16) * 16,
      y: Math.round((wy - 26 + jitter) / 16) * 16,
    });
  };

  const T = { sel: theme === 'light' ? '#0d9488' : '#2dd4bf' };

  return (
    <div
      id="canvas-root" ref={containerRef}
      className="relative flex-1 overflow-hidden select-none"
      style={{
        background: 'var(--canvas-bg)',
        backgroundImage: settings.showGrid
          ? 'radial-gradient(var(--dot) 1.1px, transparent 1.3px)'
          : undefined,
        backgroundSize: `${24 * view.k}px ${24 * view.k}px`,
        backgroundPosition: `${view.x}px ${view.y}px`,
        cursor: panning ? 'grabbing' : 'default',
      }}
    >
      <svg
        className="absolute inset-0 w-full h-full"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
      >
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          <GraphLayer
            doc={doc} theme={theme}
            interactive showEdgeLabels
            selectedStates={selectedStates}
            selectedTransitions={selectedTransitions}
            hoverId={hoverId}
            connectTargetId={connectTarget}
          />
          {/* 框选矩形 */}
          {band && (
            <rect
              x={Math.min(band.x0, band.x1)} y={Math.min(band.y0, band.y1)}
              width={Math.abs(band.x1 - band.x0)} height={Math.abs(band.y1 - band.y0)}
              fill={theme === 'light' ? 'rgba(13,148,136,0.08)' : 'rgba(45,212,191,0.10)'}
              stroke={T.sel} strokeWidth={1.2 / view.k} strokeDasharray={`${5 / view.k} ${4 / view.k}`}
            />
          )}
          {/* 连线进行中 */}
          {pending && (() => {
            const src = shapes.get(pending.source);
            if (!src) return null;
            return (
              <g pointerEvents="none">
                <line x1={src.cx} y1={src.cy} x2={pending.x} y2={pending.y}
                  stroke={T.sel} strokeWidth={1.8 / view.k} strokeDasharray={`${6 / view.k} ${5 / view.k}`}
                  className="pending-line" />
                <circle cx={pending.x} cy={pending.y} r={4.5 / view.k} fill={T.sel} />
              </g>
            );
          })()}
        </g>
      </svg>

      {/* 空状态 */}
      {doc.states.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="anim-rise text-center pointer-events-auto">
            <svg width="72" height="52" viewBox="0 0 72 52" className="mx-auto mb-4 opacity-70">
              <rect x="2" y="14" width="26" height="24" rx="6" fill="none" stroke="var(--faint)" strokeWidth="1.6" strokeDasharray="4 3" />
              <circle cx="56" cy="26" r="12" fill="none" stroke="var(--faint)" strokeWidth="1.6" strokeDasharray="4 3" />
              <path d="M30 26 H41" stroke="var(--accent)" strokeWidth="1.8" />
              <path d="M41 26 l-5 -3.4 v6.8 z" fill="var(--accent)" />
            </svg>
            <div className="text-[15px] font-bold" style={{ color: 'var(--text)' }}>画布还是空的</div>
            <div className="mt-1.5 text-[12.5px]" style={{ color: 'var(--muted)' }}>
              双击空白处新建状态 · 或在左侧「状态」页批量添加
            </div>
            <button className="btn btn-accent mt-4 mx-auto" onClick={() => app.loadSample(0)}>
              载入示例工程看看
            </button>
          </div>
        </div>
      )}

      {/* 小地图 */}
      {settings.showMiniMap && doc.states.length > 0 && (
        <MiniMap shapes={shapes} theme={theme} />
      )}

      {/* 快速添加 + 缩放控件 */}
      <div className="absolute bottom-4 right-4 flex flex-col items-end gap-2">
        <button
          className="icon-btn !w-10 !h-10 !rounded-full shadow-lg"
          style={{ background: 'var(--accent)', color: '#fff', border: 'none' }}
          title="快速添加状态" aria-label="快速添加状态"
          onClick={quickAdd}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
        <div
          className="flex flex-col rounded-[10px] overflow-hidden shadow-lg"
          style={{ background: 'var(--panel-2)', border: '1px solid var(--border)' }}
        >
          <button className="icon-btn !rounded-none" title="放大" aria-label="放大" onClick={() => zoomBy(1.25)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
          </button>
          <button
            className="!h-7 text-[11px] font-display font-bold"
            style={{ color: 'var(--muted)', background: 'transparent', border: 'none', cursor: 'pointer', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}
            title="重置为 100%" onClick={() => animateView({ ...viewRef.current, k: 1 })}
          >
            {Math.round(view.k * 100)}%
          </button>
          <button className="icon-btn !rounded-none" title="缩小" aria-label="缩小" onClick={() => zoomBy(0.8)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M5 12h14" /></svg>
          </button>
          <button className="icon-btn !rounded-none" style={{ borderTop: '1px solid var(--border)' }} title="适应视图 (F)" aria-label="适应视图" onClick={() => fitView(true)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4" />
            </svg>
          </button>
        </div>
      </div>

      {/* 行内重命名 */}
      {renamingState && (
        <RenameOverlay key={renamingState.id} id={renamingState.id} theme={theme} />
      )}
    </div>
  );
}

/* ---------------- 重命名浮层 ---------------- */

function RenameOverlay({ id, theme }: { id: string; theme: ThemeMode }) {
  const app = useApp();
  const s = app.doc.states.find((x) => x.id === id);
  const [val, setVal] = useState(s?.name ?? '');
  const cancelled = useRef(false);
  if (!s) return null;
  const { w } = (() => {
    const shapes = shapesOf(app.doc, app.doc.settings);
    return shapes.get(id) ?? { w: 140, h: 52, x: 0, y: 0 };
  })();
  const k = app.view.k;
  const left = s.position.x * k + app.view.x;
  const top = s.position.y * k + app.view.y;
  const commit = () => {
    if (cancelled.current) return;
    const name = val.trim();
    if (name) app.updateState(id, { name }); // 空名不提交
    app.setRenamingId(null);
  };
  return (
    <input
      autoFocus
      className="absolute z-30 field-input font-semibold anim-pop"
      style={{
        left: left - 4, top: top + 2 * k, width: Math.max(w * k, 130) + 8,
        height: 30 * k + 4, fontSize: 13 * k + 2,
        boxShadow: '0 0 0 3px var(--accent-soft), var(--shadow-pop)',
        background: theme === 'light' ? '#fff' : 'var(--panel-2)',
      }}
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') { cancelled.current = true; app.setRenamingId(null); }
      }}
      onFocus={(e) => e.currentTarget.select()}
    />
  );
}

/* ---------------- 小地图 ---------------- */

function MiniMap({ shapes, theme }: { shapes: Map<string, NodeShape>; theme: ThemeMode }) {
  const app = useApp();
  const ref = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ w: 800, h: 600 });
  useEffect(() => {
    const measure = () => {
      const el = ref.current?.parentElement;
      if (el) setCanvasSize({ w: el.clientWidth, h: el.clientHeight });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  const W = 168, H = 118, PAD = 8;

  const list = Array.from(shapes.values());
  const minX = Math.min(...list.map((s) => s.x)) - 30;
  const minY = Math.min(...list.map((s) => s.y)) - 30;
  const maxX = Math.max(...list.map((s) => s.x + s.w)) + 30;
  const maxY = Math.max(...list.map((s) => s.y + s.h)) + 30;
  const sc = Math.min((W - PAD * 2) / (maxX - minX), (H - PAD * 2) / (maxY - minY), 1.2);
  const ox = PAD + ((W - PAD * 2) - (maxX - minX) * sc) / 2;
  const oy = PAD + ((H - PAD * 2) - (maxY - minY) * sc) / 2;
  const px = (wx: number) => ox + (wx - minX) * sc;
  const py = (wy: number) => oy + (wy - minY) * sc;

  const { w: cw, h: ch } = canvasSize;
  const v = app.view;
  const vx = px(-v.x / v.k), vy = py(-v.y / v.k);
  const vw = (cw / v.k) * sc, vh = (ch / v.k) * sc;

  const jump = (e: React.PointerEvent) => {
    const rect = ref.current!.getBoundingClientRect();
    const wx = (e.clientX - rect.left - ox) / sc + minX;
    const wy = (e.clientY - rect.top - oy) / sc + minY;
    app.setView({ k: v.k, x: cw / 2 - wx * v.k, y: ch / 2 - wy * v.k });
  };

  return (
    <div
      ref={ref}
      className="absolute bottom-4 left-4 rounded-[10px] shadow-lg overflow-hidden anim-fade"
      style={{ width: W, height: H, background: 'var(--panel-2)', border: '1px solid var(--border)', cursor: 'pointer' }}
      onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); jump(e); }}
      onPointerMove={(e) => { if (e.buttons === 1) jump(e); }}
      title="小地图：点击定位"
    >
      <svg width={W} height={H}>
        {app.doc.transitions.filter((t) => t.enabled !== false).map((t) => {
          const a = shapes.get(t.source), b = shapes.get(t.target);
          if (!a || !b) return null;
          return <line key={t.id} x1={px(a.cx)} y1={py(a.cy)} x2={px(b.cx)} y2={py(b.cy)}
            stroke="var(--faint)" strokeWidth={1} opacity={0.6} />;
        })}
        {list.map((s) => {
          const st = app.doc.states.find((x) => x.id === s.id);
          const fill = st && st.kind !== 'start' && st.kind !== 'junction'
            ? PALETTES[st.color][theme].accent
            : theme === 'light' ? '#5f6e84' : '#8794a8';
          return (
            <rect key={s.id} x={px(s.x)} y={py(s.y)}
              width={Math.max(3, s.w * sc)} height={Math.max(3, s.h * sc)}
              rx={2} fill={fill} opacity={0.85} />
          );
        })}
        <rect x={vx} y={vy} width={vw} height={vh} rx={3}
          fill="none" stroke="var(--accent)" strokeWidth={1.5} opacity={0.9} />
      </svg>
    </div>
  );
}
