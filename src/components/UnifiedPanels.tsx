/* ============================================================
 * 左侧插入面板 + 右侧属性面板（随选择与页面类型变化）
 * ============================================================ */
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useStudio } from '../studioStore';
import { COLOR_ORDER, COLOR_LABELS, PALETTES, formatLabel } from '../lib/core';
import type { PaletteColor, ProjectTransition } from '../lib/core';
import {
  findFlowNode, layoutFlowGraph, makeFlowNode, nid, updateFlowNode, toggleSubInDoc,
} from '../lib/studio';
import type { FlowKind, WbShape } from '../lib/studio';
import { BkIcon, BI, BOARD_COLORS, NEUTRAL_STROKES } from '../lib/boardkit';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="px-3.5 pt-3.5">
      <div className="text-[10.5px] font-bold tracking-wide mb-2" style={{ color: 'var(--muted)' }}>{title}</div>
      {children}
    </div>
  );
}

function ToolBtn({ icon, label, active, onClick, title, dragTool }: {
  icon: ReactNode; label: string; active: boolean; onClick: () => void; title?: string; dragTool?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title ?? label}
      draggable={!!dragTool}
      onDragStart={(e) => {
        if (!dragTool) return;
        e.dataTransfer.setData('text/x-sf-tool', dragTool);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      className="flex flex-col items-center gap-1 py-2 rounded-lg text-[10.5px] font-semibold transition-all border"
      style={{
        borderColor: active ? 'var(--accent)' : 'var(--border)',
        background: active ? 'var(--accent-soft)' : 'var(--panel-2)',
        color: active ? 'var(--accent)' : 'var(--text)',
        cursor: dragTool ? 'grab' : 'pointer',
      }}
    >
      {icon}
      {label}
    </button>
  );
}

/* ================= 左侧面板 ================= */

export function LeftPanel() {
  const app = useStudio();
  const { page, tool, setTool, updatePage, requestFit, toast } = app;

  const insertImage = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const src = String(reader.result);
      const img = new Image();
      img.onload = () => {
        const maxW = 640;
        const k = Math.min(1, maxW / img.naturalWidth);
        const w = Math.round(img.naturalWidth * k);
        const h = Math.round(img.naturalHeight * k);
        const shape: WbShape = {
          id: nid('w'), kind: 'image', x: 80, y: 80, w, h,
          fill: 'none', stroke: 'transparent', strokeWidth: 0, src,
        };
        updatePage((p) => ({ ...p, wbShapes: [...p.wbShapes, shape] }));
        app.setSel({ kind: 'wb', id: shape.id });
        toast('图片已插入，可在其上叠加形状');
      };
      img.onerror = () => toast('图片加载失败', 'err');
      img.src = src;
    };
    reader.readAsDataURL(file);
  };

  const tidy = () => {
    if (!page.flowNodes.length) { toast('没有可排布的流程节点', 'info'); return; }
    let minX = Infinity, minY = Infinity;
    for (const n of page.flowNodes) { minX = Math.min(minX, n.x); minY = Math.min(minY, n.y); }
    const laid = layoutFlowGraph(page.flowNodes, page.flowEdges, page.flowDir)
      .map((n) => ({ ...n, x: n.x + (isFinite(minX) ? minX : 80), y: n.y + (isFinite(minY) ? minY : 80) }));
    updatePage((p) => ({ ...p, flowNodes: laid }));
    requestFit();
    toast('流程图已重新排布');
  };

  return (
    <div className="w-[188px] flex-none flex flex-col overflow-y-auto"
      style={{ background: 'var(--panel)', borderRight: '1px solid var(--border)' }}>
      {page.type === 'canvas' ? (
        <>
          <Section title="状态机">
            <div className="grid grid-cols-3 gap-1.5">
              <ToolBtn icon={<BkIcon d={BI.rect} size={17} />} label="状态" active={tool === 'sm-state'} onClick={() => setTool('sm-state')} dragTool="sm-state" title="点击选用，或拖入画布" />
              <ToolBtn icon={<BkIcon d="M5 6h14v12H5zm3 3h8v6H8z" size={17} />} label="终止" active={tool === 'sm-terminal'} onClick={() => setTool('sm-terminal')} dragTool="sm-terminal" title="终止状态（双线框），可拖入画布" />
              <ToolBtn icon={<BkIcon d="M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm0 5a2 2 0 1 0 0 4" size={17} />} label="连接点" active={tool === 'sm-junction'} onClick={() => setTool('sm-junction')} dragTool="sm-junction" title="连接点（分支汇合），可拖入画布" />
            </div>
            <p className="text-[10.5px] leading-4 mt-2" style={{ color: 'var(--muted)' }}>
              悬停状态拖出圆点 → 连到另一状态即创建转移
            </p>
          </Section>

          <Section title="流程图">
            <div className="grid grid-cols-3 gap-1.5">
              <ToolBtn icon={<BkIcon d="M5 9a7 3.5 0 0 1 14 0v6a7 3.5 0 0 1-14 0z" size={17} />} label="开始" active={tool === 'flow-start'} onClick={() => setTool('flow-start')} dragTool="flow-start" title="开始/结束，可拖入画布" />
              <ToolBtn icon={<BkIcon d={BI.rect} size={17} />} label="流程" active={tool === 'flow-process'} onClick={() => setTool('flow-process')} dragTool="flow-process" title="流程节点，可拖入画布" />
              <ToolBtn icon={<BkIcon d="M12 4l8 8-8 8-8-8z" size={17} />} label="判定" active={tool === 'flow-decision'} onClick={() => setTool('flow-decision')} dragTool="flow-decision" title="判定（菱形），可拖入画布" />
              <ToolBtn icon={<BkIcon d="M8 6h12l-4 12H4z" size={17} />} label="输入/出" active={tool === 'flow-io'} onClick={() => setTool('flow-io')} dragTool="flow-io" title="输入/输出，可拖入画布" />
              <ToolBtn icon={<BkIcon d="M4 5h16v14H4zm3 3h10v8H7z" size={17} />} label="子流程" active={tool === 'flow-subprocess'} onClick={() => setTool('flow-subprocess')} dragTool="flow-subprocess" title="子流程：可展开为完整小流程图，可拖入画布" />
            </div>
            <div className="flex items-center gap-1.5 mt-2.5">
              <div className="seg flex-1">
                {(['LR', 'TB'] as const).map((d) => (
                  <button key={d} className={`seg-btn flex-1 ${page.flowDir === d ? 'on' : ''}`}
                    onClick={() => updatePage((p) => ({ ...p, flowDir: d }))}>
                    {d === 'LR' ? '横向' : '纵向'}
                  </button>
                ))}
              </div>
              <button className="btn !text-[11px] !px-2" onClick={tidy} title="按层级自动排布流程图">整理布局</button>
            </div>
            <p className="text-[10.5px] leading-4 mt-2" style={{ color: 'var(--muted)' }}>
              同层节点可自由连线 · 双击子流程节点展开/收纳
            </p>
          </Section>
        </>
      ) : (
        <>
          <Section title="白板">
            <label className="btn btn-accent justify-center w-full cursor-pointer">
              <BkIcon d={BI.image} size={15} /> 插入图片
              <input type="file" accept="image/*" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) insertImage(f); e.target.value = ''; }} />
            </label>
            <p className="text-[10.5px] leading-4 mt-2" style={{ color: 'var(--muted)' }}>图片作为底图，形状可叠加其上</p>
            <div className="grid grid-cols-3 gap-1.5 mt-2.5">
              <ToolBtn icon={<BkIcon d={BI.rect} size={17} />} label="矩形" active={tool === 'wb-rect'} onClick={() => setTool('wb-rect')} title="拖拽绘制" />
              <ToolBtn icon={<BkIcon d={BI.ellipse} size={17} />} label="椭圆" active={tool === 'wb-ellipse'} onClick={() => setTool('wb-ellipse')} title="拖拽绘制" />
              <ToolBtn icon={<BkIcon d={BI.arrow} size={17} />} label="箭头" active={tool === 'wb-arrow'} onClick={() => setTool('wb-arrow')} title="拖拽绘制" />
              <ToolBtn icon={<BkIcon d={BI.line} size={17} />} label="直线" active={tool === 'wb-line'} onClick={() => setTool('wb-line')} title="拖拽绘制" />
              <ToolBtn icon={<BkIcon d={BI.text} size={17} />} label="文字" active={tool === 'wb-text'} onClick={() => setTool('wb-text')} title="点击放置" />
            </div>
          </Section>
        </>
      )}

      <Section title="视图与外观">
        <ToggleRow label="网格背景" on={app.doc.settings.showGrid} onChange={(v) => app.set({ ...app.doc, settings: { ...app.doc.settings, showGrid: v } }, false)} />
        <ToggleRow label="小地图" on={app.doc.settings.showMiniMap} onChange={(v) => app.set({ ...app.doc, settings: { ...app.doc.settings, showMiniMap: v } }, false)} />
        <ToggleRow label="对齐网格" on={app.doc.settings.snapToGrid} onChange={(v) => app.set({ ...app.doc, settings: { ...app.doc.settings, snapToGrid: v } }, false)} />
        <ToggleRow label="状态动作文本" on={app.doc.settings.showActionText} onChange={(v) => app.set({ ...app.doc, settings: { ...app.doc.settings, showActionText: v } })} />
      </Section>
      <div className="mt-auto p-3.5 text-[10.5px] leading-4" style={{ color: 'var(--muted)' }}>
        工具 <kbd>V</kbd> 选择 · <kbd>F</kbd> 适应视图<br /><kbd>Delete</kbd> 删除选中
      </div>
    </div>
  );
}

