/**
 * WhiteboardEditor —— 白板：
 *  - 插入本地图片（FileReader → dataURL），图片可拖动 / 缩放
 *  - 在图片之上叠加形状：矩形 / 椭圆 / 箭头 / 直线 / 文本
 *  - 形状可调：填充、边线色、边线宽、尺寸、文字；支持置顶/置底
 *  - 工具：选择 / 手（平移）/ 各形状；拖拽绘制，松手成形
 *  - 导出 PNG（含图片与全部形状，所见即所得）
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../store';
import {
  useHistory, BkIcon, BI, BOARD_COLORS, NEUTRAL_STROKES, hexToRgba, wrapText,
  ResizeHandles, svgToPng, downloadBlob, uid,
} from '../lib/boardkit';

/* ---------------- 数据模型 ---------------- */
type ShapeType = 'rect' | 'ellipse' | 'arrow' | 'line' | 'text';
interface WbImage { id: string; src: string; x: number; y: number; w: number; h: number }
interface WbShape {
  id: string; type: ShapeType; x: number; y: number; w: number; h: number;
  fill: string; stroke: string; strokeWidth: number; text: string;
}
interface WbDoc { images: WbImage[]; shapes: WbShape[] }
type Sel = { kind: 'image' | 'shape'; id: string } | null;
type Tool = 'select' | 'hand' | ShapeType;

const SHAPE_TOOLS: { key: ShapeType; icon: string; label: string }[] = [
  { key: 'rect', icon: BI.rect, label: '矩形' },
  { key: 'ellipse', icon: BI.ellipse, label: '椭圆' },
  { key: 'arrow', icon: BI.arrow, label: '箭头' },
  { key: 'line', icon: BI.line, label: '直线' },
  { key: 'text', icon: BI.text, label: '文本' },
];

const seedDoc: WbDoc = { images: [], shapes: [] };

let colorIdx = 0;
function nextColor(): string {
  const c = BOARD_COLORS[colorIdx % BOARD_COLORS.length].fill;
  colorIdx++;
  return c;
}

