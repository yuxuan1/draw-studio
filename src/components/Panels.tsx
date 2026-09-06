/* ============================================================
 * Panels —— 左侧工具箱（可收纳 / 可拖拽入画布）+ 右侧属性检查器
 * 颜色选择器展示「当前主题」下的实际颜色，保证所见即所得。
 * ============================================================ */
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useStudio } from '../store';
import type { Tool } from '../store';
import {
  COLOR_ORDER, COLOR_LABELS, PALETTES, SHAPE_COLOR_ORDER, SHAPE_COLORS,
  nodeSize, formatLabel,
} from '../lib/core';
import type { PaletteColor, ProjectTransition, ShapeColorKey, FlowEdge, FlowEdgeStyle } from '../lib/core';
import { makeFlowNode } from '../lib/core';
import { findFlowNode, updateFlowNode, toggleSubInDoc, layoutFlowGraph, distribute, mapAllFlowEdges } from '../lib/studio';
import type { AlItem } from '../lib/studio';

/* ---------- 内联图标 ---------- */
const sv = (d: string, s = 16) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);
export const Ic = {
  rect: sv('M4 6h16v12H4z'),
  diamond: sv('M12 4l8 8-8 8-8-8z'),
  capsule: sv('M8 6h8a6 6 0 0 1 0 12H8a6 6 0 0 1 0-12z'),
  io: sv('M8 6h12l-4 12H4z'),
  sub: sv('M4 5h16v14H4zm3 3h10v8H7z'),
  circle: sv('M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14z'),
  junction: sv('M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm0 5a2 2 0 1 0 0 4'),
  image: sv('M4 5h16v14H4zm4 10-2.5 3h13L15 13.5 12.5 16 10 13l-2 2Zm10-6.5a1.5 1.5 0 1 0 0-3'),
  ellipse: sv('M12 6c5 0 8 2.7 8 6s-3 6-8 6-8-2.7-8-6 3-6 8-6z'),
  arrow: sv('M4 12h14m-5-5 5 5-5 5'),
  line: sv('M5 19 19 5'),
  text: sv('M5 6h14M12 6v13'),
  chevL: sv('M15 6l-6 6 6 6'),
  chevR: sv('M9 6l6 6-6 6'),
  trash: sv('M5 7h14M9 7V5h6v2m-8 0 1 13h8l1-13'),
  expand: sv('M4 9V4h5M20 15v5h-5M4 4l6 6M20 20l-6-6'),
  alignL: sv('M5 4v16M9 7h9v3H9zM9 14h6v3H9z'),
  alignC: sv('M12 4v16M7 7h10v3H7zM9 14h6v3H9z'),
  alignR: sv('M19 4v16M6 7h9v3H6zM9 14h6v3H9z'),
  alignT: sv('M4 5h16M7 9h3v9H7zM14 9h3v5h-3z'),
  alignM: sv('M4 12h16M7 7h3v10H7zM14 9h3v6h-3z'),
  alignB: sv('M4 19h16M7 6h3v9H7zM14 10h3v5h-3z'),
  distH: sv('M4 4v16M20 4v16M10 9h4v6h-4z'),
  distV: sv('M4 4h16M4 20h16M9 10h6v4H9z'),
};

function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="px-3.5 pt-3.5">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10.5px] font-bold tracking-wider" style={{ color: 'var(--muted)' }}>{title}</span>
        {right}
      </div>
      {children}
    </div>
  );
}

function ToolBtn({ icon, label, active, onClick, dragTool, title }: {
  icon: ReactNode; label: string; active: boolean; onClick: () => void; dragTool?: Tool; title?: string;
}) {
  return (
    <button
      draggable={!!dragTool}
      onDragStart={(e) => { if (dragTool) { e.dataTransfer.setData('text/x-sf-tool', dragTool); e.dataTransfer.effectAllowed = 'copy'; } }}
      onClick={onClick} title={title ?? label} aria-label={label}
      className="flex flex-col items-center justify-center gap-1 py-2 rounded-lg border transition-all cursor-grab active:cursor-grabbing hover:-translate-y-0.5"
      style={{
        borderColor: active ? 'var(--accent)' : 'var(--border)',
        background: active ? 'var(--accent-soft)' : 'var(--panel-2)',
        color: active ? 'var(--accent)' : 'var(--muted)',
        boxShadow: active ? 'var(--shadow)' : 'none',
      }}>
      {icon}
      <span className="text-[10px] font-semibold leading-none">{label}</span>
    </button>
  );
}

function ToggleRow({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-[11.5px] font-medium" style={{ color: 'var(--text)' }}>{label}</span>
      <button className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)} aria-label={label}>
        <span className="absolute top-[2px] rounded-full bg-white transition-all"
          style={{ width: 15, height: 15, left: on ? 17 : 2, boxShadow: '0 1px 2px rgba(0,0,0,.25)' }} />
      </button>
    </div>
  );
}

