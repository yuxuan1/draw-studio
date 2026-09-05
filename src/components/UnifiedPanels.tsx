/* ============================================================
 * 左侧插入/设置面板 + 右侧属性检查器（随选择变化）
 * ============================================================ */
import { useRef } from 'react';
import type { ReactNode } from 'react';
import { useStudio } from '../studioStore';
import type { Tool } from '../studioStore';
import { Seg, BkIcon, BI, BOARD_COLORS, NEUTRAL_STROKES } from '../lib/boardkit';
import { COLOR_ORDER, COLOR_LABELS, PALETTES, formatLabel, parseLabel } from '../lib/core';
import type { NodeKind, PaletteColor } from '../lib/core';
import { tidyFlow, makeFlowNode, nid } from '../lib/studio';
import type { FlowShape } from '../lib/studio';

/* 额外形状图标 */
const XI = {
  diamond: 'M12 3l9 9-9 9-9-9 9-9Z',
  stadium: 'M8 6h8a6 6 0 0 1 0 12H8a6 6 0 0 1 0-12Z',
  para: 'M8 5h12l-4 14H4L8 5Z',
  terminal: 'M4 6h16v12H4zM7 9h10v6H7z',
  junction: 'M12 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12Z',
};

const toolBtn = (active: boolean) =>
  `flex flex-col items-center justify-center gap-1 rounded-lg py-2 px-1 text-[10px] font-semibold transition-all border ${
    active
      ? 'text-[var(--accent)] border-[var(--accent)] bg-[var(--accent-soft)]'
      : 'text-[var(--muted)] border-transparent hover:text-[var(--text)] hover:bg-[var(--panel)]'}`;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="px-3 pt-3">
      <div className="text-[10.5px] font-bold tracking-wide mb-1.5" style={{ color: 'var(--muted)' }}>{title}</div>
      {children}
    </div>
  );
}

