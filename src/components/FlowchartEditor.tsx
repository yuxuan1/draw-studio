/**
 * FlowchartEditor —— XMind 式多级流程图：
 *  - 树形结构，任意层级；父节点可收纳/展开（折叠时显示隐藏后代数徽标）
 *  - 形状：起止（胶囊）/ 流程（矩形）/ 判定（菱形）/ 输入输出（平行四边形）
 *  - 每个结点可调：文本、形状、填充、边线色、边线宽、宽高
 *  - Tab 加子级 / Enter 加同级 / Delete 删除子树 / 双击改名
 *  - 横向(LR) / 纵向(TB) 两种自动布局，自动适应视图
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../store';
import {
  useHistory, BkIcon, BI, BOARD_COLORS, NEUTRAL_STROKES, hexToRgba, wrapText,
  ResizeHandles, Seg, uid, svgToPng, downloadBlob,
} from '../lib/boardkit';

/* ---------------- 数据模型 ---------------- */
type FlowShape = 'start' | 'process' | 'decision' | 'io';
interface FlowNode {
  id: string; text: string; shape: FlowShape; parent: string | null;
  collapsed: boolean; fill: string; stroke: string; w: number; h: number;
}
interface FlowDoc { nodes: FlowNode[]; dir: 'LR' | 'TB' }

const SHAPE_META: Record<FlowShape, { label: string; w: number; h: number }> = {
  start: { label: '起止', w: 128, h: 50 },
  process: { label: '流程', w: 148, h: 58 },
  decision: { label: '判定', w: 140, h: 76 },
  io: { label: '输入/输出', w: 148, h: 58 },
};
const SHAPE_ORDER: FlowShape[] = ['start', 'process', 'decision', 'io'];

const C = {
  indigo: '#6366f1', sky: '#0ea5e9', teal: '#14b8a6', green: '#22c55e',
  amber: '#f59e0b', rose: '#f43f5e', violet: '#8b5cf6', slate: '#64748b',
};

function seed(): FlowDoc {
  const n = (text: string, shape: FlowShape, parent: string | null, fill: string, id?: string): FlowNode => ({
    id: id ?? uid('f'), text, shape, parent, collapsed: false, fill,
    stroke: '#334155', ...{ w: SHAPE_META[shape].w, h: SHAPE_META[shape].h },
  });
  const root = n('开始', 'start', null, C.teal, 'f_root');
  const input = n('接收订单', 'io', 'f_root', C.sky);
  const check = n('库存充足？', 'decision', input.id, C.amber);
  const pay = n('生成支付单', 'process', check.id, C.indigo);
  const notify = n('通知补货', 'process', check.id, C.rose);
  const ship = n('打包发货', 'process', pay.id, C.indigo);
  const done = n('结束', 'start', ship.id, C.teal);
  return { nodes: [root, input, check, pay, notify, ship, done], dir: 'LR' };
}

/* ---------------- 树布局 ---------------- */
const HGAP = 48, VGAP = 24;
interface Laid { x: number; y: number; depth: number }