/* ================= 左侧工具箱 ================= */
export function LeftPanel({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const app = useStudio();
  const { page, tool, setTool, updatePage, theme, doc } = app;

  const insertImage = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const src = String(reader.result);
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 640 / img.naturalWidth);
        updatePage((p) => ({ ...p, wbShapes: [...p.wbShapes, { id: `w_${Date.now().toString(36)}`, kind: 'image', x: 80, y: 80, w: Math.round(img.naturalWidth * k), h: Math.round(img.naturalHeight * k), fill: 'none', stroke: 'transparent', strokeWidth: 0, src }] }));
        app.toast('图片已插入，可在其上叠加形状');
      };
      img.onerror = () => app.toast('图片加载失败', 'err');
      img.src = src;
    };
    reader.readAsDataURL(file);
  };

  if (!open) {
    return (
      <div className="w-[30px] flex-none flex flex-col items-center pt-2" style={{ background: 'var(--panel)', borderRight: '1px solid var(--border)' }}>
        <button onClick={onToggle} title="展开工具箱" aria-label="展开工具箱"
          className="w-6 h-6 rounded-md flex items-center justify-center transition-colors hover:bg-[var(--panel-2)]" style={{ color: 'var(--muted)' }}>
          {Ic.chevR}
        </button>
      </div>
    );
  }

  return (
    <div className="w-[188px] flex-none flex flex-col overflow-y-auto" style={{ background: 'var(--panel)', borderRight: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between px-3.5 pt-2.5">
        <span className="text-[10.5px] font-bold tracking-wider" style={{ color: 'var(--muted)' }}>工具箱</span>
        <button onClick={onToggle} title="收纳工具箱" aria-label="收纳工具箱"
          className="w-5 h-5 rounded flex items-center justify-center transition-colors hover:bg-[var(--panel-2)]" style={{ color: 'var(--muted)' }}>
          {Ic.chevL}
        </button>
      </div>

      {page.type === 'canvas' ? (
        <>
          <Section title="状态机">
            <div className="grid grid-cols-3 gap-1.5">
              <ToolBtn icon={Ic.rect} label="状态" active={tool === 'sm-state'} onClick={() => setTool('sm-state')} dragTool="sm-state" title="状态，可拖入画布" />
              <ToolBtn icon={Ic.rect} label="终止" active={tool === 'sm-terminal'} onClick={() => setTool('sm-terminal')} dragTool="sm-terminal" title="终止状态（双线框）" />
              <ToolBtn icon={Ic.junction} label="连接点" active={tool === 'sm-junction'} onClick={() => setTool('sm-junction')} dragTool="sm-junction" title="连接点（分支汇合）" />
            </div>
            <p className="text-[10.5px] leading-4 mt-2" style={{ color: 'var(--muted)' }}>悬停状态拖出圆点 → 连到另一状态即创建转移</p>
          </Section>
          <Section title="流程图">
            <div className="grid grid-cols-3 gap-1.5">
              <ToolBtn icon={Ic.capsule} label="开始" active={tool === 'flow-start'} onClick={() => setTool('flow-start')} dragTool="flow-start" />
              <ToolBtn icon={Ic.rect} label="流程" active={tool === 'flow-process'} onClick={() => setTool('flow-process')} dragTool="flow-process" />
              <ToolBtn icon={Ic.diamond} label="判定" active={tool === 'flow-decision'} onClick={() => setTool('flow-decision')} dragTool="flow-decision" />
              <ToolBtn icon={Ic.io} label="输入/出" active={tool === 'flow-io'} onClick={() => setTool('flow-io')} dragTool="flow-io" />
              <ToolBtn icon={Ic.sub} label="子流程" active={tool === 'flow-subprocess'} onClick={() => setTool('flow-subprocess')} dragTool="flow-subprocess" title="可展开为完整小流程图" />
            </div>
            <div className="flex items-center gap-1.5 mt-2.5">
              <div className="seg flex-1">
                {(['LR', 'TB'] as const).map((d) => (
                  <button key={d} className={`seg-btn flex-1 ${page.flowDir === d ? 'on' : ''}`} onClick={() => updatePage((p) => ({ ...p, flowDir: d }))}>
                    {d === 'LR' ? '横向' : '纵向'}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-[10.5px] leading-4 mt-2" style={{ color: 'var(--muted)' }}>同层可自由连线 · 双击子流程展开/收纳</p>
          </Section>
        </>
      ) : (
        <Section title="白板">
          <label className="btn btn-accent justify-center w-full cursor-pointer">
            {Ic.image} 插入图片
            <input type="file" accept="image/*" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) insertImage(f); e.target.value = ''; }} />
          </label>
          <p className="text-[10.5px] leading-4 mt-2" style={{ color: 'var(--muted)' }}>图片作底图，形状可叠加其上</p>
          <div className="grid grid-cols-3 gap-1.5 mt-2.5">
            <ToolBtn icon={Ic.rect} label="矩形" active={tool === 'wb-rect'} onClick={() => setTool('wb-rect')} title="拖拽绘制" />
            <ToolBtn icon={Ic.ellipse} label="椭圆" active={tool === 'wb-ellipse'} onClick={() => setTool('wb-ellipse')} title="拖拽绘制" />
            <ToolBtn icon={Ic.arrow} label="箭头" active={tool === 'wb-arrow'} onClick={() => setTool('wb-arrow')} title="拖拽绘制" />
            <ToolBtn icon={Ic.line} label="直线" active={tool === 'wb-line'} onClick={() => setTool('wb-line')} title="拖拽绘制" />
            <ToolBtn icon={Ic.text} label="文字" active={tool === 'wb-text'} onClick={() => setTool('wb-text')} title="点击放置" />
          </div>
        </Section>
      )}

      <Section title="视图与外观">
        <ToggleRow label="网格背景" on={doc.settings.showGrid} onChange={(v) => app.set({ ...doc, settings: { ...doc.settings, showGrid: v } }, false)} />
        <ToggleRow label="对齐网格" on={doc.settings.snapToGrid} onChange={(v) => app.set({ ...doc, settings: { ...doc.settings, snapToGrid: v } }, false)} />
        <ToggleRow label="状态动作文本" on={doc.settings.showActionText} onChange={(v) => app.set({ ...doc, settings: { ...doc.settings, showActionText: v } })} />
        <div className="py-1.5">
          <span className="text-[11.5px] font-medium block mb-1.5" style={{ color: 'var(--text)' }}>状态转移线形</span>
          <div className="seg w-full">
            {([['smoothstep', '折线'], ['bezier', '曲线'], ['orthogonal', '直角'], ['straight', '直线']] as const).map(([v, t]) => (
              <button key={v} className={`seg-btn flex-1 ${doc.settings.edgeStyle === v ? 'on' : ''}`}
                onClick={() => app.set({ ...doc, settings: { ...doc.settings, edgeStyle: v } })}>{t}</button>
            ))}
          </div>
        </div>
        <div className="py-1.5">
          <span className="text-[11.5px] font-medium block mb-1.5" style={{ color: 'var(--text)' }}>流程图连线线形</span>
          <div className="seg w-full">
            {([['smoothstep', '折线'], ['orthogonal', '直角'], ['straight', '直线']] as const).map(([v, t]) => (
              <button key={v} className={`seg-btn flex-1 ${doc.settings.flowEdgeStyle === v ? 'on' : ''}`}
                onClick={() => app.set({ ...doc, settings: { ...doc.settings, flowEdgeStyle: v } })}>{t}</button>
            ))}
          </div>
        </div>
      </Section>
      <div className="mt-auto p-3.5 text-[10.5px] leading-4" style={{ color: 'var(--muted)' }}>
        <kbd>V</kbd> 选择 · <kbd>F</kbd> 适应视图<br /><kbd>Delete</kbd> 删除 · 当前主题：{theme === 'dark' ? '暗色' : '亮色'}
      </div>
    </div>
  );
}

/* ================= 右侧属性检查器 ================= */
function Head({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="px-3.5 pt-3.5 pb-2" style={{ borderBottom: '1px solid var(--border)' }}>
      <div className="text-[13px] font-bold" style={{ color: 'var(--text)' }}>{title}</div>
      {sub && <div className="text-[10.5px] mt-0.5" style={{ color: 'var(--muted)' }}>{sub}</div>}
    </div>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="px-3.5 py-1.5">
      <div className="text-[10.5px] font-semibold mb-1" style={{ color: 'var(--muted)' }}>{label}</div>
      {children}
    </div>
  );
}
function DeleteBtn({ onClick }: { onClick: () => void }) {
  return (
    <div className="px-3.5 py-2 mt-1" style={{ borderTop: '1px solid var(--border)' }}>
      <button className="btn w-full justify-center" style={{ color: 'var(--danger)', borderColor: 'color-mix(in srgb, var(--danger) 40%, transparent)' }} onClick={onClick}>
        {Ic.trash} 删除
      </button>
    </div>
  );
}

/** 主题感知色板（状态机 8 色）——展示当前主题下的实际颜色 */
function PaletteSwatches({ value, onPick }: { value: PaletteColor | undefined; onPick: (c: PaletteColor) => void }) {
  const { theme } = useStudio();
  return (
    <div className="flex flex-wrap gap-1.5">
      {COLOR_ORDER.map((c) => (
        <button key={c} title={COLOR_LABELS[c]} onClick={() => onPick(c)}
          className="w-[20px] h-[20px] rounded-full hover:scale-110 transition-transform"
          style={{ background: PALETTES[c][theme].accent, outline: value === c ? `2px solid ${PALETTES[c][theme].accent}` : 'none', outlineOffset: 2 }} />
      ))}
    </div>
  );
}
/** 主题感知形状色板（流程/白板） */
function ShapeSwatches({ value, onPick }: { value: ShapeColorKey | undefined; onPick: (c: ShapeColorKey) => void }) {
  const { theme } = useStudio();
  return (
    <div className="flex flex-wrap gap-1.5">
      {SHAPE_COLOR_ORDER.map((c) => (
        <button key={c} title={c} onClick={() => onPick(c)}
          className="w-[20px] h-[20px] rounded-md hover:scale-110 transition-transform"
          style={{ background: SHAPE_COLORS[c][theme].stroke, outline: value === c ? `2px solid var(--text)` : 'none', outlineOffset: 2 }} />
      ))}
    </div>
  );
}

export function Inspector({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const app = useStudio();
  const { sel, page } = app;
  const body = useMemo(() => {
    if (sel.ids.length > 1) return <MultiInspector />;
    if (sel.kind === 'state' && sel.id) { const s = page.states.find((x) => x.id === sel.id); return s ? <StateInspector id={s.id} /> : null; }
    if (sel.kind === 'transition' && sel.id) { const t = page.transitions.find((x) => x.id === sel.id); return t ? <TransitionInspector t={t} /> : null; }
    if (sel.kind === 'flow' && sel.id) { const n = findFlowNode(page.flowNodes, sel.id); return n ? <FlowInspector id={n.id} /> : null; }
    if (sel.kind === 'flowEdge' && sel.id) return <FlowEdgeInspector id={sel.id} />;
    if (sel.kind === 'wb' && sel.id) { const w = page.wbShapes.find((x) => x.id === sel.id); return w ? <WbInspector id={w.id} /> : null; }
    return <EmptyInspector />;
  }, [sel, page]);

  if (!open) {
    return (
      <div className="w-[30px] flex-none flex flex-col items-center pt-2" style={{ background: 'var(--panel)', borderLeft: '1px solid var(--border)' }}>
        <button onClick={onToggle} title="展开属性面板" aria-label="展开属性面板"
          className="w-6 h-6 rounded-md flex items-center justify-center transition-colors hover:bg-[var(--panel-2)]" style={{ color: 'var(--muted)' }}>
          {Ic.chevL}
        </button>
      </div>
    );
  }
  return (
    <div className="w-[236px] flex-none overflow-y-auto" style={{ background: 'var(--panel)', borderLeft: '1px solid var(--border)' }}>
      <div className="flex items-center justify-end px-2 pt-2">
        <button onClick={onToggle} title="收纳属性面板" aria-label="收纳属性面板"
          className="w-5 h-5 rounded flex items-center justify-center transition-colors hover:bg-[var(--panel-2)]" style={{ color: 'var(--muted)' }}>
          {Ic.chevR}
        </button>
      </div>
      {body}
    </div>
  );
}

function EmptyInspector() {
  return (
    <div className="px-3.5 py-6 text-center">
      <div className="text-[12px] font-semibold mb-1" style={{ color: 'var(--text)' }}>未选中元素</div>
      <p className="text-[10.5px] leading-4" style={{ color: 'var(--muted)' }}>
        点击选中元素查看属性<br />框选或按住 <kbd>Ctrl</kbd> 点击可多选<br />多选后可对齐与分布
      </p>
    </div>
  );
}

/* ---------- 状态 ---------- */
function StateInspector({ id }: { id: string }) {
  const app = useStudio();
  const s = app.page.states.find((x) => x.id === id)!;
  const up = (patch: Partial<typeof s>) => app.updatePage((p) => ({ ...p, states: p.states.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
  const isStart = s.id === '__start__';
  return (
    <>
      <Head title="状态" sub="状态机元素" />
      <Field label="名称">
        <input className="field-input w-full" value={s.name} disabled={isStart}
          onChange={(e) => up({ name: e.target.value })} />
      </Field>
      <Field label="类型">
        <select className="field-input w-full" value={s.kind} disabled={isStart}
          onChange={(e) => up({ kind: e.target.value as typeof s.kind })}>
          <option value="state">普通状态</option><option value="terminal">终止状态</option>
          <option value="junction">连接点</option><option value="start">初始结点</option>
        </select>
      </Field>
      <Field label="配色"><PaletteSwatches value={s.color} onPick={(c) => up({ color: c })} /></Field>
      <Field label="entry 动作"><textarea className="field-input w-full font-code !text-[11px]" rows={2} value={s.entry ?? ''} onChange={(e) => up({ entry: e.target.value || undefined })} /></Field>
      <Field label="during 动作"><textarea className="field-input w-full font-code !text-[11px]" rows={2} value={s.during ?? ''} onChange={(e) => up({ during: e.target.value || undefined })} /></Field>
      <Field label="exit 动作"><textarea className="field-input w-full font-code !text-[11px]" rows={2} value={s.exit ?? ''} onChange={(e) => up({ exit: e.target.value || undefined })} /></Field>
      {!isStart && <DeleteBtn onClick={app.deleteSel} />}
    </>
  );
}

/* ---------- 状态转移 ---------- */
function TransitionInspector({ t }: { t: ProjectTransition }) {
  const app = useStudio();
  const { doc } = app;
  const up = (patch: Partial<ProjectTransition>) => app.updatePage((p) => ({ ...p, transitions: p.transitions.map((x) => (x.id === t.id ? { ...x, ...patch } : x)) }));
  const seg = (label: string, key: 'event' | 'condition' | 'conditionAction' | 'transitionAction', ph: string) => (
    <Field label={label}>
      <input className="field-input w-full !text-[11.5px] font-code" value={t[key] ?? ''} placeholder={ph}
        onChange={(e) => up({ [key]: e.target.value || undefined } as Partial<ProjectTransition>)} />
    </Field>
  );
  return (
    <>
      <Head title="状态转移" sub="Stateflow 风格标签" />
      <div className="px-3.5 py-2">
        <div className="rounded-lg px-2.5 py-1.5 font-code text-[11px] break-all"
          style={{ background: 'var(--panel-2)', border: '1px solid var(--border)', color: 'var(--accent)' }}>
          {formatLabel(t) || '（默认转移）'}
        </div>
      </div>
      {seg('事件 event', 'event', 'TICK / CMD_START')}
      {seg('守卫条件 [condition]', 'condition', 'cnt >= 30')}
      {seg('条件动作 {action}', 'conditionAction', 'cnt = 0;')}
      {seg('转移动作 /action', 'transitionAction', 'next();')}
      <Field label="连线形状">
        <div className="seg w-full">
          {([[undefined, '全局'], ['bezier', '曲线'], ['smoothstep', '折线'], ['orthogonal', '直角'], ['straight', '直线']] as const).map(([v, lab]) => (
            <button key={String(v)} className={`seg-btn flex-1 ${t.lineStyle === v ? 'on' : ''}`}
              onClick={() => up({ lineStyle: v as ProjectTransition['lineStyle'] })}>{lab}</button>
          ))}
        </div>
      </Field>
      {(t.lineStyle ?? doc.settings.edgeStyle) !== 'straight' && (t.lineStyle ?? doc.settings.edgeStyle) !== undefined && (
        <Field label={`曲率${t.bend ? `（${t.bend}）` : ''}`}>
          <button className="btn w-full justify-center !text-[11px]" onClick={() => up({ bend: undefined })}>{Ic.expand} 重置曲率</button>
          <p className="text-[10px] mt-1" style={{ color: 'var(--muted)' }}>选中连线后拖动线上的圆形手柄调整</p>
        </Field>
      )}
      <div className="px-3.5 py-1.5 flex items-center justify-between">
        <span className="text-[11.5px] font-medium" style={{ color: 'var(--text)' }}>显示该转移</span>
        <button className={`switch ${t.enabled ? 'on' : ''}`} onClick={() => up({ enabled: !t.enabled })} aria-label="显示该转移">
          <span className="absolute top-[2px] rounded-full bg-white transition-all" style={{ width: 15, height: 15, left: t.enabled ? 17 : 2 }} />
        </button>
      </div>
      <div className="px-3.5 py-1.5 flex items-center justify-between">
        <span className="text-[11.5px] font-medium" style={{ color: 'var(--text)' }}>虚线</span>
        <button className={`switch ${t.dashed ? 'on' : ''}`} onClick={() => up({ dashed: !t.dashed })} aria-label="虚线">
          <span className="absolute top-[2px] rounded-full bg-white transition-all" style={{ width: 15, height: 15, left: t.dashed ? 17 : 2 }} />
        </button>
      </div>
      <Field label="线颜色"><PaletteSwatches value={t.lineColor} onPick={(c) => up({ lineColor: c })} /></Field>
      <Field label="线宽">
        <div className="seg w-full">
          {[undefined, 1, 1.6, 2.2, 3].map((w) => (
            <button key={String(w)} className={`seg-btn flex-1 ${t.lineWidth === w ? 'on' : ''}`} onClick={() => up({ lineWidth: w })}>{w === undefined ? '全局' : w}</button>
          ))}
        </div>
      </Field>
      <DeleteBtn onClick={app.deleteSel} />
    </>
  );
}

/* ---------- 流程结点 ---------- */
function FlowInspector({ id }: { id: string }) {
  const app = useStudio();
  const n = findFlowNode(app.page.flowNodes, id)!;
  const up = (patch: Parameters<typeof updateFlowNode>[2]) => app.updatePage((p) => ({ ...p, flowNodes: updateFlowNode(p.flowNodes, id, patch) }));
  const isSub = n.kind === 'subprocess';
  const KINDS = [
    { v: 'start', t: '开始/结束' }, { v: 'process', t: '流程' }, { v: 'decision', t: '判定' },
    { v: 'io', t: '输入/输出' }, { v: 'subprocess', t: '子流程' },
  ] as const;
  return (
    <>
      <Head title={isSub ? '子流程' : '流程结点'} sub={isSub ? '可展开为完整小流程图' : '同层可自由连线'} />
      <Field label="文本">
        <input className="field-input w-full" value={n.text} onChange={(e) => up({ text: e.target.value })} />
      </Field>
      <Field label="类型">
        <select className="field-input w-full" value={n.kind}
          onChange={(e) => {
            const k = e.target.value as typeof n.kind;
            up(k === 'subprocess' ? { kind: k, inner: n.inner ?? { nodes: [], edges: [] }, expanded: false } : { kind: k });
          }}>
          {KINDS.map((k) => <option key={k.v} value={k.v}>{k.t}</option>)}
        </select>
      </Field>
      <Field label="填充"><ShapeSwatches value={n.color} onPick={(c) => up({ color: c })} /></Field>
      <Field label="尺寸">
        <div className="flex gap-1.5 items-center">
          <input type="number" className="field-input flex-1" value={Math.round(n.w)} min={40} onChange={(e) => up({ w: Math.max(40, Number(e.target.value) || 40) })} />
          <span style={{ color: 'var(--muted)' }}>×</span>
          <input type="number" className="field-input flex-1" value={Math.round(n.h)} min={28} onChange={(e) => up({ h: Math.max(28, Number(e.target.value) || 28) })} />
        </div>
      </Field>
      {isSub && (
        <>
          <div className="px-3.5 py-1.5 flex items-center justify-between">
            <span className="text-[11.5px] font-medium" style={{ color: 'var(--text)' }}>展开（{n.inner?.nodes.length ?? 0} 个内部节点）</span>
            <button className={`switch ${n.expanded ? 'on' : ''}`}
              onClick={() => {
                const r = toggleSubInDoc(app.page.flowNodes, app.page.flowEdges, n.id, app.page.flowDir);
                app.updatePage((p) => ({ ...p, flowNodes: r.nodes, flowEdges: r.edges }));
              }} aria-label="展开子流程">
              <span className="absolute top-[2px] rounded-full bg-white transition-all" style={{ width: 15, height: 15, left: n.expanded ? 17 : 2 }} />
            </button>
          </div>
          <div className="px-3.5 pb-2 flex gap-1.5">
            <button className="btn flex-1 justify-center !text-[11px]" onClick={() => {
              const inner = n.inner ?? { nodes: [], edges: [] };
              const nn = makeFlowNode('process', 20 + inner.nodes.length * 30, 20);
              let fnodes = updateFlowNode(app.page.flowNodes, n.id, { inner: { ...inner, nodes: [...inner.nodes, nn] } });
              if (!n.expanded) fnodes = toggleSubInDoc(fnodes, app.page.flowEdges, n.id, app.page.flowDir).nodes;
              else fnodes = updateFlowNode(fnodes, n.id, { inner: { nodes: layoutFlowGraph([...inner.nodes, nn], inner.edges, app.page.flowDir), edges: inner.edges } });
              app.updatePage((p) => ({ ...p, flowNodes: fnodes }));
              app.setSel({ kind: 'flow', id: nn.id });
            }}>＋ 内部节点</button>
            <button className="btn flex-1 justify-center !text-[11px]" onClick={() => {
              const inner = n.inner; if (!inner || !inner.nodes.length) return;
              up({ inner: { ...inner, nodes: layoutFlowGraph(inner.nodes, inner.edges, app.page.flowDir) } });
            }}>{Ic.expand} 整理内部</button>
          </div>
          <p className="px-3.5 pb-2 text-[10.5px] leading-4" style={{ color: 'var(--muted)' }}>
            展开时在侧向弹出浮动面板（自动避让周围元素），虚线系绳连回结点。面板可拖动、内部可手动摆位，位置被记住。
          </p>
        </>
      )}
      <DeleteBtn onClick={app.deleteSel} />
    </>
  );
}

/* ---------- 流程连线 ---------- */
function FlowEdgeInspector({ id }: { id: string }) {
  const app = useStudio();
  const e = app.page.flowEdges.find((x) => x.id === id);
  if (!e) return <EmptyInspector />;
  const up = (patch: Partial<FlowEdge>) =>
    app.updatePage((p) => {
      const r = mapAllFlowEdges(p.flowNodes, p.flowEdges, id, patch);
      return { ...p, flowNodes: r.nodes, flowEdges: r.edges };
    });
  const styleVal = e.style ?? app.doc.settings.flowEdgeStyle;
  return (
    <>
      <Head title="流程连线" sub="流程图元素之间 · 同层连接" />
      <Field label="标签">
        <input className="field-input w-full" value={e.label ?? ''} placeholder="如：完成 / 通过"
          onChange={(ev) => up({ label: ev.target.value || undefined })} />
      </Field>
      <Field label="线形">
        <div className="seg w-full">
          {([['smoothstep', '折线'], ['orthogonal', '直角'], ['straight', '直线']] as [FlowEdgeStyle, string][]).map(([v, t]) => (
            <button key={v} className={`seg-btn flex-1 ${styleVal === v ? 'on' : ''}`}
              onClick={() => up({ style: v })}>{t}</button>
          ))}
        </div>
        <p className="text-[10px] mt-1.5" style={{ color: 'var(--muted)' }}>
          {e.style ? '单条覆盖（仅作用于这条连线）' : `跟随全局「${{ smoothstep: '折线', orthogonal: '直角', straight: '直线' }[app.doc.settings.flowEdgeStyle]}」`}
        </p>
      </Field>
      <div className="px-3.5 py-1.5 flex items-center justify-between">
        <span className="text-[11.5px] font-medium" style={{ color: 'var(--text)' }}>虚线</span>
        <button className={`switch ${e.dashed ? 'on' : ''}`} onClick={() => up({ dashed: !e.dashed })} aria-label="虚线">
          <span className="absolute top-[2px] rounded-full bg-white transition-all" style={{ width: 15, height: 15, left: e.dashed ? 17 : 2 }} />
        </button>
      </div>
      <DeleteBtn onClick={app.deleteSel} />
    </>
  );
}

/* ---------- 白板形状 ---------- */
function WbInspector({ id }: { id: string }) {
  const app = useStudio();
  const w = app.page.wbShapes.find((x) => x.id === id)!;
  const up = (patch: Partial<typeof w>) => app.updatePage((p) => ({ ...p, wbShapes: p.wbShapes.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
  const isShape = w.kind === 'rect' || w.kind === 'ellipse';
  return (
    <>
      <Head title="白板元素" sub={{ image: '图片底图', rect: '矩形', ellipse: '椭圆', arrow: '箭头', line: '直线', text: '文字' }[w.kind]} />
      {w.kind === 'text' && (
        <Field label="文字"><textarea className="field-input w-full" rows={3} value={w.text ?? ''} onChange={(e) => up({ text: e.target.value })} /></Field>
      )}
      {isShape && <Field label="填充"><ShapeSwatches value={w.color} onPick={(c) => up({ color: c })} /></Field>}
      {(w.kind !== 'image' && w.kind !== 'text') && (
        <Field label={`边线宽（${w.strokeWidth}）`}>
          <input type="range" min={1} max={8} step={0.5} value={w.strokeWidth} className="w-full"
            onChange={(e) => up({ strokeWidth: Number(e.target.value) })} />
        </Field>
      )}
      {w.kind !== 'image' && (
        <Field label="尺寸">
          <div className="flex gap-1.5 items-center">
            <input type="number" className="field-input flex-1" value={Math.round(w.w)} onChange={(e) => up({ w: Number(e.target.value) || 10 })} />
            <span style={{ color: 'var(--muted)' }}>×</span>
            <input type="number" className="field-input flex-1" value={Math.round(w.h)} onChange={(e) => up({ h: Number(e.target.value) || 10 })} />
          </div>
        </Field>
      )}
      <div className="px-3.5 py-1.5 flex gap-1.5">
        <button className="btn flex-1 justify-center !text-[11px]" onClick={() => {
          app.updatePage((p) => { const i = p.wbShapes.findIndex((x) => x.id === id); const arr = [...p.wbShapes]; const [it] = arr.splice(i, 1); arr.push(it); return { ...p, wbShapes: arr }; });
        }}>置顶</button>
        <button className="btn flex-1 justify-center !text-[11px]" onClick={() => {
          app.updatePage((p) => { const i = p.wbShapes.findIndex((x) => x.id === id); const arr = [...p.wbShapes]; const [it] = arr.splice(i, 1); arr.unshift(it); return { ...p, wbShapes: arr }; });
        }}>置底</button>
      </div>
      <DeleteBtn onClick={app.deleteSel} />
    </>
  );
}

/* ---------- 多选：对齐 / 分布 ---------- */
function MultiInspector() {
  const app = useStudio();
  const { sel, page, doc } = app;
  const items: AlItem[] = [];
  if (sel.kind === 'state') {
    for (const id of sel.ids) { const s = page.states.find((x) => x.id === id); if (s) { const sz = nodeSize(s, doc.settings); items.push({ id, x: s.position.x, y: s.position.y, w: sz.w, h: sz.h }); } }
  } else if (sel.kind === 'flow') {
    for (const id of sel.ids) { const n = findFlowNode(page.flowNodes, id); if (n) items.push({ id, x: n.x, y: n.y, w: n.w, h: n.h }); }
  } else if (sel.kind === 'wb') {
    for (const id of sel.ids) { const w = page.wbShapes.find((x) => x.id === id); if (w) items.push({ id, x: Math.min(w.x, w.x + w.w), y: Math.min(w.y, w.y + w.h), w: Math.abs(w.w) || 1, h: Math.abs(w.h) || 1 }); }
  }
  const applyMove = (pos: Map<string, { x: number; y: number }>) => {
    app.updatePage((p) => {
      if (sel.kind === 'state') return { ...p, states: p.states.map((s) => { const np = pos.get(s.id); return np ? { ...s, position: { x: np.x, y: np.y } } : s; }) };
      if (sel.kind === 'flow') {
        const rec = (ns: typeof p.flowNodes): typeof p.flowNodes => ns.map((n) => {
          const np = pos.get(n.id); const base = np ? { ...n, x: np.x, y: np.y } : n;
          return base.inner ? { ...base, inner: { nodes: rec(base.inner.nodes), edges: base.inner.edges } } : base;
        });
        return { ...p, flowNodes: rec(p.flowNodes) };
      }
      if (sel.kind === 'wb') return { ...p, wbShapes: p.wbShapes.map((w) => { const np = pos.get(w.id); if (!np) return w; const ox = Math.min(w.x, w.x + w.w), oy = Math.min(w.y, w.y + w.h); return { ...w, x: w.x + (np.x - ox), y: w.y + (np.y - oy) }; }) };
      return p;
    });
  };
  if (items.length < 2) return null;
  const minX = Math.min(...items.map((i) => i.x));
  const maxX2 = Math.max(...items.map((i) => i.x + i.w));
  const minY = Math.min(...items.map((i) => i.y));
  const maxY2 = Math.max(...items.map((i) => i.y + i.h));
  const mk = (fn: (i: AlItem) => { x: number; y: number }) => new Map(items.map((i) => [i.id, fn(i)]));
  const ops = [
    { k: 'l', t: '左对齐', d: Ic.alignL, run: () => mk((i) => ({ x: minX, y: i.y })) },
    { k: 'hc', t: '水平居中', d: Ic.alignC, run: () => mk((i) => ({ x: Math.round((minX + maxX2) / 2 - i.w / 2), y: i.y })) },
    { k: 'r', t: '右对齐', d: Ic.alignR, run: () => mk((i) => ({ x: maxX2 - i.w, y: i.y })) },
    { k: 'dh', t: '水平等距', d: Ic.distH, run: () => distribute(items, 'x') },
    { k: 't', t: '顶对齐', d: Ic.alignT, run: () => mk((i) => ({ x: i.x, y: minY })) },
    { k: 'vc', t: '垂直居中', d: Ic.alignM, run: () => mk((i) => ({ x: i.x, y: Math.round((minY + maxY2) / 2 - i.h / 2) })) },
    { k: 'b', t: '底对齐', d: Ic.alignB, run: () => mk((i) => ({ x: i.x, y: maxY2 - i.h })) },
    { k: 'dv', t: '垂直等距', d: Ic.distV, run: () => distribute(items, 'y') },
  ];
  return (
    <>
      <Head title={`已选中 ${items.length} 个元素`} sub={sel.kind === 'state' ? '状态' : sel.kind === 'flow' ? '流程节点' : '白板元素'} />
      <div className="px-3.5 pb-2 pt-3">
        <div className="text-[10.5px] font-bold mb-1.5" style={{ color: 'var(--muted)' }}>对齐（基准 = 选中集包围盒）</div>
        <div className="grid grid-cols-4 gap-1.5">
          {ops.map((o) => (
            <button key={o.k} title={o.t} aria-label={o.t} onClick={() => applyMove(o.run())}
              className="h-8 rounded-lg flex items-center justify-center border transition-all hover:border-[var(--accent)] hover:text-[var(--accent)] active:scale-95"
              style={{ borderColor: 'var(--border)', background: 'var(--panel-2)', color: 'var(--text)' }}>
              {o.d}
            </button>
          ))}
        </div>
        {items.length < 3 && <div className="mt-1.5 text-[10px]" style={{ color: 'var(--muted)' }}>等距分布需至少选中 3 个元素</div>}
      </div>
      <DeleteBtn onClick={app.deleteSel} />
    </>
  );
}