export function LeftPanel() {
  const app = useStudio();
  const { doc, set, tool, setTool, theme, toast } = app;
  const fileRef = useRef<HTMLInputElement>(null);

  const T = (t: Tool, icon: string, label: string) => (
    <button className={toolBtn(tool === t)} onClick={() => setTool(tool === t ? 'select' : t)}
      title={label} aria-label={label} aria-pressed={tool === t}>
      <BkIcon d={icon} size={17} />
      <span>{label}</span>
    </button>
  );

  const insertImage = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const ratio = img.height / Math.max(1, img.width);
        const w = Math.min(420, img.width);
        const shape = {
          id: nid('w'), kind: 'image' as const, x: 80, y: 80, w, h: w * ratio,
          fill: 'none', stroke: '#94a3b8', strokeWidth: 1.2, src: String(reader.result),
        };
        set({ ...doc, wbShapes: [...doc.wbShapes, shape] });
        app.setSel({ kind: 'wb', id: shape.id });
        toast('已插入图片');
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const st = doc.settings;
  return (
    <aside className="w-[228px] flex-none flex flex-col min-h-0" style={{ background: 'var(--panel)', borderRight: '1px solid var(--border)' }}>
      <div className="flex-1 overflow-y-auto pb-4 min-h-0">
        <Section title="状态机">
          <div className="grid grid-cols-3 gap-1">
            {T('sm-state', BI.rect, '状态')}
            {T('sm-terminal', XI.terminal, '终止态')}
            {T('sm-junction', XI.junction, '连接点')}
          </div>
        </Section>

        <Section title="流程图">
          <div className="grid grid-cols-4 gap-1">
            {T('flow-rect', BI.rect, '流程')}
            {T('flow-diamond', XI.diamond, '判定')}
            {T('flow-stadium', XI.stadium, '起止')}
            {T('flow-io', XI.para, '输入输出')}
          </div>
          <div className="flex items-center gap-1.5 mt-2">
            <div className="flex-1"><Seg value={doc.flowDirection} onChange={(k) => {
              set({ ...doc, flowDirection: k as 'LR' | 'TB', flowNodes: tidyFlow(doc.flowNodes, k as 'LR' | 'TB') });
            }} options={[{ key: 'LR', label: '横向' }, { key: 'TB', label: '纵向' }]} /></div>
            <button className="btn !h-[26px] !px-2 !text-[11px]" onClick={() => {
              set({ ...doc, flowNodes: tidyFlow(doc.flowNodes, doc.flowDirection) });
              toast('流程图已整理');
            }}>整理</button>
          </div>
        </Section>

        <Section title="白板">
          <div className="grid grid-cols-4 gap-1">
            {T('wb-rect', BI.rect, '矩形')}
            {T('wb-ellipse', BI.ellipse, '椭圆')}
            {T('wb-arrow', BI.arrow, '箭头')}
            {T('wb-line', BI.line, '直线')}
            {T('wb-text', BI.text, '文本')}
            <button className={toolBtn(false)} onClick={() => fileRef.current?.click()} title="插入图片" aria-label="插入图片">
              <BkIcon d={BI.image} size={17} /><span>图片</span>
            </button>
          </div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) insertImage(f); e.target.value = ''; }} />
        </Section>

        <Section title="状态机连线">
          <div className="flex flex-col gap-1.5">
            <Seg value={st.edgeStyle} onChange={(k) => set({ ...doc, settings: { ...st, edgeStyle: k as typeof st.edgeStyle } })}
              options={[{ key: 'smoothstep', label: '折线' }, { key: 'bezier', label: '曲线' }, { key: 'orthogonal', label: '直角' }, { key: 'straight', label: '直线' }]} />
            <div className="flex gap-1.5">
              <div className="flex-1"><Seg value={String(st.edgeWidth)} onChange={(k) => set({ ...doc, settings: { ...st, edgeWidth: Number(k) } })}
                options={[{ key: '1', label: '细' }, { key: '1.6', label: '标准' }, { key: '2.2', label: '中' }, { key: '3', label: '粗' }]} /></div>
            </div>
            <Seg value={String(st.arrowSize)} onChange={(k) => set({ ...doc, settings: { ...st, arrowSize: Number(k) } })}
              options={[{ key: '12', label: '小箭头' }, { key: '16', label: '中箭头' }, { key: '22', label: '大箭头' }]} />
          </div>
        </Section>

        <Section title="视图">
          <div className="flex flex-col gap-1.5">
            <Toggle label="网格背景" on={st.showGrid} onChange={(v) => set({ ...doc, settings: { ...st, showGrid: v } })} />
            <Toggle label="小地图" on={st.showMiniMap} onChange={(v) => set({ ...doc, settings: { ...st, showMiniMap: v } })} />
            <Toggle label="吸附网格" on={st.snapToGrid} onChange={(v) => set({ ...doc, settings: { ...st, snapToGrid: v } })} />
            <Toggle label="显示状态动作" on={st.showActionText} onChange={(v) => set({ ...doc, settings: { ...st, showActionText: v } })} />
          </div>
        </Section>

        <Section title={`元素（${doc.states.length} 状态 · ${doc.flowNodes.length} 流程 · ${doc.wbShapes.length} 白板）`}>
          <div className="flex flex-col gap-0.5">
            {doc.states.filter((s) => s.kind !== 'start').map((s) => (
              <ListRow key={s.id} active={app.sel.kind === 'state' && app.sel.id === s.id}
                dot={PALETTES[s.color][theme].accent} label={s.name || '(未命名)'}
                onClick={() => app.setSel({ kind: 'state', id: s.id })} />
            ))}
            {doc.flowNodes.map((n) => (
              <ListRow key={n.id} active={app.sel.kind === 'flow' && app.sel.id === n.id}
                dot={n.stroke} label={`${n.parentId ? '└ ' : ''}${n.text || '(未命名)'}`}
                onClick={() => app.setSel({ kind: 'flow', id: n.id })} />
            ))}
            {doc.wbShapes.map((w) => (
              <ListRow key={w.id} active={app.sel.kind === 'wb' && app.sel.id === w.id}
                dot={w.kind === 'image' ? '#94a3b8' : w.stroke}
                label={w.kind === 'image' ? '图片' : w.text || { rect: '矩形', ellipse: '椭圆', arrow: '箭头', line: '直线', text: '文本' }[w.kind]}
                onClick={() => app.setSel({ kind: 'wb', id: w.id })} />
            ))}
            {!doc.states.length && !doc.flowNodes.length && !doc.wbShapes.length && (
              <div className="text-[11px] py-2" style={{ color: 'var(--muted)' }}>暂无元素，从上方选择工具开始</div>
            )}
          </div>
        </Section>
      </div>
    </aside>
  );
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button className="flex items-center justify-between py-0.5 group" onClick={() => onChange(!on)} aria-pressed={on}>
      <span className="text-[12px] font-medium group-hover:text-[var(--text)]" style={{ color: on ? 'var(--text)' : 'var(--muted)' }}>{label}</span>
      <span className={`switch ${on ? 'on' : ''}`}><span className="knob" style={{ position: 'absolute', top: 2, left: on ? 17 : 2, width: 15, height: 15, borderRadius: 999, background: '#fff', transition: 'left 0.18s' }} /></span>
    </button>
  );
}