function ToggleRow({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-[11.5px] font-medium" style={{ color: 'var(--text)' }}>{label}</span>
      <button className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)} aria-pressed={on} aria-label={label}>
        <span className="absolute top-[2px] rounded-full bg-white transition-all"
          style={{ width: 15, height: 15, left: on ? 17 : 2, boxShadow: '0 1px 2px rgba(0,0,0,.25)' }} />
      </button>
    </div>
  );
}

/* ================= 右侧属性面板 ================= */

export function Inspector() {
  const app = useStudio();
  const { sel, page, theme } = app;

  const body = useMemo(() => {
    if (sel.kind === 'state' && sel.id) {
      const s = page.states.find((x) => x.id === sel.id);
      return s ? <StateInspector id={s.id} /> : null;
    }
    if (sel.kind === 'transition' && sel.id) {
      const t = page.transitions.find((x) => x.id === sel.id);
      return t ? <TransitionInspector t={t} /> : null;
    }
    if (sel.kind === 'flow' && sel.id) {
      const n = findFlowNode(page.flowNodes, sel.id);
      return n ? <FlowInspector id={n.id} /> : null;
    }
    if (sel.kind === 'flowEdge' && sel.id) {
      const lookup = (ns: typeof page.flowNodes, es: typeof page.flowEdges): { label?: string } | null => {
        const e = es.find((x) => x.id === sel.id);
        if (e) return e;
        for (const n of ns) if (n.inner) { const r = lookup(n.inner.nodes, n.inner.edges); if (r) return r; }
        return null;
      };
      const e = lookup(page.flowNodes, page.flowEdges);
      return e ? <FlowEdgeInspector id={sel.id} /> : null;
    }
    if (sel.kind === 'wb' && sel.id) {
      const w = page.wbShapes.find((x) => x.id === sel.id);
      return w ? <WbInspector w={w} /> : null;
    }
    return <EmptyInspector />;
    // eslint-disable-next-line
  }, [sel, page, theme]);

  return (
    <div className="w-[236px] flex-none overflow-y-auto" style={{ background: 'var(--panel)', borderLeft: '1px solid var(--border)' }}>
      {body}
    </div>
  );
}