function layoutFlow(nodes: FlowNode[], dir: 'LR' | 'TB') {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const kids = new Map<string, FlowNode[]>();
  const roots: FlowNode[] = [];
  for (const n of nodes) {
    if (n.parent && byId.has(n.parent)) {
      const arr = kids.get(n.parent) ?? [];
      arr.push(n); kids.set(n.parent, arr);
    } else roots.push(n);
  }
  const cross = (n: FlowNode) => (dir === 'LR' ? n.h : n.w);
  const main = (n: FlowNode) => (dir === 'LR' ? n.w : n.h);
  const subH = new Map<string, number>();
  const maxMain = new Map<number, number>();

  const calc = (n: FlowNode, depth: number): number => {
    maxMain.set(depth, Math.max(maxMain.get(depth) ?? 0, main(n)));
    const list = n.collapsed ? [] : kids.get(n.id) ?? [];
    if (!list.length) { subH.set(n.id, cross(n)); return cross(n); }
    let sum = 0;
    for (const c of list) sum += calc(c, depth + 1);
    sum += VGAP * (list.length - 1);
    const h = Math.max(cross(n), sum);
    subH.set(n.id, h);
    return h;
  };
  roots.forEach((r) => calc(r, 0));

  const maxDepth = Math.max(0, ...maxMain.keys());
  const colX: number[] = [];
  let cursor = 0;
  for (let d = 0; d <= maxDepth; d++) { colX.push(cursor); cursor += (maxMain.get(d) ?? 140) + HGAP; }

  const pos = new Map<string, Laid>();
  const place = (n: FlowNode, depth: number, top: number) => {
    const list = n.collapsed ? [] : kids.get(n.id) ?? [];
    const h = subH.get(n.id) ?? cross(n);
    let c = top + (h - cross(n)) / 2;
    if (list.length) {
      const block = list.reduce((a, ch) => a + (subH.get(ch.id) ?? 0), 0) + VGAP * (list.length - 1);
      let ct = top + (h - block) / 2;
      for (const ch of list) { place(ch, depth + 1, ct); ct += (subH.get(ch.id) ?? 0) + VGAP; }
      const first = byId.get(list[0].id)!, last = byId.get(list[list.length - 1].id)!;
      const p1 = pos.get(list[0].id)!, p2 = pos.get(list[list.length - 1].id)!;
      const c1 = dir === 'LR' ? p1.y + first.h / 2 : p1.x + first.w / 2;
      const c2 = dir === 'LR' ? p2.y + last.h / 2 : p2.x + last.w / 2;
      c = (c1 + c2) / 2 - cross(n) / 2;
    }
    pos.set(n.id, dir === 'LR' ? { x: colX[depth], y: c, depth } : { x: c, y: colX[depth], depth });
  };
  let top = 0;
  for (const r of roots) { place(r, 0, top); top += (subH.get(r.id) ?? 0) + VGAP * 2; }

  const edges: { from: string; to: string }[] = [];
  for (const n of nodes) {
    if (n.parent && byId.has(n.parent) && pos.has(n.id) && pos.has(n.parent)) {
      edges.push({ from: n.parent, to: n.id });
    }
  }
  return { pos, byId, kids, edges };
}

function countDesc(kids: Map<string, FlowNode[]>, id: string): number {
  let c = 0;
  for (const k of kids.get(id) ?? []) { c += 1 + countDesc(kids, k.id); }
  return c;
}

/* ---------------- 形状路径 ---------------- */
function shapePath(s: FlowShape, w: number, h: number): string {
  const r = Math.min(h / 2, 24);
  switch (s) {
    case 'start':
      return `M${r} 0 H${w - r} A${r} ${r} 0 0 1 ${w - r} ${h} H${r} A${r} ${r} 0 0 1 ${r} 0 Z`;
    case 'decision':
      return `M${w / 2} 0 L${w} ${h / 2} L${w / 2} ${h} L0 ${h / 2} Z`;
    case 'io': {
      const k = Math.min(20, w * 0.16);
      return `M${k} 0 H${w} L${w - k} ${h} H0 Z`;
    }
    default:
      return `M8 0 H${w - 8} A8 8 0 0 1 ${w} 8 V${h - 8} A8 8 0 0 1 ${w - 8} ${h} H8 A8 8 0 0 1 0 ${h - 8} V8 A8 8 0 0 1 8 0 Z`;
  }
}