function ListRow({ active, dot, label, onClick }: { active: boolean; dot: string; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-2 px-2 py-[5px] rounded-md text-[12px] text-left transition-colors ${active ? 'bg-[var(--accent-soft)] text-[var(--accent)] font-semibold' : 'hover:bg-[var(--panel-2)]'}`}
      style={{ color: active ? undefined : 'var(--text)' }}>
      <span className="w-2.5 h-2.5 rounded-full flex-none" style={{ background: dot }} />
      <span className="truncate">{label}</span>
    </button>
  );
}

/* ============================================================
 * 右侧属性检查器
 * ============================================================ */

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10.5px] font-bold" style={{ color: 'var(--muted)' }}>{label}</span>
      {children}
    </div>
  );
}

function StrokeSwatches({ value, onPick }: { value: string; onPick: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {NEUTRAL_STROKES.map((c) => (
        <button key={c} onClick={() => onPick(c)} aria-label={`颜色 ${c}`}
          className="w-6 h-6 rounded-full transition-transform hover:scale-110"
          style={{ background: c, boxShadow: value === c ? '0 0 0 2px var(--panel), 0 0 0 4px var(--accent)' : 'none' }} />
      ))}
    </div>
  );
}

export function Inspector() {
  const app = useStudio();
  const { doc, set, sel, setSel, theme } = app;
  const st = doc.settings;

  let body: ReactNode;
  if (sel.kind === 'state' && sel.id) {
    const s = doc.states.find((x) => x.id === sel.id);
    body = s ? <StateInspector key={s.id} id={s.id} /> : null;
  } else if (sel.kind === 'transition' && sel.id) {
    const t = doc.transitions.find((x) => x.id === sel.id);
    body = t ? <TransitionInspector key={t.id} id={t.id} /> : null;
  } else if (sel.kind === 'flow' && sel.id) {
    const n = doc.flowNodes.find((x) => x.id === sel.id);
    body = n ? <FlowInspector key={n.id} id={n.id} /> : null;
  } else if (sel.kind === 'wb' && sel.id) {
    const w = doc.wbShapes.find((x) => x.id === sel.id);
    body = w ? <WbInspector key={w.id} id={w.id} /> : null;
  } else {
    body = (
      <div className="flex flex-col gap-3">
        <div className="text-[12px] leading-relaxed" style={{ color: 'var(--muted)' }}>
          选中画布中的元素以编辑其属性。<br /><br />
          · <b>状态机</b>：悬停状态右侧圆点可拖出转移连线<br />
          · <b>流程图</b>：子级自动展开在父级旁边，点 ± 收纳<br />
          · <b>白板</b>：插入图片后可在其上叠加形状
        </div>
        <Field label="全局线宽 / 箭头">
          <Seg value={String(st.edgeWidth)} onChange={(k) => set({ ...doc, settings: { ...st, edgeWidth: Number(k) } })}
            options={[{ key: '1', label: '细' }, { key: '1.6', label: '标准' }, { key: '2.2', label: '中' }, { key: '3', label: '粗' }]} />
        </Field>
      </div>
    );
  }

  return (
    <aside className="w-[248px] flex-none flex flex-col min-h-0" style={{ background: 'var(--panel)', borderLeft: '1px solid var(--border)' }}>
      <div className="px-3.5 py-2.5 text-[11px] font-bold tracking-wide" style={{ borderBottom: '1px solid var(--border)', color: 'var(--muted)' }}>
        属性检查器
      </div>
      <div className="flex-1 overflow-y-auto p-3.5 flex flex-col gap-3 min-h-0">{body}</div>
    </aside>
  );
}

function DelBtn({ onClick }: { onClick: () => void }) {
  return (
    <button className="btn justify-center !text-[12px]" style={{ color: '#e11d48' }} onClick={onClick}>
      <BkIcon d={BI.trash} size={14} /> 删除
    </button>
  );
}

function StateInspector({ id }: { id: string }) {
  const app = useStudio();
  const { doc, set, theme } = app;
  const s = doc.states.find((x) => x.id === id)!;
  const upd = (patch: Partial<typeof s>) => set({ ...doc, states: doc.states.map((x) => x.id === id ? { ...x, ...patch } : x) });
  return (
    <>
      <Field label="名称">
        <input className="field-input" value={s.name} onChange={(e) => upd({ name: e.target.value })} />
      </Field>
      <Field label="类型">
        <Seg value={s.kind} onChange={(k) => upd({ kind: k as NodeKind })}
          options={[{ key: 'state', label: '普通' }, { key: 'terminal', label: '终止' }, { key: 'junction', label: '连接点' }]} />
      </Field>
      <Field label="配色">
        <div className="flex flex-wrap gap-1.5">
          {COLOR_ORDER.map((c) => (
            <button key={c} title={COLOR_LABELS[c]} onClick={() => upd({ color: c as PaletteColor })}
              className="w-6 h-6 rounded-full transition-transform hover:scale-110"
              style={{ background: PALETTES[c as PaletteColor][theme].accent, boxShadow: s.color === c ? '0 0 0 2px var(--panel), 0 0 0 4px var(--accent)' : 'none' }} />
          ))}
        </div>
      </Field>
      {s.kind !== 'junction' && (
        <>
          <Field label="entry 动作"><textarea className="field-input" rows={2} value={s.entry ?? ''} onChange={(e) => upd({ entry: e.target.value || undefined })} /></Field>
          <Field label="during 动作"><textarea className="field-input" rows={2} value={s.during ?? ''} onChange={(e) => upd({ during: e.target.value || undefined })} /></Field>
          <Field label="exit 动作"><textarea className="field-input" rows={2} value={s.exit ?? ''} onChange={(e) => upd({ exit: e.target.value || undefined })} /></Field>
        </>
      )}
      <DelBtn onClick={() => {
        set({
          ...doc,
          states: doc.states.filter((x) => x.id !== id),
          transitions: doc.transitions.filter((t) => t.source !== id && t.target !== id),
        });
        app.setSel({ kind: null, id: null });
      }} />
    </>
  );
}

function TransitionInspector({ id }: { id: string }) {
  const app = useStudio();
  const { doc, set } = app;
  const t = doc.transitions.find((x) => x.id === id)!;
  const upd = (patch: Partial<typeof t>) => set({ ...doc, transitions: doc.transitions.map((x) => x.id === id ? { ...x, ...patch } : x) });
  const parts = { event: t.event, condition: t.condition, conditionAction: t.conditionAction, transitionAction: t.transitionAction };
  return (
    <>
      <Field label="标签（Stateflow 语法）">
        <input className="field-input font-code !text-[11.5px]" value={formatLabel(parts)}
          placeholder="event[cond]{act}/action"
          onChange={(e) => upd(parseLabel(e.target.value))} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="事件 event"><input className="field-input" value={t.event ?? ''} onChange={(e) => upd({ event: e.target.value || undefined })} /></Field>
        <Field label="条件 [cond]"><input className="field-input" value={t.condition ?? ''} onChange={(e) => upd({ condition: e.target.value || undefined })} /></Field>
        <Field label="条件动作 {act}"><input className="field-input" value={t.conditionAction ?? ''} onChange={(e) => upd({ conditionAction: e.target.value || undefined })} /></Field>
        <Field label="转移动作 /act"><input className="field-input" value={t.transitionAction ?? ''} onChange={(e) => upd({ transitionAction: e.target.value || undefined })} /></Field>
      </div>
      <Field label="显示">
        <Seg value={t.enabled ? '1' : '0'} onChange={(k) => upd({ enabled: k === '1' })}
          options={[{ key: '1', label: '显示' }, { key: '0', label: '隐藏' }]} />
      </Field>
      <Field label="线宽覆盖">
        <Seg value={t.lineWidth ? String(t.lineWidth) : 'auto'} onChange={(k) => upd({ lineWidth: k === 'auto' ? undefined : Number(k) })}
          options={[{ key: 'auto', label: '全局' }, { key: '1', label: '细' }, { key: '1.6', label: '标准' }, { key: '2.2', label: '中' }, { key: '3', label: '粗' }]} />
      </Field>
      <Field label="虚线">
        <Seg value={t.dashed ? '1' : '0'} onChange={(k) => upd({ dashed: k === '1' ? true : undefined })}
          options={[{ key: '0', label: '实线' }, { key: '1', label: '虚线' }]} />
      </Field>
      <Field label="连线颜色">
        <div className="flex flex-wrap gap-1.5">
          <button onClick={() => upd({ lineColor: undefined })} title="跟随全局"
            className="w-6 h-6 rounded-full text-[9px] font-bold flex items-center justify-center"
            style={{ background: 'var(--panel-2)', border: `1.5px ${t.lineColor ? 'solid var(--border)' : 'solid var(--accent)'}`, color: 'var(--muted)' }}>自</button>
          {COLOR_ORDER.map((c) => (
            <button key={c} title={COLOR_LABELS[c]} onClick={() => upd({ lineColor: c as PaletteColor })}
              className="w-6 h-6 rounded-full transition-transform hover:scale-110"
              style={{ background: PALETTES[c as PaletteColor][app.theme].accent, boxShadow: t.lineColor === c ? '0 0 0 2px var(--panel), 0 0 0 4px var(--accent)' : 'none' }} />
          ))}
        </div>
      </Field>
      <DelBtn onClick={() => set({ ...doc, transitions: doc.transitions.filter((x) => x.id !== id) })} />
    </>
  );
}

function FlowInspector({ id }: { id: string }) {
  const app = useStudio();
  const { doc, set, toast } = app;
  const n = doc.flowNodes.find((x) => x.id === id)!;
  const upd = (patch: Partial<typeof n>, tidy = false) => {
    const nodes = doc.flowNodes.map((x) => x.id === id ? { ...x, ...patch } : x);
    set({ ...doc, flowNodes: tidy ? tidyFlow(nodes, doc.flowDirection) : nodes });
  };
  const addChild = (shape: FlowShape) => {
    const c = makeFlowNode(shape, 0, 0, id);
    const nodes = tidyFlow([...doc.flowNodes.map((x) => x.id === id ? { ...x, collapsed: false } : x), c], doc.flowDirection);
    set({ ...doc, flowNodes: nodes });
    app.setSel({ kind: 'flow', id: c.id });
  };
  return (
    <>
      <Field label="文本">
        <input className="field-input" value={n.text} onChange={(e) => upd({ text: e.target.value })} />
      </Field>
      <Field label="形状">
        <Seg value={n.shape} onChange={(k) => upd({ shape: k as FlowShape })}
          options={[{ key: 'rect', label: '流程' }, { key: 'diamond', label: '判定' }, { key: 'stadium', label: '起止' }, { key: 'parallelogram', label: '输入' }]} />
      </Field>
      <Field label="填充色">
        <div className="flex flex-wrap gap-1.5">
          {BOARD_COLORS.map((c) => (
            <button key={c.key} onClick={() => upd({ fill: c.soft, stroke: c.fill })} title={c.key}
              className="w-6 h-6 rounded-full transition-transform hover:scale-110"
              style={{ background: c.fill, boxShadow: n.stroke === c.fill ? '0 0 0 2px var(--panel), 0 0 0 4px var(--accent)' : 'none' }} />
          ))}
        </div>
      </Field>
      <Field label="尺寸">
        <div className="flex gap-1.5 items-center">
          <input type="number" className="field-input" value={Math.round(n.w)}
            onChange={(e) => upd({ w: Math.max(40, Number(e.target.value) || 40) })} aria-label="宽" />
          <span style={{ color: 'var(--muted)' }}>×</span>
          <input type="number" className="field-input" value={Math.round(n.h)}
            onChange={(e) => upd({ h: Math.max(30, Number(e.target.value) || 30) })} aria-label="高" />
        </div>
      </Field>
      <Field label="添加子节点（展开在旁边）">
        <div className="grid grid-cols-4 gap-1">
          {(['rect', 'diamond', 'stadium', 'parallelogram'] as FlowShape[]).map((sh) => (
            <button key={sh} className="btn !h-[26px] !px-1 !text-[10px]" onClick={() => addChild(sh)}
              title={`添加${sh === 'rect' ? '流程' : sh === 'diamond' ? '判定' : sh === 'stadium' ? '起止' : '输入'}子节点`}>
              <BkIcon d={sh === 'rect' ? BI.rect : sh === 'diamond' ? XI.diamond : sh === 'stadium' ? XI.stadium : XI.para} size={13} />
            </button>
          ))}
        </div>
      </Field>
      <Field label="收纳 / 展开">
        <Seg value={n.collapsed ? '1' : '0'} onChange={(k) => upd({ collapsed: k === '1' }, true)}
          options={[{ key: '0', label: '展开' }, { key: '1', label: '收纳' }]} />
      </Field>
      <DelBtn onClick={() => {
        const doomed = new Set<string>([id]);
        let grew = true;
        while (grew) { grew = false; for (const x of doc.flowNodes) if (x.parentId && doomed.has(x.parentId) && !doomed.has(x.id)) { doomed.add(x.id); grew = true; } }
        set({ ...doc, flowNodes: doc.flowNodes.filter((x) => !doomed.has(x.id)) });
        app.setSel({ kind: null, id: null });
        toast('已删除节点及其子树');
      }} />
    </>
  );
}

function WbInspector({ id }: { id: string }) {
  const app = useStudio();
  const { doc, set } = app;
  const w = doc.wbShapes.find((x) => x.id === id)!;
  const upd = (patch: Partial<typeof w>) => set({ ...doc, wbShapes: doc.wbShapes.map((x) => x.id === id ? { ...x, ...patch } : x) });
  const kindName = { image: '图片', rect: '矩形', ellipse: '椭圆', arrow: '箭头', line: '直线', text: '文本' }[w.kind];
  const move = (dirn: 1 | -1) => {
    const i = doc.wbShapes.findIndex((x) => x.id === id);
    const arr = [...doc.wbShapes];
    const j = i + dirn;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    set({ ...doc, wbShapes: arr });
  };
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <div className="text-[12px] font-bold" style={{ color: 'var(--text)' }}>{kindName}</div>
      {(w.kind === 'rect' || w.kind === 'text') && (
        <Field label="文本">
          <textarea className="field-input" rows={2} value={w.text ?? ''} onChange={(e) => upd({ text: e.target.value })} />
        </Field>
      )}
      {w.kind !== 'image' && w.kind !== 'line' && w.kind !== 'arrow' && (
        <Field label="填充">
          <div className="flex flex-wrap gap-1.5">
            <button onClick={() => upd({ fill: 'none' })} className="w-6 h-6 rounded-full text-[9px] font-bold flex items-center justify-center"
              style={{ background: 'var(--panel-2)', border: '1.5px solid var(--border)', color: 'var(--muted)' }}>无</button>
            {BOARD_COLORS.map((c) => (
              <button key={c.key} onClick={() => upd({ fill: c.soft })} title={c.key}
                className="w-6 h-6 rounded-full transition-transform hover:scale-110" style={{ background: c.soft, border: '1.5px solid ' + c.fill }} />
            ))}
          </div>
        </Field>
      )}
      <Field label="边线颜色">
        <StrokeSwatches value={w.stroke} onPick={(c) => upd({ stroke: c })} />
      </Field>
      {(w.kind !== 'image' && w.kind !== 'text') && (
        <Field label={`边线宽度 ${w.strokeWidth}px`}>
          <input type="range" min={1} max={8} step={0.5} value={w.strokeWidth} className="w-full"
            onChange={(e) => upd({ strokeWidth: Number(e.target.value) })} aria-label="边线宽度" />
        </Field>
      )}
      <Field label="尺寸">
        <div className="flex gap-1.5 items-center">
          <input type="number" className="field-input" value={Math.round(w.w)} onChange={(e) => upd({ w: Math.max(10, Number(e.target.value) || 10) })} aria-label="宽" />
          <span style={{ color: 'var(--muted)' }}>×</span>
          <input type="number" className="field-input" value={Math.round(w.h)} onChange={(e) => upd({ h: Math.max(w.kind === 'line' || w.kind === 'arrow' ? -9999 : 10, Number(e.target.value) || 0) })} aria-label="高" />
        </div>
      </Field>
      {w.kind === 'image' && (
        <Field label="图片">
          <button className="btn justify-center !text-[12px]" onClick={() => fileRef.current?.click()}>
            <BkIcon d={BI.image} size={14} /> 替换图片
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => {
            const f = e.target.files?.[0]; if (!f) return;
            const r = new FileReader();
            r.onload = () => upd({ src: String(r.result) });
            r.readAsDataURL(f);
            e.target.value = '';
          }} />
        </Field>
      )}
      <Field label="图层">
        <div className="flex gap-1.5">
          <button className="btn flex-1 justify-center !text-[11px]" onClick={() => move(1)} title="上移一层"><BkIcon d={BI.front} size={13} /> 上移</button>
          <button className="btn flex-1 justify-center !text-[11px]" onClick={() => move(-1)} title="下移一层"><BkIcon d={BI.back} size={13} /> 下移</button>
        </div>
      </Field>
      <DelBtn onClick={() => set({ ...doc, wbShapes: doc.wbShapes.filter((x) => x.id !== id) })} />
    </>
  );
}