function Head({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="px-3.5 pt-3.5 pb-2" style={{ borderBottom: '1px solid var(--border)' }}>
      <div className="text-[12.5px] font-bold" style={{ color: 'var(--text)' }}>{title}</div>
      {sub && <div className="text-[10.5px] mt-0.5" style={{ color: 'var(--muted)' }}>{sub}</div>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="px-3.5 py-1.5">
      <div className="text-[10.5px] font-bold mb-1" style={{ color: 'var(--muted)' }}>{label}</div>
      {children}
    </div>
  );
}

function Swatches({ value, onPick }: { value: string; onPick: (c: PaletteColor) => void }) {
  const app = useStudio();
  return (
    <div className="flex flex-wrap gap-1.5">
      {COLOR_ORDER.map((c) => (
        <button key={c} title={COLOR_LABELS[c]} onClick={() => onPick(c)}
          className="w-[22px] h-[22px] rounded-full transition-transform hover:scale-110"
          style={{
            background: PALETTES[c][app.theme].accent,
            outline: value === c ? `2px solid ${PALETTES[c][app.theme].accent}` : 'none',
            outlineOffset: 2,
          }} />
      ))}
    </div>
  );
}

function DeleteBtn({ onClick }: { onClick: () => void }) {
  return (
    <div className="px-3.5 py-3">
      <button className="btn w-full justify-center !text-rose-500" onClick={onClick}>
        <BkIcon d={BI.trash} size={14} /> 删除
      </button>
    </div>
  );
}

/* ---------- 状态 ---------- */
function StateInspector({ id }: { id: string }) {
  const app = useStudio();
  const s = app.page.states.find((x) => x.id === id)!;
  const up = (patch: Partial<typeof s>) =>
    app.updatePage((p) => ({ ...p, states: p.states.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
  return (
    <>
      <Head title="状态" sub="状态机元素 · 连线即状态转移" />
      <Field label="名称">
        <input className="field-input w-full" value={s.name}
          onChange={(e) => up({ name: e.target.value })} />
      </Field>
      <Field label="类型">
        <select className="field-input w-full" value={s.kind}
          onChange={(e) => up({ kind: e.target.value as typeof s.kind })}>
          <option value="state">普通状态</option>
          <option value="terminal">终止状态（双线框）</option>
          <option value="junction">连接点</option>
          <option value="start">初始结点</option>
        </select>
      </Field>
      <Field label="配色"><Swatches value={s.color} onPick={(c) => up({ color: c })} /></Field>
      {(s.kind === 'state' || s.kind === 'terminal') && (
        <>
          <Field label="entry 动作"><input className="field-input w-full font-code !text-[11px]" value={s.entry ?? ''} placeholder="init();" onChange={(e) => up({ entry: e.target.value || undefined })} /></Field>
          <Field label="during 动作"><input className="field-input w-full font-code !text-[11px]" value={s.during ?? ''} placeholder="poll();" onChange={(e) => up({ during: e.target.value || undefined })} /></Field>
          <Field label="exit 动作"><input className="field-input w-full font-code !text-[11px]" value={s.exit ?? ''} placeholder="stop();" onChange={(e) => up({ exit: e.target.value || undefined })} /></Field>
        </>
      )}
      <DeleteBtn onClick={app.deleteSel} />
    </>
  );
}

/* ---------- 状态转移（四段标签编辑器） ---------- */
function TransitionInspector({ t }: { t: ProjectTransition }) {
  const app = useStudio();
  const up = (patch: Partial<ProjectTransition>) =>
    app.updatePage((p) => ({ ...p, transitions: p.transitions.map((x) => (x.id === t.id ? { ...x, ...patch } : x)) }));
  const seg = (label: string, key: 'event' | 'condition' | 'conditionAction' | 'transitionAction', ph: string, mono = true) => (
    <Field label={label}>
      <input className={`field-input w-full !text-[11.5px] ${mono ? 'font-code' : ''}`} value={t[key] ?? ''} placeholder={ph}
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
      <div className="px-3.5 py-1.5 flex items-center justify-between">
        <span className="text-[11.5px] font-medium" style={{ color: 'var(--text)' }}>显示该转移</span>
        <button className={`switch ${t.enabled ? 'on' : ''}`} onClick={() => up({ enabled: !t.enabled })} aria-label="显示该转移">
          <span className="absolute top-[2px] rounded-full bg-white transition-all"
            style={{ width: 15, height: 15, left: t.enabled ? 17 : 2, boxShadow: '0 1px 2px rgba(0,0,0,.25)' }} />
        </button>
      </div>
      <Field label="线颜色">
        <div className="flex flex-wrap gap-1.5">
          <button className="text-[10.5px] font-semibold px-2 py-1 rounded-md border"
            style={{ borderColor: !t.lineColor ? 'var(--accent)' : 'var(--border)', color: !t.lineColor ? 'var(--accent)' : 'var(--muted)' }}
            onClick={() => up({ lineColor: undefined })}>跟随主题</button>
          {COLOR_ORDER.map((c) => (
            <button key={c} title={COLOR_LABELS[c]} onClick={() => up({ lineColor: c })}
              className="w-[20px] h-[20px] rounded-full hover:scale-110 transition-transform"
              style={{ background: PALETTES[c][app.theme].accent, outline: t.lineColor === c ? `2px solid ${PALETTES[c][app.theme].accent}` : 'none', outlineOffset: 2 }} />
          ))}
        </div>
      </Field>
      <Field label="线宽">
        <div className="seg w-full">
          {[undefined, 1, 1.6, 2.2, 3].map((w) => (
            <button key={String(w)} className={`seg-btn flex-1 ${t.lineWidth === w ? 'on' : ''}`}
              onClick={() => up({ lineWidth: w })}>{w === undefined ? '全局' : w}</button>
          ))}
        </div>
      </Field>
      <div className="px-3.5 py-1.5 flex items-center justify-between">
        <span className="text-[11.5px] font-medium" style={{ color: 'var(--text)' }}>虚线</span>
        <button className={`switch ${t.dashed ? 'on' : ''}`} onClick={() => up({ dashed: !t.dashed })} aria-label="虚线">
          <span className="absolute top-[2px] rounded-full bg-white transition-all"
            style={{ width: 15, height: 15, left: t.dashed ? 17 : 2, boxShadow: '0 1px 2px rgba(0,0,0,.25)' }} />
        </button>
      </div>
      <DeleteBtn onClick={app.deleteSel} />
    </>
  );
}

/* ---------- 流程结点 ---------- */
function FlowInspector({ id }: { id: string }) {
  const app = useStudio();
  const n = findFlowNode(app.page.flowNodes, id)!;
  const up = (patch: Parameters<typeof updateFlowNode>[2]) =>
    app.updatePage((p) => ({ ...p, flowNodes: updateFlowNode(p.flowNodes, id, patch) }));
  const isSub = n.kind === 'subprocess';
  const KINDS: { v: FlowKind; t: string }[] = [
    { v: 'start', t: '开始/结束' }, { v: 'process', t: '流程' }, { v: 'decision', t: '判定' },
    { v: 'io', t: '输入/输出' }, { v: 'subprocess', t: '子流程' },
  ];
  return (
    <>
      <Head title={isSub ? '子流程' : '流程结点'} sub={isSub ? '可展开为完整小流程图' : '流程图元素 · 同层可自由连线'} />
      <Field label="文本">
        <input className="field-input w-full" value={n.text} onChange={(e) => up({ text: e.target.value })} />
      </Field>
      <Field label="类型">
        <select className="field-input w-full" value={n.kind}
          onChange={(e) => {
            const k = e.target.value as FlowKind;
            up(k === 'subprocess'
              ? { kind: k, inner: n.inner ?? { nodes: [], edges: [] }, expanded: false }
              : { kind: k });
          }}>
          {KINDS.map((k) => <option key={k.v} value={k.v}>{k.t}</option>)}
        </select>
      </Field>
      <Field label="填充">
        <div className="flex flex-wrap gap-1.5">
          {BOARD_COLORS.map((c) => (
            <button key={c.key} onClick={() => up({ fill: c.soft, stroke: c.fill })}
              className="w-[20px] h-[20px] rounded-full hover:scale-110 transition-transform"
              style={{ background: c.fill, outline: n.stroke === c.fill ? `2px solid ${c.fill}` : 'none', outlineOffset: 2 }} />
          ))}
        </div>
      </Field>
      <Field label="边线颜色">
        <div className="flex flex-wrap gap-1.5">
          {NEUTRAL_STROKES.map((c) => (
            <button key={c} onClick={() => up({ stroke: c })}
              className="w-[20px] h-[20px] rounded-md hover:scale-110 transition-transform"
              style={{ background: c, outline: n.stroke === c ? `2px solid var(--text)` : 'none', outlineOffset: 2 }} />
          ))}
        </div>
      </Field>
      <Field label="尺寸">
        <div className="flex gap-1.5 items-center">
          <input type="number" className="field-input flex-1" value={Math.round(n.w)} min={40}
            onChange={(e) => up({ w: Math.max(40, Number(e.target.value) || 40) })} />
          <span style={{ color: 'var(--muted)' }}>×</span>
          <input type="number" className="field-input flex-1" value={Math.round(n.h)} min={28}
            onChange={(e) => up({ h: Math.max(28, Number(e.target.value) || 28) })} />
        </div>
      </Field>
      {isSub && (
        <>
          <div className="px-3.5 py-1.5 flex items-center justify-between">
            <span className="text-[11.5px] font-medium" style={{ color: 'var(--text)' }}>
              展开（{n.inner?.nodes.length ?? 0} 个内部节点）
            </span>
            <button className={`switch ${n.expanded ? 'on' : ''}`}
              onClick={() => {
                const r = toggleSubInDoc(app.page.flowNodes, app.page.flowEdges, n.id, app.page.flowDir);
                app.updatePage((p) => ({ ...p, flowNodes: r.nodes, flowEdges: r.edges }));
              }} aria-label="展开子流程">
              <span className="absolute top-[2px] rounded-full bg-white transition-all"
                style={{ width: 15, height: 15, left: n.expanded ? 17 : 2, boxShadow: '0 1px 2px rgba(0,0,0,.25)' }} />
            </button>
          </div>
          <div className="px-3.5 pb-2 flex gap-1.5">
            <button className="btn flex-1 justify-center !text-[11px]" onClick={() => {
              const inner = n.inner ?? { nodes: [], edges: [] };
              const nn = makeFlowNode('process', 20 + inner.nodes.length * 30, 20);
              let fnodes = updateFlowNode(app.page.flowNodes, n.id, { inner: { ...inner, nodes: [...inner.nodes, nn] } });
              if (!n.expanded) {
                fnodes = toggleSubInDoc(fnodes, app.page.flowEdges, n.id, app.page.flowDir).nodes;
              } else {
                fnodes = updateFlowNode(fnodes, n.id, {
                  inner: { nodes: layoutFlowGraph([...inner.nodes, nn], inner.edges, app.page.flowDir), edges: inner.edges },
                });
              }
              app.updatePage((p) => ({ ...p, flowNodes: fnodes }));
              app.setSel({ kind: 'flow', id: nn.id });
            }}><BkIcon d={BI.plus} size={13} /> 内部节点</button>
            <button className="btn flex-1 justify-center !text-[11px]" onClick={() => {
              const inner = n.inner; if (!inner || !inner.nodes.length) return;
              up({ inner: { ...inner, nodes: layoutFlowGraph(inner.nodes, inner.edges, app.page.flowDir) } });
            }}><BkIcon d={BI.expand} size={13} /> 整理内部</button>
          </div>
          <p className="px-3.5 pb-2 text-[10.5px] leading-4" style={{ color: 'var(--muted)' }}>
            展开时在侧向弹出浮动面板（自动避让周围元素），虚线系绳连回结点。面板可整体拖动、内部结点可手动摆位，位置会被记住；收纳后再次展开仍回到原处。
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
  const setLabel = (label: string) => {
    type FN = typeof app.page.flowNodes;
    type FE = typeof app.page.flowEdges;
    const map = (ns: FN, es: FE): { nodes: FN; edges: FE } => ({
      nodes: ns.map((n) => (n.inner ? { ...n, inner: map(n.inner.nodes, n.inner.edges) } : n)) as FN,
      edges: es.map((e) => (e.id === id ? { ...e, label: label || undefined } : e)) as FE,
    });
    const r = map(app.page.flowNodes, app.page.flowEdges);
    app.updatePage((p) => ({ ...p, flowNodes: r.nodes, flowEdges: r.edges }));
  };
  return (
    <>
      <Head title="流程连线" sub="同层结点间的连接" />
      <Field label="标签">
        <input className="field-input w-full" placeholder="如：成功 / 是"
          defaultValue={lookupLabel(app.page.flowNodes, app.page.flowEdges, id) ?? ''}
          onBlur={(e) => setLabel(e.target.value.trim())}
          onKeyDown={(e) => { if (e.key === 'Enter') setLabel((e.target as HTMLInputElement).value.trim()); }} />
      </Field>
      <DeleteBtn onClick={app.deleteSel} />
    </>
  );
}

function lookupLabel(ns: ReturnType<typeof useStudio>['page']['flowNodes'], es: { id: string; label?: string }[], id: string): string | undefined {
  const e = es.find((x) => x.id === id);
  if (e) return e.label;
  for (const n of ns) if (n.inner) {
    const r = lookupLabel(n.inner.nodes, n.inner.edges, id);
    if (r !== undefined) return r;
  }
  return undefined;
}

/* ---------- 白板元素 ---------- */
function WbInspector({ w }: { w: WbShape }) {
  const app = useStudio();
  const up = (patch: Partial<WbShape>) =>
    app.updatePage((p) => ({ ...p, wbShapes: p.wbShapes.map((x) => (x.id === w.id ? { ...x, ...patch } : x)) }));
  const isLine = w.kind === 'arrow' || w.kind === 'line';
  const kindName = { image: '图片', rect: '矩形', ellipse: '椭圆', arrow: '箭头', line: '直线', text: '文字' }[w.kind];
  const moveLayer = (dir: 1 | -1) => {
    app.updatePage((p) => {
      const i = p.wbShapes.findIndex((x) => x.id === w.id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= p.wbShapes.length) return p;
      const arr = [...p.wbShapes];
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return { ...p, wbShapes: arr };
    });
  };
  return (
    <>
      <Head title={kindName} sub="白板元素 · 可叠加在图片上" />
      {w.kind !== 'image' && w.kind !== 'line' && w.kind !== 'arrow' && (
        <Field label="填充">
          <div className="flex flex-wrap gap-1.5">
            <button className="text-[10.5px] font-semibold px-2 py-1 rounded-md border"
              style={{ borderColor: w.fill === 'none' ? 'var(--accent)' : 'var(--border)', color: w.fill === 'none' ? 'var(--accent)' : 'var(--muted)' }}
              onClick={() => up({ fill: 'none' })}>无</button>
            {BOARD_COLORS.map((c) => (
              <button key={c.key} onClick={() => up({ fill: c.soft.replace(')', ',0.35)').replace('rgb', 'rgba').replace('#', ''), stroke: c.fill })}
                className="w-[20px] h-[20px] rounded-full hover:scale-110 transition-transform"
                style={{ background: c.fill, outline: w.stroke === c.fill ? `2px solid ${c.fill}` : 'none', outlineOffset: 2 }} />
            ))}
          </div>
        </Field>
      )}
      <Field label="边线颜色">
        <div className="flex flex-wrap gap-1.5">
          {NEUTRAL_STROKES.map((c) => (
            <button key={c} onClick={() => up({ stroke: c })}
              className="w-[20px] h-[20px] rounded-md hover:scale-110 transition-transform"
              style={{ background: c, outline: w.stroke === c ? '2px solid var(--text)' : 'none', outlineOffset: 2 }} />
          ))}
        </div>
      </Field>
      {!isLine && w.kind !== 'image' && (
        <Field label="边线宽度">
          <input type="range" min={1} max={8} step={0.5} value={w.strokeWidth} className="w-full"
            onChange={(e) => up({ strokeWidth: Number(e.target.value) })} />
        </Field>
      )}
      {(w.kind === 'rect' || w.kind === 'text') && (
        <Field label="文字">
          <textarea className="field-input w-full" rows={2} value={w.text ?? ''}
            onChange={(e) => up({ text: e.target.value })} />
        </Field>
      )}
      <Field label="尺寸">
        <div className="flex gap-1.5 items-center">
          <input type="number" className="field-input flex-1" value={Math.round(w.w)}
            onChange={(e) => up({ w: Number(e.target.value) || 1 })} />
          <span style={{ color: 'var(--muted)' }}>×</span>
          <input type="number" className="field-input flex-1" value={Math.round(w.h)}
            onChange={(e) => up({ h: Number(e.target.value) || 1 })} />
        </div>
      </Field>
      <Field label="图层">
        <div className="flex gap-1.5">
          <button className="btn flex-1 justify-center !text-[11px]" onClick={() => moveLayer(1)} title="上移一层">
            <BkIcon d={BI.front} size={13} /> 上移
          </button>
          <button className="btn flex-1 justify-center !text-[11px]" onClick={() => moveLayer(-1)} title="下移一层">
            <BkIcon d={BI.back} size={13} /> 下移
          </button>
        </div>
      </Field>
      <DeleteBtn onClick={app.deleteSel} />
    </>
  );
}

/* ---------- 空选择 ---------- */
function EmptyInspector() {
  const app = useStudio();
  const { page } = app;
  return (
    <>
      <Head title="属性" sub="未选中任何元素" />
      <div className="px-3.5 py-3 text-[11.5px] leading-5" style={{ color: 'var(--muted)' }}>
        {page.type === 'canvas' ? (
          <>
            · 点击选中状态 / 流程结点 / 连线<br />
            · 悬停元素拖出圆点创建连线<br />
            · 状态之间的连线即<b style={{ color: 'var(--text)' }}>状态转移</b>，选中后可编辑 event / 条件 / 动作<br />
            · 选中子流程结点可展开内部管理
          </>
        ) : (
          <>
            · 先插入图片作为底图<br />
            · 用形状工具拖拽绘制标注<br />
            · 选中后可编辑填充 / 边线 / 尺寸 / 图层
          </>
        )}
      </div>
    </>
  );
}