/* ---------------- 编辑器 ---------------- */
export function FlowchartEditor() {
  const app = useApp();
  const theme = app.doc.settings.theme;
  const hist = useHistory<FlowDoc>(seed());
  const doc = hist.value;
  const [selId, setSelId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [view, setView] = useState({ x: 80, y: 60, k: 1 });
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const panRef = useRef<{ px: number; py: number } | null>(null);

  const { pos, byId, kids, edges } = useMemo(() => layoutFlow(doc.nodes, doc.dir), [doc]);
  const sel = selId ? byId.get(selId) ?? null : null;

  /* 自动保存 */
  useEffect(() => {
    const t = setTimeout(() => {
      try { localStorage.setItem('stateflow-studio.flow.v1', JSON.stringify(doc)); } catch { /* ignore */ }
    }, 400);
    return () => clearTimeout(t);
  }, [doc]);

  /* 载入本地 */
  useEffect(() => {
    try {
      const raw = localStorage.getItem('stateflow-studio.flow.v1');
      if (raw) { const d = JSON.parse(raw) as FlowDoc; if (Array.isArray(d.nodes)) hist.set(d, false); }
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const patch = useCallback((id: string, p: Partial<FlowNode>, commit = true) => {
    hist.set({ ...doc, nodes: doc.nodes.map((n) => (n.id === id ? { ...n, ...p } : n)) }, commit);
  }, [doc, hist]);

  const addChild = useCallback((parentId: string | null) => {
    const parent = parentId ? byId.get(parentId) : undefined;
    const shape: FlowShape = parent ? 'process' : 'start';
    const nn: FlowNode = {
      id: uid('f'), text: parent ? '新流程' : '开始', shape, parent: parentId,
      collapsed: false, fill: parent ? C.indigo : C.teal, stroke: '#334155',
      w: SHAPE_META[shape].w, h: SHAPE_META[shape].h,
    };
    hist.set({
      ...doc,
      nodes: parentId
        ? doc.nodes.map((n) => (n.id === parentId ? { ...n, collapsed: false } : n)).concat(nn)
        : doc.nodes.concat(nn),
    });
    setSelId(nn.id);
    setEditId(nn.id);
  }, [doc, byId, hist]);

  const addSibling = useCallback((id: string) => {
    const cur = byId.get(id);
    if (!cur || !cur.parent) { addChild(null); return; }
    const nn: FlowNode = { ...cur, id: uid('f'), text: '新流程', collapsed: false };
    hist.set({ ...doc, nodes: doc.nodes.concat(nn) });
    setSelId(nn.id);
    setEditId(nn.id);
  }, [doc, byId, hist, addChild]);

  const removeSubtree = useCallback((id: string) => {
    const doomed = new Set<string>([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const n of doc.nodes) {
        if (n.parent && doomed.has(n.parent) && !doomed.has(n.id)) { doomed.add(n.id); changed = true; }
      }
    }
    hist.set({ ...doc, nodes: doc.nodes.filter((n) => !doomed.has(n.id)) });
    setSelId(null);
  }, [doc, hist]);

  const toggleCollapse = useCallback((id: string) => {
    const n = byId.get(id);
    if (n) patch(id, { collapsed: !n.collapsed });
  }, [byId, patch]);

  const setAllCollapsed = useCallback((v: boolean) => {
    hist.set({ ...doc, nodes: doc.nodes.map((n) => (kids.get(n.id)?.length ? { ...n, collapsed: v } : n)) });
  }, [doc, kids, hist]);

  /* 适应视图 */
  const fit = useCallback(() => {
    const el = wrapRef.current;
    if (!el || !pos.size) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [id, p] of pos) {
      const n = byId.get(id)!;
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + n.w); maxY = Math.max(maxY, p.y + n.h);
    }
    const bw = maxX - minX + 120, bh = maxY - minY + 120;
    const k = Math.min(1.4, Math.min(el.clientWidth / bw, el.clientHeight / bh));
    setView({ k, x: (el.clientWidth - (maxX - minX) * k) / 2 - minX * k, y: (el.clientHeight - (maxY - minY) * k) / 2 - minY * k });
  }, [pos, byId]);

  useEffect(() => { fit(); /* 初次与布局变化 */ }, [doc.dir]); // eslint-disable-line react-hooks/exhaustive-deps

  /* 键盘（window 级，输入框聚焦时不触发） */
  const onKey = useCallback((e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.closest('input,textarea,select') || t.isContentEditable)) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? hist.redo() : hist.undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); hist.redo(); return; }
    if (!selId) return;
    if (e.key === 'Tab') { e.preventDefault(); addChild(selId); }
    else if (e.key === 'Enter') { e.preventDefault(); addSibling(selId); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSubtree(selId); }
    else if (e.key === 'F2') { e.preventDefault(); setEditId(selId); }
    else if (e.key === ' ') { e.preventDefault(); toggleCollapse(selId); }
    else if (e.key === 'Escape') setSelId(null);
  }, [selId, hist, addChild, addSibling, removeSubtree, toggleCollapse]);

  useEffect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onKey]);

  /* 画布手势：平移 / 缩放 */
  const toWorld = (cx: number, cy: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: (cx - r.left - view.x) / view.k, y: (cy - r.top - view.y) / view.k };
  };
  const onWheel = (e: React.WheelEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const k = Math.min(2.5, Math.max(0.2, view.k * (e.deltaY < 0 ? 1.12 : 0.89)));
    setView({ k, x: mx - ((mx - view.x) / view.k) * k, y: my - ((my - view.y) / view.k) * k });
  };

  /* 导出 PNG */
  const exportPng = useCallback(async () => {
    const svg = svgRef.current;
    if (!svg) return;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.querySelectorAll('[data-ui]').forEach((n) => n.remove());
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [id, p] of pos) { const n = byId.get(id)!; minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x + n.w); maxY = Math.max(maxY, p.y + n.h); }
    const pad = 40;
    clone.setAttribute('viewBox', `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`);
    clone.setAttribute('width', String(maxX - minX + pad * 2));
    clone.setAttribute('height', String(maxY - minY + pad * 2));
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('x', String(minX - pad)); bg.setAttribute('y', String(minY - pad));
    bg.setAttribute('width', String(maxX - minX + pad * 2)); bg.setAttribute('height', String(maxY - minY + pad * 2));
    bg.setAttribute('fill', theme === 'dark' ? '#0e1218' : '#ffffff');
    clone.insertBefore(bg, clone.firstChild);
    try {
      const blob = await svgToPng(clone.outerHTML, maxX - minX + pad * 2, maxY - minY + pad * 2, 2);
      downloadBlob(blob, '流程图.png');
      app.toast('已导出 流程图.png');
    } catch { app.toast('导出失败', 'err'); }
  }, [pos, byId, theme, app]);

  const edgeColor = theme === 'dark' ? '#4b5563' : '#94a3b8';

  return (
    <div className="flex-1 flex min-h-0">
      {/* ---- 画布区 ---- */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 工具条 */}
        <div className="flex items-center gap-1.5 px-3 h-12 border-b shrink-0" style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}>
          <span className="font-bold text-[13px] mr-1" style={{ color: 'var(--text)' }}>流程图</span>
          <span className="text-[11px] mr-2" style={{ color: 'var(--muted)' }}>XMind 式多级收纳</span>
          <button className="btn" onClick={() => addChild(selId)} title="添加子级（Tab）"><BkIcon d={BI.child} size={14} />子级</button>
          <button className="btn" onClick={() => (selId ? addSibling(selId) : addChild(null))} title="添加同级（Enter）"><BkIcon d={BI.sibling} size={14} />同级</button>
          <div className="w-px h-5 mx-1" style={{ background: 'var(--border)' }} />
          <button className="btn" onClick={() => setAllCollapsed(false)} title="展开全部"><BkIcon d={BI.expand} size={14} /></button>
          <button className="btn" onClick={() => setAllCollapsed(true)} title="收纳全部（仅根级）"><BkIcon d={BI.collapse} size={14} /></button>
          <Seg value={doc.dir} onChange={(k) => hist.set({ ...doc, dir: k as 'LR' | 'TB' })}
            options={[{ key: 'LR', label: '横向' }, { key: 'TB', label: '纵向' }]} />
          <div className="flex-1" />
          <button className="icon-btn" onClick={hist.undo} disabled={!hist.canUndo} title="撤销 Ctrl+Z"><BkIcon d={BI.undo} /></button>
          <button className="icon-btn" onClick={hist.redo} disabled={!hist.canRedo} title="重做 Ctrl+Shift+Z"><BkIcon d={BI.redo} /></button>
          <div className="w-px h-5 mx-1" style={{ background: 'var(--border)' }} />
          <button className="icon-btn" onClick={() => setView((v) => ({ ...v, k: Math.max(0.2, v.k / 1.2) }))} title="缩小"><BkIcon d={BI.minus} /></button>
          <button className="icon-btn" onClick={fit} title="适应视图"><BkIcon d={BI.fit} /></button>
          <button className="icon-btn" onClick={() => setView((v) => ({ ...v, k: Math.min(2.5, v.k * 1.2) }))} title="放大"><BkIcon d={BI.plus} /></button>
          <button className="btn btn-accent" onClick={exportPng} title="导出 PNG"><BkIcon d={BI.download} size={14} />导出</button>
        </div>

        {/* 画布 */}
        <div ref={wrapRef} className="flex-1 relative overflow-hidden canvas-bg" tabIndex={0} style={{ outline: 'none' }}>
          <svg ref={svgRef} className="w-full h-full block" onWheel={onWheel}
            onPointerDown={(e) => {
              if (e.target === svgRef.current) { setSelId(null); panRef.current = { px: e.clientX, py: e.clientY }; (e.target as Element).setPointerCapture(e.pointerId); }
            }}
            onPointerMove={(e) => {
              if (!panRef.current) return;
              setView((v) => ({ ...v, x: v.x + e.clientX - panRef.current!.px, y: v.y + e.clientY - panRef.current!.py }));
              panRef.current = { px: e.clientX, py: e.clientY };
            }}
            onPointerUp={() => { panRef.current = null; }}
            style={{ cursor: panRef.current ? 'grabbing' : 'default' }}>
            <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
              {/* 连线 */}
              {edges.map((ed) => {
                const a = byId.get(ed.from)!, b = byId.get(ed.to)!;
                const pa = pos.get(ed.from)!, pb = pos.get(ed.to)!;
                let d: string;
                if (doc.dir === 'LR') {
                  const x1 = pa.x + a.w, y1 = pa.y + a.h / 2, x2 = pb.x, y2 = pb.y + b.h / 2;
                  const mx = (x1 + x2) / 2;
                  d = `M${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
                } else {
                  const x1 = pa.x + a.w / 2, y1 = pa.y + a.h, x2 = pb.x + b.w / 2, y2 = pb.y;
                  const my = (y1 + y2) / 2;
                  d = `M${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`;
                }
                return <path key={ed.to} d={d} fill="none" stroke={hexToRgba(b.fill, 0.55)} strokeWidth={2} />;
              })}

              {/* 结点 */}
              {doc.nodes.filter((n) => pos.has(n.id)).map((n) => {
                const p = pos.get(n.id)!;
                const isSel = selId === n.id;
                const hidden = n.collapsed ? countDesc(kids, n.id) : 0;
                const hasKids = (kids.get(n.id) ?? []).length > 0;
                const badge = doc.dir === 'LR'
                  ? { cx: p.x + n.w, cy: p.y + n.h / 2 }
                  : { cx: p.x + n.w / 2, cy: p.y + n.h };
                return (
                  <g key={n.id} transform={`translate(${p.x},${p.y})`}
                    style={{ cursor: 'pointer', transition: 'opacity .15s' }}
                    onPointerDown={(e) => { e.stopPropagation(); setSelId(n.id); }}
                    onDoubleClick={(e) => { e.stopPropagation(); setEditId(n.id); }}>
                    <path d={shapePath(n.shape, n.w, n.h)} fill={hexToRgba(n.fill, theme === 'dark' ? 0.32 : 0.14)}
                      stroke={isSel ? 'var(--accent)' : n.fill} strokeWidth={isSel ? 2.4 : 1.8} />
                    {isSel && <path d={shapePath(n.shape, n.w, n.h)} fill="none" stroke="var(--accent)" strokeWidth={6} opacity={0.15} />}
                    {(() => {
                      const fs = 12.5, lh = fs * 1.32;
                      const lines = wrapText(n.text, n.w - 22, fs);
                      const startY = n.h / 2 - (lines.length * lh) / 2 + fs * 0.8;
                      return (
                        <text textAnchor="middle" fontSize={fs} fontWeight={600} pointerEvents="none"
                          fill={theme === 'dark' ? '#e5e7eb' : '#1e293b'}>
                          {lines.map((ln, i) => (
                            <tspan key={i} x={n.w / 2} y={startY + i * lh}>{ln}</tspan>
                          ))}
                        </text>
                      );
                    })()}
                    {/* 收纳/展开徽标 */}
                    {hasKids && (
                      <g data-ui transform={`translate(${badge.cx},${badge.cy})`} style={{ cursor: 'pointer' }}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); toggleCollapse(n.id); }}>
                        <circle r={9} fill={n.fill} stroke={theme === 'dark' ? '#0e1218' : '#fff'} strokeWidth={2} />
                        <text y={3.5} textAnchor="middle" fontSize={9} fontWeight={700} fill="#fff">
                          {n.collapsed ? `+${hidden}` : '–'}
                        </text>
                      </g>
                    )}
                    {/* 缩放手柄 */}
                    {isSel && (
                      <g data-ui>
                        <ResizeHandles x={0} y={0} w={n.w} h={n.h} accent="var(--accent)"
                          onBegin={hist.beginBatch} onEnd={hist.endBatch}
                          onResize={(dw, dh) => patch(n.id, { w: Math.max(70, n.w + dw / view.k), h: Math.max(34, n.h + dh / view.k) }, false)} />
                      </g>
                    )}
                  </g>
                );
              })}
            </g>
          </svg>

          {/* 改名输入框 */}
          {editId && sel && editId === sel.id && pos.has(editId) && (() => {
            const p = pos.get(editId)!;
            return (
              <input autoFocus className="field-input absolute" defaultValue={sel.text}
                style={{
                  left: view.x + p.x * view.k, top: view.y + (p.y + sel.h / 2) * view.k - 15,
                  width: Math.max(120, sel.w * view.k), transform: 'translateY(0)', zIndex: 20,
                  textAlign: 'center', fontSize: 12.5,
                }}
                onBlur={(e) => { const v = e.currentTarget.value.trim(); if (v) patch(editId, { text: v }); setEditId(null); }}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  if (e.key === 'Escape') { setEditId(null); }
                }} />
            );
          })()}

          {/* 空状态 */}
          {doc.nodes.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3" style={{ color: 'var(--muted)' }}>
              <BkIcon d={BI.flow} size={40} sw={1.2} />
              <p className="text-sm">还没有结点，创建第一个根结点开始</p>
              <button className="btn btn-accent" onClick={() => addChild(null)}><BkIcon d={BI.plus} size={14} />新建根结点</button>
            </div>
          )}

          {/* 底部提示 */}
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-[11px] px-3 py-1.5 rounded-full pointer-events-none"
            style={{ background: 'var(--panel)', border: '1px solid var(--border)', color: 'var(--muted)' }}>
            Tab 加子级 · Enter 加同级 · 空格 收纳/展开 · 双击改名 · Delete 删除子树
          </div>
        </div>
      </div>

      {/* ---- 右侧属性面板 ---- */}
      <div className="w-[248px] shrink-0 border-l overflow-y-auto" style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}>
        <div className="px-3.5 py-3 text-[11px] font-bold tracking-wide uppercase" style={{ color: 'var(--muted)' }}>结点属性</div>
        {sel ? (
          <div className="px-3.5 pb-6 flex flex-col gap-4">
            <Field label="文本">
              <textarea className="field-input" rows={2} value={sel.text}
                onChange={(e) => patch(sel.id, { text: e.target.value })} />
            </Field>
            <Field label={`形状 · ${SHAPE_META[sel.shape].label}`}>
              <div className="grid grid-cols-2 gap-1.5">
                {SHAPE_ORDER.map((s) => (
                  <button key={s} onClick={() => patch(sel.id, { shape: s, w: SHAPE_META[s].w, h: SHAPE_META[s].h })}
                    className={`btn justify-center ${sel.shape === s ? 'btn-accent' : ''}`} style={{ fontSize: 11 }}>
                    {SHAPE_META[s].label}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="填充色">
              <div className="flex flex-wrap gap-1.5">
                {BOARD_COLORS.map((c) => (
                  <button key={c.key} title={c.key} onClick={() => patch(sel.id, { fill: c.fill })}
                    className="w-6 h-6 rounded-md transition-transform hover:scale-110"
                    style={{ background: c.fill, outline: sel.fill === c.fill ? '2px solid var(--accent)' : 'none', outlineOffset: 2 }} />
                ))}
              </div>
            </Field>
            <Field label="边线色">
              <div className="flex flex-wrap gap-1.5">
                {NEUTRAL_STROKES.map((c) => (
                  <button key={c} onClick={() => patch(sel.id, { stroke: c })}
                    className="w-6 h-6 rounded-md border transition-transform hover:scale-110"
                    style={{ background: c, outline: sel.stroke === c ? '2px solid var(--accent)' : 'none', outlineOffset: 2 }} />
                ))}
              </div>
            </Field>
            <Field label="尺寸（宽 × 高）">
              <div className="flex gap-2">
                <input type="number" className="field-input flex-1" value={Math.round(sel.w)}
                  onChange={(e) => patch(sel.id, { w: Math.max(70, Number(e.target.value) || 70) })} />
                <input type="number" className="field-input flex-1" value={Math.round(sel.h)}
                  onChange={(e) => patch(sel.id, { h: Math.max(34, Number(e.target.value) || 34) })} />
              </div>
            </Field>
            <div className="flex gap-2 pt-1">
              <button className="btn flex-1 justify-center" onClick={() => addChild(sel.id)}><BkIcon d={BI.child} size={13} />子级</button>
              <button className="btn flex-1 justify-center" onClick={() => addSibling(sel.id)}><BkIcon d={BI.sibling} size={13} />同级</button>
            </div>
            <button className="btn justify-center" style={{ color: '#f43f5e' }} onClick={() => removeSubtree(sel.id)}>
              <BkIcon d={BI.trash} size={13} />删除此分支
            </button>
          </div>
        ) : (
          <div className="px-3.5 pb-6 flex flex-col gap-3">
            <p className="text-[12px] leading-relaxed" style={{ color: 'var(--muted)' }}>
              点击画布中的结点编辑其形状、填充、边线与尺寸。
            </p>
            <Field label="统计">
              <div className="text-[12px]" style={{ color: 'var(--text)' }}>
                {doc.nodes.length} 个结点 · {edges.length} 条连线
              </div>
            </Field>
            <button className="btn btn-accent justify-center" onClick={() => addChild(null)}><BkIcon d={BI.plus} size={14} />新建根结点</button>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold mb-1.5" style={{ color: 'var(--muted)' }}>{label}</div>
      {children}
    </div>
  );
}