/* ---------------- 编辑器 ---------------- */
export function WhiteboardEditor() {
  const app = useApp();
  const theme = app.doc.settings.theme;
  const hist = useHistory<WbDoc>(seedDoc);
  const doc = hist.value;
  const [tool, setTool] = useState<Tool>('select');
  const [sel, setSel] = useState<Sel>(null);
  const [view, setView] = useState({ x: 60, y: 40, k: 1 });
  const [draft, setDraft] = useState<{ type: ShapeType; x: number; y: number; w: number; h: number } | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<{ mode: 'pan' | 'move'; sel: Sel; sx: number; sy: number; ox: number; oy: number } | null>(null);
  const drawRef = useRef<{ sx: number; sy: number } | null>(null);

  /* 自动保存 */
  useEffect(() => {
    const t = setTimeout(() => {
      try { localStorage.setItem('stateflow-studio.board.v1', JSON.stringify(doc)); } catch { /* 图片过大时忽略 */ }
    }, 500);
    return () => clearTimeout(t);
  }, [doc]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('stateflow-studio.board.v1');
      if (raw) { const d = JSON.parse(raw) as WbDoc; if (Array.isArray(d.images) && Array.isArray(d.shapes)) hist.set(d, false); }
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selShape = sel?.kind === 'shape' ? doc.shapes.find((s) => s.id === sel.id) ?? null : null;
  const selImage = sel?.kind === 'image' ? doc.images.find((s) => s.id === sel.id) ?? null : null;

  const toWorld = useCallback((cx: number, cy: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: (cx - r.left - view.x) / view.k, y: (cy - r.top - view.y) / view.k };
  }, [view]);

  const patchShape = useCallback((id: string, p: Partial<WbShape>, commit = true) => {
    hist.set({ ...doc, shapes: doc.shapes.map((s) => (s.id === id ? { ...s, ...p } : s)) }, commit);
  }, [doc, hist]);
  const patchImage = useCallback((id: string, p: Partial<WbImage>, commit = true) => {
    hist.set({ ...doc, images: doc.images.map((s) => (s.id === id ? { ...s, ...p } : s)) }, commit);
  }, [doc, hist]);

  /* 插入图片 */
  const onFile = (files: FileList | null) => {
    const f = files?.[0];
    if (!f || !f.type.startsWith('image/')) { app.toast('请选择图片文件', 'err'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const src = String(reader.result);
      const img = new Image();
      img.onload = () => {
        const maxW = 560;
        const w = Math.min(maxW, img.naturalWidth || maxW);
        const h = img.naturalHeight ? (w / img.naturalWidth) * img.naturalHeight : w * 0.6;
        const nn: WbImage = { id: uid('img'), src, x: 40, y: 30, w, h };
        hist.set({ ...doc, images: [...doc.images, nn] });
        setSel({ kind: 'image', id: nn.id });
        app.toast('已插入图片');
      };
      img.onerror = () => app.toast('图片加载失败', 'err');
      img.src = src;
    };
    reader.onerror = () => app.toast('读取文件失败', 'err');
    reader.readAsDataURL(f);
  };

  /* 删除选中 */
  const deleteSel = useCallback(() => {
    if (!sel) return;
    if (sel.kind === 'image') hist.set({ ...doc, images: doc.images.filter((i) => i.id !== sel.id) });
    else hist.set({ ...doc, shapes: doc.shapes.filter((s) => s.id !== sel.id) });
    setSel(null);
  }, [sel, doc, hist]);

  /* 图层 */
  const reorder = (dirn: 'front' | 'back') => {
    if (sel?.kind !== 'shape') return;
    const arr = [...doc.shapes];
    const i = arr.findIndex((s) => s.id === sel.id);
    if (i < 0) return;
    const [it] = arr.splice(i, 1);
    if (dirn === 'front') arr.push(it); else arr.unshift(it);
    hist.set({ ...doc, shapes: arr });
  };

  /* 键盘（window 级，输入框聚焦时不触发） */
  const onKey = useCallback((e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.closest('input,textarea,select') || t.isContentEditable)) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? hist.redo() : hist.undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); hist.redo(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); deleteSel(); }
    else if (e.key === 'Escape') { setSel(null); setEditId(null); }
    else if (e.key.toLowerCase() === 'v') setTool('select');
    else if (e.key.toLowerCase() === 'h') setTool('hand');
  }, [hist, sel, deleteSel]);

  useEffect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onKey]);

  /* 画布手势 */
  const onWheel = (e: React.WheelEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const k = Math.min(3, Math.max(0.15, view.k * (e.deltaY < 0 ? 1.12 : 0.89)));
    setView({ k, x: mx - ((mx - view.x) / view.k) * k, y: my - ((my - view.y) / view.k) * k });
  };

  const fit = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const items = [
      ...doc.images.map((i) => ({ x: i.x, y: i.y, w: i.w, h: i.h })),
      ...doc.shapes.map((s) => ({ x: Math.min(s.x, s.x + s.w), y: Math.min(s.y, s.y + s.h), w: Math.abs(s.w), h: Math.abs(s.h) })),
    ];
    if (!items.length) { setView({ x: 60, y: 40, k: 1 }); return; }
    const minX = Math.min(...items.map((i) => i.x)), minY = Math.min(...items.map((i) => i.y));
    const maxX = Math.max(...items.map((i) => i.x + i.w)), maxY = Math.max(...items.map((i) => i.y + i.h));
    const bw = maxX - minX + 120, bh = maxY - minY + 120;
    const k = Math.min(1.5, Math.min(el.clientWidth / bw, el.clientHeight / bh));
    setView({ k, x: (el.clientWidth - (maxX - minX) * k) / 2 - minX * k, y: (el.clientHeight - (maxY - minY) * k) / 2 - minY * k });
  }, [doc]);

  /* svg 背景手势：绘制 / 平移 */
  const onBgDown = (e: React.PointerEvent) => {
    if (e.target !== svgRef.current) return;
    const w = toWorld(e.clientX, e.clientY);
    if (tool === 'rect' || tool === 'ellipse' || tool === 'arrow' || tool === 'line') {
      drawRef.current = { sx: w.x, sy: w.y };
      setDraft({ type: tool, x: w.x, y: w.y, w: 0, h: 0 });
      (e.target as Element).setPointerCapture(e.pointerId);
    } else if (tool === 'text') {
      const nn: WbShape = { id: uid('sh'), type: 'text', x: w.x, y: w.y, w: 180, h: 44, fill: '#ffffff', stroke: '#334155', strokeWidth: 0, text: '双击编辑文本' };
      hist.set({ ...doc, shapes: [...doc.shapes, nn] });
      setSel({ kind: 'shape', id: nn.id });
      setEditId(nn.id);
      setTool('select');
    } else {
      setSel(null);
      dragRef.current = { mode: 'pan', sel: null, sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y };
      (e.target as Element).setPointerCapture(e.pointerId);
    }
  };
  const onBgMove = (e: React.PointerEvent) => {
    if (drawRef.current) {
      const w = toWorld(e.clientX, e.clientY);
      setDraft((d) => d ? { ...d, w: w.x - drawRef.current!.sx, h: w.y - drawRef.current!.sy } : d);
    } else if (dragRef.current?.mode === 'pan') {
      const d = dragRef.current;
      setView((v) => ({ ...v, x: d.ox + e.clientX - d.sx, y: d.oy + e.clientY - d.sy }));
    }
  };
  const onBgUp = () => {
    if (drawRef.current && draft) {
      const d = draft;
      const isLine = d.type === 'arrow' || d.type === 'line';
      const bigEnough = isLine ? Math.hypot(d.w, d.h) > 8 : Math.abs(d.w) > 8 && Math.abs(d.h) > 8;
      if (bigEnough) {
        const color = nextColor();
        const nn: WbShape = isLine
          ? { id: uid('sh'), type: d.type, x: d.x, y: d.y, w: d.w, h: d.h, fill: 'none', stroke: color, strokeWidth: 3, text: '' }
          : {
            id: uid('sh'), type: d.type,
            x: Math.min(d.x, d.x + d.w), y: Math.min(d.y, d.y + d.h), w: Math.abs(d.w), h: Math.abs(d.h),
            fill: color, stroke: color, strokeWidth: 2, text: '',
          };
        hist.set({ ...doc, shapes: [...doc.shapes, nn] });
        setSel({ kind: 'shape', id: nn.id });
      }
      setDraft(null);
      drawRef.current = null;
      setTool('select');
    }
    dragRef.current = null;
  };

  /* 元素拖动 */
  const startMove = (e: React.PointerEvent, s: Sel, ox: number, oy: number) => {
    if (tool !== 'select') return;
    e.stopPropagation();
    setSel(s);
    dragRef.current = { mode: 'move', sel: s, sx: e.clientX, sy: e.clientY, ox, oy };
    hist.beginBatch();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };
  const onElMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || d.mode !== 'move' || !d.sel) return;
    const dx = (e.clientX - d.sx) / view.k, dy = (e.clientY - d.sy) / view.k;
    if (d.sel.kind === 'image') patchImage(d.sel.id, { x: d.ox + dx, y: d.oy + dy }, false);
    else patchShape(d.sel.id, { x: d.ox + dx, y: d.oy + dy }, false);
  };
  const onElUp = () => {
    if (dragRef.current?.mode === 'move') hist.endBatch();
    dragRef.current = null;
  };

  /* 导出 PNG */
  const exportPng = useCallback(async () => {
    const svg = svgRef.current;
    if (!svg) return;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.querySelectorAll('[data-ui]').forEach((n) => n.remove());
    const items = [
      ...doc.images.map((i) => ({ x: i.x, y: i.y, w: i.w, h: i.h })),
      ...doc.shapes.map((s) => ({ x: Math.min(s.x, s.x + s.w), y: Math.min(s.y, s.y + s.h), w: Math.abs(s.w), h: Math.abs(s.h) })),
    ];
    const pad = 32;
    const minX = Math.min(...items.map((i) => i.x), 0) - pad, minY = Math.min(...items.map((i) => i.y), 0) - pad;
    const maxX = Math.max(...items.map((i) => i.x + i.w), 200) + pad, maxY = Math.max(...items.map((i) => i.y + i.h), 200) + pad;
    clone.setAttribute('viewBox', `${minX} ${minY} ${maxX - minX} ${maxY - minY}`);
    clone.setAttribute('width', String(maxX - minX)); clone.setAttribute('height', String(maxY - minY));
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('x', String(minX)); bg.setAttribute('y', String(minY));
    bg.setAttribute('width', String(maxX - minX)); bg.setAttribute('height', String(maxY - minY));
    bg.setAttribute('fill', theme === 'dark' ? '#0e1218' : '#ffffff');
    clone.insertBefore(bg, clone.firstChild);
    try {
      const blob = await svgToPng(clone.outerHTML, maxX - minX, maxY - minY, 2);
      downloadBlob(blob, '白板.png');
      app.toast('已导出 白板.png');
    } catch { app.toast('导出失败（图片跨域时可能受限）', 'err'); }
  }, [doc, theme, app]);

  const gridDot = theme === 'dark' ? '#232b37' : '#e3e7ec';

  return (
    <div className="flex-1 flex min-h-0">
      {/* 画布区 */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 工具条 */}
        <div className="flex items-center gap-1.5 px-3 h-12 border-b shrink-0" style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}>
          <span className="font-bold text-[13px] mr-2" style={{ color: 'var(--text)' }}>白板</span>
          <button className="btn btn-accent" onClick={() => fileRef.current?.click()} title="插入图片">
            <BkIcon d={BI.image} size={14} />插入图片
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { onFile(e.target.files); e.target.value = ''; }} />
          <div className="w-px h-5 mx-1" style={{ background: 'var(--border)' }} />
          <button className={`icon-btn ${tool === 'select' ? 'on' : ''}`} title="选择（V）" onClick={() => setTool('select')}><BkIcon d={BI.cursor} /></button>
          <button className={`icon-btn ${tool === 'hand' ? 'on' : ''}`} title="平移画布（H）" onClick={() => setTool('hand')}><BkIcon d={BI.hand} /></button>
          <div className="w-px h-5 mx-1" style={{ background: 'var(--border)' }} />
          {SHAPE_TOOLS.map((t) => (
            <button key={t.key} className={`icon-btn ${tool === t.key ? 'on' : ''}`} title={`绘制${t.label}`} onClick={() => setTool(t.key)}>
              <BkIcon d={t.icon} />
            </button>
          ))}
          <div className="flex-1" />
          <button className="icon-btn" onClick={hist.undo} disabled={!hist.canUndo} title="撤销 Ctrl+Z"><BkIcon d={BI.undo} /></button>
          <button className="icon-btn" onClick={hist.redo} disabled={!hist.canRedo} title="重做 Ctrl+Shift+Z"><BkIcon d={BI.redo} /></button>
          <div className="w-px h-5 mx-1" style={{ background: 'var(--border)' }} />
          <button className="icon-btn" onClick={() => setView((v) => ({ ...v, k: Math.max(0.15, v.k / 1.2) }))} title="缩小"><BkIcon d={BI.minus} /></button>
          <button className="icon-btn" onClick={fit} title="适应视图"><BkIcon d={BI.fit} /></button>
          <button className="icon-btn" onClick={() => setView((v) => ({ ...v, k: Math.min(3, v.k * 1.2) }))} title="放大"><BkIcon d={BI.plus} /></button>
          <button className="btn btn-accent" onClick={exportPng} title="导出 PNG"><BkIcon d={BI.download} size={14} />导出</button>
        </div>

        {/* 画布 */}
        <div ref={wrapRef} className="flex-1 relative overflow-hidden" tabIndex={0} style={{
          outline: 'none',
          background: `radial-gradient(${gridDot} 1px, transparent 1px) 0 0/24px 24px, var(--app-bg)`,
        }}>
          <svg ref={svgRef} className="w-full h-full block" onWheel={onWheel}
            onPointerDown={onBgDown} onPointerMove={onBgMove} onPointerUp={onBgUp}
            style={{ cursor: tool === 'hand' ? 'grab' : tool === 'select' ? 'default' : 'crosshair' }}>
            <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
              {/* 图片层 */}
              {doc.images.map((im) => (
                <g key={im.id}
                  onPointerDown={(e) => startMove(e, { kind: 'image', id: im.id }, im.x, im.y)}
                  onPointerMove={onElMove} onPointerUp={onElUp}
                  style={{ cursor: tool === 'select' ? 'move' : 'default', pointerEvents: tool === 'select' ? 'auto' : 'none' }}>
                  <image href={im.src} x={im.x} y={im.y} width={im.w} height={im.h}
                    preserveAspectRatio="none" style={{ borderRadius: 8 }} />
                  {sel?.kind === 'image' && sel.id === im.id && (
                    <rect x={im.x} y={im.y} width={im.w} height={im.h} fill="none" stroke="var(--accent)" strokeWidth={2 / view.k} strokeDasharray={`${6 / view.k} ${4 / view.k}`} rx={8} pointerEvents="none" />
                  )}
                  {sel?.kind === 'image' && sel.id === im.id && tool === 'select' && (
                    <g data-ui>
                      <ResizeHandles x={im.x} y={im.y} w={im.w} h={im.h} accent="var(--accent)"
                        onBegin={hist.beginBatch} onEnd={hist.endBatch}
                        onResize={(dw, dh) => patchImage(im.id, { w: Math.max(40, im.w + dw / view.k), h: Math.max(40, im.h + dh / view.k) }, false)} />
                    </g>
                  )}
                </g>
              ))}

              {/* 形状层 */}
              {doc.shapes.map((s) => {
                const isSel = sel?.kind === 'shape' && sel.id === s.id;
                const interactive = tool === 'select';
                const common = {
                  onPointerDown: (e: React.PointerEvent) => startMove(e, { kind: 'shape' as const, id: s.id }, s.x, s.y),
                  onPointerMove: onElMove,
                  onPointerUp: onElUp,
                  onDoubleClick: (e: React.MouseEvent) => { if (s.type === 'text') { e.stopPropagation(); setEditId(s.id); } },
                  style: { cursor: interactive ? 'move' : 'default', pointerEvents: (interactive ? 'auto' : 'none') as 'auto' | 'none' },
                };
                const bx = Math.min(s.x, s.x + s.w), by = Math.min(s.y, s.y + s.h);
                const bw = Math.abs(s.w), bh = Math.abs(s.h);
                return (
                  <g key={s.id} {...common}>
                    {s.type === 'rect' && (
                      <rect x={s.x} y={s.y} width={s.w} height={s.h} rx={8}
                        fill={hexToRgba(s.fill, 0.28)} stroke={s.stroke} strokeWidth={s.strokeWidth} />
                    )}
                    {s.type === 'ellipse' && (
                      <ellipse cx={s.x + s.w / 2} cy={s.y + s.h / 2} rx={s.w / 2} ry={s.h / 2}
                        fill={hexToRgba(s.fill, 0.28)} stroke={s.stroke} strokeWidth={s.strokeWidth} />
                    )}
                    {(s.type === 'arrow' || s.type === 'line') && (
                      <g>
                        <line x1={s.x} y1={s.y} x2={s.x + s.w} y2={s.y + s.h} stroke="transparent" strokeWidth={14} />
                        <line x1={s.x} y1={s.y} x2={s.x + s.w} y2={s.y + s.h} stroke={s.stroke} strokeWidth={s.strokeWidth} strokeLinecap="round" />
                        {s.type === 'arrow' && <ArrowHead x1={s.x} y1={s.y} x2={s.x + s.w} y2={s.y + s.h} color={s.stroke} size={s.strokeWidth * 3.4 + 6} />}
                      </g>
                    )}
                    {s.type === 'text' && (
                      <g>
                        <rect x={s.x} y={s.y} width={s.w} height={s.h} fill={s.strokeWidth > 0 ? hexToRgba(s.fill, 0.9) : 'transparent'}
                          stroke={s.strokeWidth > 0 ? s.stroke : 'transparent'} strokeWidth={s.strokeWidth} rx={6} />
                        {(() => {
                          const fs = 14, lh = fs * 1.4;
                          const lines = wrapText(s.text, s.w - 14, fs);
                          return (
                            <text fontSize={fs} fontWeight={600} pointerEvents="none"
                              fill={theme === 'dark' ? '#e5e7eb' : '#1e293b'}>
                              {lines.map((ln, i) => (
                                <tspan key={i} x={s.x + 8} y={s.y + 10 + fs + i * lh}>{ln}</tspan>
                              ))}
                            </text>
                          );
                        })()}
                      </g>
                    )}
                    {isSel && tool === 'select' && (
                      <g data-ui>
                        <ResizeHandles x={bx} y={by} w={bw || 1} h={bh || 1} accent="var(--accent)"
                          onBegin={hist.beginBatch} onEnd={hist.endBatch}
                          onResize={(dw, dh) => patchShape(s.id, { w: s.w + dw / view.k, h: s.h + dh / view.k }, false)} />
                      </g>
                    )}
                  </g>
                );
              })}

              {/* 绘制草稿 */}
              {draft && (draft.type === 'rect' || draft.type === 'ellipse') && (
                <rect data-ui x={Math.min(draft.x, draft.x + draft.w)} y={Math.min(draft.y, draft.y + draft.h)}
                  width={Math.abs(draft.w)} height={Math.abs(draft.h)} rx={8}
                  fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth={1.6 / view.k} strokeDasharray={`${6 / view.k} ${4 / view.k}`} />
              )}
              {draft && (draft.type === 'arrow' || draft.type === 'line') && (
                <line data-ui x1={draft.x} y1={draft.y} x2={draft.x + draft.w} y2={draft.y + draft.h}
                  stroke="var(--accent)" strokeWidth={2 / view.k} strokeDasharray={`${6 / view.k} ${4 / view.k}`} />
              )}
            </g>
          </svg>

          {/* 文本编辑框 */}
          {editId && selShape?.type === 'text' && selShape.id === editId && (
            <textarea autoFocus className="field-input absolute" defaultValue={selShape.text}
              style={{
                left: view.x + selShape.x * view.k, top: view.y + selShape.y * view.k,
                width: selShape.w * view.k, height: selShape.h * view.k, zIndex: 20, fontSize: 14 * view.k, resize: 'none',
              }}
              onBlur={(e) => { const v = e.currentTarget.value; patchShape(editId, { text: v, h: Math.max(44, selShape.h) }); setEditId(null); }}
              onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') setEditId(null); }} />
          )}

          {/* 空状态 */}
          {doc.images.length === 0 && doc.shapes.length === 0 && !draft && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3" style={{ color: 'var(--muted)' }}>
              <BkIcon d={BI.board} size={42} sw={1.2} />
              <p className="text-sm">插入一张图片，或选择上方形状工具开始标注</p>
              <button className="btn btn-accent" onClick={() => fileRef.current?.click()}><BkIcon d={BI.image} size={14} />插入图片</button>
            </div>
          )}

          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-[11px] px-3 py-1.5 rounded-full pointer-events-none"
            style={{ background: 'var(--panel)', border: '1px solid var(--border)', color: 'var(--muted)' }}>
            选择工具拖动元素 · 形状工具拖拽绘制 · Delete 删除 · 双击文本编辑
          </div>
        </div>
      </div>

      {/* 属性面板 */}
      <div className="w-[248px] shrink-0 border-l overflow-y-auto" style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}>
        <div className="px-3.5 py-3 text-[11px] font-bold tracking-wide uppercase" style={{ color: 'var(--muted)' }}>
          {selImage ? '图片属性' : selShape ? '形状属性' : '白板'}
        </div>

        {selShape && (
          <div className="px-3.5 pb-6 flex flex-col gap-4">
            <div className="text-[12px]" style={{ color: 'var(--text)' }}>
              {SHAPE_TOOLS.find((t) => t.key === selShape.type)?.label ?? '形状'}
            </div>
            {selShape.type === 'text' && (
              <Field label="文本内容">
                <textarea className="field-input" rows={2} value={selShape.text}
                  onChange={(e) => patchShape(selShape.id, { text: e.target.value })} />
              </Field>
            )}
            {selShape.type !== 'line' && selShape.type !== 'arrow' && (
              <Field label="填充色">
                <div className="flex flex-wrap gap-1.5">
                  {BOARD_COLORS.map((c) => (
                    <button key={c.key} onClick={() => patchShape(selShape.id, { fill: c.fill })}
                      className="w-6 h-6 rounded-md transition-transform hover:scale-110"
                      style={{ background: c.fill, outline: selShape.fill === c.fill ? '2px solid var(--accent)' : 'none', outlineOffset: 2 }} />
                  ))}
                </div>
              </Field>
            )}
            <Field label="边线色">
              <div className="flex flex-wrap gap-1.5">
                {NEUTRAL_STROKES.map((c) => (
                  <button key={c} onClick={() => patchShape(selShape.id, { stroke: c })}
                    className="w-6 h-6 rounded-md border transition-transform hover:scale-110"
                    style={{ background: c, outline: selShape.stroke === c ? '2px solid var(--accent)' : 'none', outlineOffset: 2 }} />
                ))}
              </div>
            </Field>
            <Field label={`边线宽 · ${selShape.strokeWidth}px`}>
              <input type="range" min={0} max={8} step={1} value={selShape.strokeWidth} className="w-full"
                onChange={(e) => patchShape(selShape.id, { strokeWidth: Number(e.target.value) })} />
            </Field>
            <Field label="尺寸（宽 × 高）">
              <div className="flex gap-2">
                <input type="number" className="field-input flex-1" value={Math.round(selShape.w)}
                  onChange={(e) => patchShape(selShape.id, { w: Number(e.target.value) || 0 })} />
                <input type="number" className="field-input flex-1" value={Math.round(selShape.h)}
                  onChange={(e) => patchShape(selShape.id, { h: Number(e.target.value) || 0 })} />
              </div>
            </Field>
            <div className="flex gap-2">
              <button className="btn flex-1 justify-center" onClick={() => reorder('front')} title="置顶"><BkIcon d={BI.front} size={13} />置顶</button>
              <button className="btn flex-1 justify-center" onClick={() => reorder('back')} title="置底"><BkIcon d={BI.back} size={13} />置底</button>
            </div>
            <button className="btn justify-center" style={{ color: '#f43f5e' }} onClick={deleteSel}>
              <BkIcon d={BI.trash} size={13} />删除
            </button>
          </div>
        )}

        {selImage && (
          <div className="px-3.5 pb-6 flex flex-col gap-4">
            <div className="rounded-lg overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
              <img src={selImage.src} alt="预览" style={{ width: '100%', display: 'block' }} />
            </div>
            <Field label="尺寸（宽 × 高）">
              <div className="flex gap-2">
                <input type="number" className="field-input flex-1" value={Math.round(selImage.w)}
                  onChange={(e) => patchImage(selImage.id, { w: Math.max(40, Number(e.target.value) || 40) })} />
                <input type="number" className="field-input flex-1" value={Math.round(selImage.h)}
                  onChange={(e) => patchImage(selImage.id, { h: Math.max(40, Number(e.target.value) || 40) })} />
              </div>
            </Field>
            <div className="flex gap-2">
              <button className="btn flex-1 justify-center" onClick={() => reorder('front')} disabled title="图片位于形状之下">形状之下</button>
            </div>
            <button className="btn justify-center" style={{ color: '#f43f5e' }} onClick={deleteSel}>
              <BkIcon d={BI.trash} size={13} />删除图片
            </button>
          </div>
        )}

        {!sel && (
          <div className="px-3.5 pb-6 flex flex-col gap-3">
            <p className="text-[12px] leading-relaxed" style={{ color: 'var(--muted)' }}>
              先插入图片作为底图，再用形状工具在图片上叠加标注。选中元素后可编辑填充、边线与尺寸。
            </p>
            <Field label="统计">
              <div className="text-[12px]" style={{ color: 'var(--text)' }}>
                {doc.images.length} 张图片 · {doc.shapes.length} 个形状
              </div>
            </Field>
          </div>
        )}
      </div>
    </div>
  );
}

function ArrowHead({ x1, y1, x2, y2, color, size }: { x1: number; y1: number; x2: number; y2: number; color: string; size: number }) {
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const a = size;
  const p1x = x2 - a * Math.cos(ang - Math.PI / 7), p1y = y2 - a * Math.sin(ang - Math.PI / 7);
  const p2x = x2 - a * Math.cos(ang + Math.PI / 7), p2y = y2 - a * Math.sin(ang + Math.PI / 7);
  return <polygon points={`${x2},${y2} ${p1x},${p1y} ${p2x},${p2y}`} fill={color} />;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold mb-1.5" style={{ color: 'var(--muted)' }}>{label}</div>
      {children}
    </div>
  );
}
