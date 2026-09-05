/* ============================================================
 * 左侧栏（状态 / 转移表 / 外观）+ 右侧属性面板（Inspector 五态）
 * ============================================================ */

import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useApp } from '../store';
import type { ProjectState, ProjectTransition, PaletteColor, NodeKind } from '../lib/core';
import {
  COLOR_ORDER, COLOR_LABELS, PALETTES, START_ID, formatLabel,
} from '../lib/core';

/* ---------------- 小图标 ---------------- */

const ic = (d: string, size = 14) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);
const I = {
  plus: (s?: number) => ic('M12 5v14M5 12h14', s),
  trash: (s?: number) => ic('M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6', s),
  eye: (s?: number) => ic('M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z', s),
  eyeOff: (s?: number) => ic('M3 3l18 18M10.6 5.1A10.9 10.9 0 0 1 12 5c6.5 0 10 7 10 7a17.5 17.5 0 0 1-3 3.9M6.6 6.6A16.7 16.7 0 0 0 2 12s3.5 7 10 7a10.6 10.6 0 0 0 5.4-1.4', s),
  locate: (s?: number) => ic('M12 2v3M12 19v3M2 12h3M19 12h3M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z', s),
  lock: (s?: number) => ic('M6 11V8a6 6 0 1 1 12 0v3M5 11h14v10H5V11Z', s),
  chevron: (s?: number) => ic('M6 9l6 6 6-6', s),
  box: (s?: number) => ic('M4 4h16v16H4zM4 9h16', s),
  loop: (s?: number) => ic('M17 2l4 4-4 4M21 6H8a5 5 0 0 0-5 5v1M7 22l-4-4 4-4M3 18h13a5 5 0 0 0 5-5v-1', s),
};

function AlignIcon({ kind }: { kind: string }) {
  const bar = (x: number, y: number, w: number, h: number) =>
    <rect x={x} y={y} width={w} height={h} rx="1" fill="currentColor" stroke="none" />;
  let body: ReactNode = null;
  if (kind === 'left') body = <>{ic2('M2.5 2v12')}{bar(4.5, 3.5, 8.5, 3)}{bar(4.5, 9.5, 5.5, 3)}</>;
  if (kind === 'hcenter') body = <>{ic2('M8 1.5v13')}{bar(3, 3.5, 10, 3)}{bar(5, 9.5, 6, 3)}</>;
  if (kind === 'right') body = <>{ic2('M13.5 2v12')}{bar(3, 3.5, 8.5, 3)}{bar(6, 9.5, 5.5, 3)}</>;
  if (kind === 'top') body = <>{ic2('M2 2.5h12')}{bar(3.5, 4.5, 3, 8.5)}{bar(9.5, 4.5, 3, 5.5)}</>;
  if (kind === 'vcenter') body = <>{ic2('M1.5 8h13')}{bar(3.5, 3, 3, 10)}{bar(9.5, 5, 3, 6)}</>;
  if (kind === 'bottom') body = <>{ic2('M2 13.5h12')}{bar(3.5, 3, 3, 8.5)}{bar(9.5, 6, 3, 5.5)}</>;
  if (kind === 'dh') body = <>{bar(2, 4, 2.6, 8)}{bar(6.7, 4, 2.6, 8)}{bar(11.4, 4, 2.6, 8)}</>;
  if (kind === 'dv') body = <>{bar(4, 2, 8, 2.6)}{bar(4, 6.7, 8, 2.6)}{bar(4, 11.4, 8, 2.6)}</>;
  return <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>{body}</svg>;
}
function ic2(d: string) {
  return <path d={d} stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none" />;
}

/* ---------------- 通用小组件 ---------------- */

function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="px-3.5 pt-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] font-bold tracking-wide" style={{ color: 'var(--faint)' }}>{title}</div>
        {right}
      </div>
      {children}
    </div>
  );
}

function ToggleRow({ label, hint, on, onChange }: { label: string; hint?: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between py-[7px]">
      <div>
        <div className="text-[12.5px] font-medium">{label}</div>
        {hint && <div className="text-[11px]" style={{ color: 'var(--faint)' }}>{hint}</div>}
      </div>
      <button className={`switch ${on ? 'on' : ''}`} role="switch" aria-checked={on}
        aria-label={label} onClick={() => onChange(!on)} />
    </div>
  );
}

function Swatches({ value, onPick, allowFollow, follow }: {
  value: PaletteColor | 'follow' | null;
  onPick: (c: PaletteColor | 'follow') => void;
  allowFollow?: boolean;
  follow?: boolean;
}) {
  const theme = useAppTheme();
  return (
    <div className="flex items-center gap-[7px] flex-wrap">
      {allowFollow && (
        <button
          title="跟随全局" aria-label="跟随全局"
          onClick={() => onPick('follow')}
          className="w-[22px] h-[22px] rounded-full grid place-items-center transition-transform hover:scale-110"
          style={{
            border: value === 'follow' || (follow && value === null)
              ? '2px solid var(--accent)' : '1.5px dashed var(--border-strong)',
            background: 'var(--panel-2)',
          }}
        >
          <span className="text-[10px]" style={{ color: 'var(--muted)' }}>全</span>
        </button>
      )}
      {COLOR_ORDER.map((c) => (
        <button key={c} title={COLOR_LABELS[c]} aria-label={COLOR_LABELS[c]}
          onClick={() => onPick(c)}
          className="w-[22px] h-[22px] rounded-full transition-transform hover:scale-110"
          style={{
            background: PALETTES[c][theme].accent,
            border: value === c
              ? '2.5px solid var(--text)' : '2px solid transparent',
            boxShadow: value === c ? '0 0 0 2px var(--panel-2) inset' : undefined,
          }} />
      ))}
    </div>
  );
}
function useAppTheme() {
  return useApp().doc.settings.theme;
}

const KIND_LABEL: Record<NodeKind, string> = { state: '状态', terminal: '终止', junction: '连接点', start: '初始' };

/* ============================================================
 * 左侧栏
 * ============================================================ */

export function LeftPanel() {
  const [tab, setTab] = useState<'states' | 'edges' | 'style'>('states');
  return (
    <aside className="w-[288px] flex-none flex flex-col" style={{ background: 'var(--panel)', borderRight: '1px solid var(--border)' }}>
      <div className="flex gap-1 p-2 pb-0">
        {([['states', '状态'], ['edges', '转移表'], ['style', '外观']] as const).map(([k, label]) => (
          <button key={k} className={`panel-tab ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto pb-4 anim-fade" key={tab}>
        {tab === 'states' && <StatesTab />}
        {tab === 'edges' && <EdgesTab />}
        {tab === 'style' && <StyleTab />}
      </div>
    </aside>
  );
}

/* ---------------- 状态页 ---------------- */

function StatesTab() {
  const app = useApp();
  const [name, setName] = useState('');
  const [bulk, setBulk] = useState('');
  const [showBulk, setShowBulk] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const submit = () => {
    if (!name.trim()) return;
    app.addState(name);
    setName('');
  };

  return (
    <div>
      <Section title="添加状态">
        <div className="flex gap-1.5">
          <input className="field-input" placeholder="状态名，回车创建" value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} />
          <button className="btn btn-accent !px-3" onClick={submit} title="添加状态" aria-label="添加状态">
            {I.plus()}
          </button>
        </div>
        <button className="mt-2 text-[11.5px] flex items-center gap-1 transition-colors hover:opacity-80"
          style={{ color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer' }}
          onClick={() => setShowBulk((v) => !v)}>
          <span style={{ transform: showBulk ? 'rotate(180deg)' : undefined, display: 'inline-flex', transition: 'transform .15s' }}>{I.chevron(12)}</span>
          批量添加（每行 / 逗号 / 分号分隔）
        </button>
        {showBulk && (
          <div className="mt-2 anim-fade">
            <textarea className="field-input font-code" rows={4} placeholder={'S1\nS2, S3; S4'} value={bulk}
              onChange={(e) => setBulk(e.target.value)} />
            <button className="btn mt-1.5 w-full justify-center" onClick={() => {
              const n = app.addStatesBulk(bulk.split(/[\n,;，；]/));
              if (n) { setBulk(''); app.toast(`已创建 ${n} 个状态`); }
            }}>创建全部</button>
          </div>
        )}
      </Section>

      <Section title={`状态列表（${app.doc.states.length}）`}>
        <div className="flex flex-col gap-1">
          {app.doc.states.map((s) => (
            <StateRow key={s.id} s={s}
              expanded={expanded === s.id}
              onExpand={() => setExpanded(expanded === s.id ? null : s.id)}
              editing={editing === s.id}
              onStartEdit={() => setEditing(s.id)}
              onEndEdit={() => setEditing(null)} />
          ))}
          {app.doc.states.length === 0 && (
            <div className="text-[12px] py-6 text-center" style={{ color: 'var(--faint)' }}>
              还没有状态<br />在上方输入名称，或双击画布空白处
            </div>
          )}
        </div>
      </Section>
    </div>
  );
}

function StateRow({ s, expanded, onExpand, editing, onStartEdit, onEndEdit }: {
  s: ProjectState; expanded: boolean; onExpand: () => void;
  editing: boolean; onStartEdit: () => void; onEndEdit: () => void;
}) {
  const app = useApp();
  const theme = app.doc.settings.theme;
  const selected = app.sel.states.includes(s.id);
  const isStart = s.id === START_ID;
  const pal = PALETTES[s.color][theme];

  const cycleColor = () => {
    if (isStart) return;
    const i = COLOR_ORDER.indexOf(s.color);
    app.updateState(s.id, { color: COLOR_ORDER[(i + 1) % COLOR_ORDER.length] });
  };

  return (
    <div className="rounded-[9px] transition-all"
      style={{
        background: selected ? 'var(--accent-soft)' : 'var(--panel-2)',
        border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
        boxShadow: selected ? '0 2px 10px rgba(13,148,136,0.12)' : undefined,
      }}>
      <div className="flex items-center gap-1.5 px-2 h-[38px] cursor-pointer"
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey) {
            app.setSel({
              states: selected ? app.sel.states.filter((x) => x !== s.id) : [...app.sel.states, s.id],
              transitions: [],
            });
          } else {
            app.setSel({ states: [s.id], transitions: [] });
          }
        }}>
        <button
          title={isStart ? '初始结点' : `配色：${COLOR_LABELS[s.color]}（点击切换）`}
          aria-label="切换配色"
          onClick={(e) => { e.stopPropagation(); cycleColor(); }}
          className="w-[18px] h-[18px] rounded-[6px] flex-none transition-transform hover:scale-110"
          style={{
            background: isStart ? (theme === 'light' ? '#333f52' : '#cbd5e1') : pal.accent,
            border: `2px solid ${isStart ? 'transparent' : pal.border}`,
            cursor: isStart ? 'default' : 'pointer',
          }} />
        {editing && !isStart ? (
          <input autoFocus className="field-input !h-[26px] !text-[12px]" defaultValue={s.name}
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v) app.updateState(s.id, { name: v });
              onEndEdit();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') onEndEdit();
            }} />
        ) : (
          <span className="flex-1 truncate text-[12.5px] font-semibold"
            onDoubleClick={(e) => { e.stopPropagation(); if (!isStart) onStartEdit(); }}
            title={isStart ? '初始结点（不可改名）' : '双击改名'}>
            {isStart ? 'start（初始结点）' : s.name}
          </span>
        )}
        <span className="text-[10px] px-1.5 py-[2px] rounded-[5px] flex-none font-medium"
          style={{ background: 'var(--panel)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
          {KIND_LABEL[s.kind]}
        </span>
        <button className="icon-btn !w-6 !h-6" title="画布中定位" aria-label="画布中定位"
          onClick={(e) => { e.stopPropagation(); app.focusOn(s.id); app.setSel({ states: [s.id], transitions: [] }); }}>
          {I.locate(13)}
        </button>
        {!isStart && (
          <button className="icon-btn !w-6 !h-6" style={{ transform: expanded ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }}
            title="编辑详情" aria-label="编辑详情"
            onClick={(e) => { e.stopPropagation(); onExpand(); }}>
            {I.chevron(13)}
          </button>
        )}
        {isStart && <span style={{ color: 'var(--faint)' }} title="初始结点受保护">{I.lock(12)}</span>}
      </div>

      {expanded && !isStart && (
        <div className="px-2.5 pb-2.5 pt-1 anim-fade" style={{ borderTop: '1px dashed var(--border)' }}>
          <div className="grid grid-cols-2 gap-1.5 mt-1.5">
            <div>
              <label className="field-label">类型</label>
              <select className="field-input !h-[28px] !text-[12px]" value={s.kind}
                onChange={(e) => app.updateState(s.id, { kind: e.target.value as NodeKind })}>
                <option value="state">普通状态</option>
                <option value="terminal">终止状态</option>
                <option value="junction">连接点</option>
              </select>
            </div>
            <div>
              <label className="field-label">配色</label>
              <div className="pt-1"><Swatches value={s.color} onPick={(c) => { if (c !== 'follow') app.updateState(s.id, { color: c }); }} /></div>
            </div>
          </div>
          {s.kind !== 'junction' && (
            <>
              {(['entry', 'during', 'exit'] as const).map((k) => (
                <div key={k} className="mt-1.5">
                  <label className="field-label font-code">{k} 动作</label>
                  <textarea className="field-input font-code !text-[11.5px]" rows={2}
                    placeholder={k === 'entry' ? 'cnt = 0;' : k === 'during' ? 'lamp = RED;' : 'motor = 0;'}
                    defaultValue={s[k] ?? ''}
                    onBlur={(e) => app.updateState(s.id, { [k]: e.target.value || undefined } as Partial<ProjectState>)} />
                </div>
              ))}
            </>
          )}
          <div className="mt-1.5">
            <label className="field-label">备注（仅编辑器可见）</label>
            <textarea className="field-input !text-[11.5px]" rows={2} defaultValue={s.note ?? ''}
              placeholder="不会导出到图片"
              onBlur={(e) => app.updateState(s.id, { note: e.target.value || undefined })} />
          </div>
          <div className="flex gap-1.5 mt-2">
            <button className="btn btn-danger flex-1 justify-center !h-[28px] !text-[12px]"
              onClick={() => app.deleteStates([s.id])}>
              {I.trash(13)} 删除状态
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- 转移表页 ---------------- */

function EdgesTab() {
  const app = useApp();
  const states = app.doc.states;
  const [src, setSrc] = useState('');
  const [dst, setDst] = useState('');
  const [label, setLabel] = useState('');
  const [bulk, setBulk] = useState('');
  const [showBulk, setShowBulk] = useState(false);

  const source = states.some((s) => s.id === src) ? src : states[0]?.id ?? '';
  const target = states.some((s) => s.id === dst) ? dst : states[1]?.id ?? states[0]?.id ?? '';

  const submit = () => {
    if (!source || !target) { app.toast('请先创建至少一个状态', 'err'); return; }
    app.addTransition(source, target, label);
    setLabel('');
  };

  return (
    <div>
      <Section title="添加转移">
        <div className="flex gap-1.5 items-center">
          <StateSelect value={source} onChange={setSrc} ariaLabel="源状态" />
          <span className="flex-none" style={{ color: 'var(--accent)' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          </span>
          <StateSelect value={target} onChange={setDst} ariaLabel="目标状态" />
        </div>
        <div className="flex gap-1.5 mt-1.5">
          <input className="field-input font-code !text-[11.5px]" placeholder="TICK[cond]{act}/do()"
            value={label} onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} />
          <button className="btn btn-accent !px-3" onClick={submit} title="添加转移" aria-label="添加转移">{I.plus()}</button>
        </div>
        <button className="mt-2 text-[11.5px] flex items-center gap-1"
          style={{ color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer' }}
          onClick={() => setShowBulk((v) => !v)}>
          <span style={{ transform: showBulk ? 'rotate(180deg)' : undefined, display: 'inline-flex', transition: 'transform .15s' }}>{I.chevron(12)}</span>
          批量导入（每行：源 -&gt; 目标 : 标签）
        </button>
        {showBulk && (
          <div className="mt-2 anim-fade">
            <textarea className="field-input font-code !text-[11px]" rows={5}
              placeholder={'# 注释行\n红灯 -> 绿灯 : TICK[cnt>=30]\n绿灯 → 黄灯 : TICK\n黄灯 => 红灯 : TICK[t>=3]/next()'}
              value={bulk} onChange={(e) => setBulk(e.target.value)} />
            <button className="btn mt-1.5 w-full justify-center" onClick={() => {
              app.importBulkTransitions(bulk);
              setBulk('');
            }}>解析并导入</button>
          </div>
        )}
      </Section>

      <Section title={`转移列表（${app.doc.transitions.length}）`}>
        <div className="flex flex-col gap-1">
          {app.doc.transitions.map((t) => (
            <TransitionRow key={t.id} t={t} />
          ))}
          {app.doc.transitions.length === 0 && (
            <div className="text-[12px] py-6 text-center" style={{ color: 'var(--faint)' }}>
              还没有转移<br />拖拽结点边缘的圆点到另一个结点即可连线
            </div>
          )}
        </div>
      </Section>
    </div>
  );
}

function StateSelect({ value, onChange, ariaLabel }: { value: string; onChange: (v: string) => void; ariaLabel: string }) {
  const app = useApp();
  return (
    <select className="field-input !h-[30px] !text-[12px]" value={value} aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}>
      {app.doc.states.map((s) => (
        <option key={s.id} value={s.id}>
          {s.id === START_ID ? 'start（初始）' : s.name}
        </option>
      ))}
    </select>
  );
}

/** 标签草稿输入：聚焦时保留用户原文（容忍残缺括号），失焦时同步规范化文本；数据始终实时解析 */
function LabelDraftInput({ t, className, style, placeholder }: {
  t: ProjectTransition; className?: string; style?: CSSProperties; placeholder?: string;
}) {
  const app = useApp();
  const external = formatLabel(t);
  const [draft, setDraft] = useState(external);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(external);
  }, [external, focused]);
  return (
    <input
      className={className} style={style} placeholder={placeholder}
      value={draft} aria-label="转移标签"
      onFocus={() => setFocused(true)}
      onBlur={() => { setFocused(false); setDraft(formatLabel(t)); }}
      onChange={(e) => { setDraft(e.target.value); app.updateTransition(t.id, { label: e.target.value }); }}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

function TransitionRow({ t }: { t: ProjectTransition }) {
  const app = useApp();
  const selected = app.sel.transitions.includes(t.id);
  const selfLoop = t.source === t.target;
  const nameOf = (id: string) => {
    const s = app.doc.states.find((x) => x.id === id);
    return s ? (s.id === START_ID ? 'start' : s.name) : id;
  };

  return (
    <div className="rounded-[9px] px-2 py-1.5 cursor-pointer transition-all"
      style={{
        background: selected ? 'var(--accent-soft)' : 'var(--panel-2)',
        border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
        opacity: t.enabled ? 1 : 0.55,
      }}
      onClick={() => app.setSel({ states: [], transitions: [t.id] })}>
      <div className="flex items-center gap-1">
        <button className="icon-btn !w-6 !h-6" title={t.enabled ? '隐藏（不渲染不导出）' : '显示'}
          aria-label={t.enabled ? '隐藏转移' : '显示转移'}
          style={{ color: t.enabled ? 'var(--muted)' : 'var(--faint)' }}
          onClick={(e) => { e.stopPropagation(); app.updateTransition(t.id, { enabled: !t.enabled }); }}>
          {t.enabled ? I.eye(13) : I.eyeOff(13)}
        </button>
        <span className="flex-1 truncate text-[12px] font-semibold" title={`${nameOf(t.source)} → ${nameOf(t.target)}`}>
          {nameOf(t.source)} <span style={{ color: 'var(--accent)' }}>→</span> {nameOf(t.target)}
        </span>
        {selfLoop && (
          <span className="text-[10px] px-1.5 py-[1.5px] rounded-[5px] flex items-center gap-[3px]"
            style={{ background: 'var(--panel)', color: 'var(--warn)', border: '1px solid var(--border)' }}>
            {I.loop(9)} 自环
          </span>
        )}
        <button className="icon-btn !w-6 !h-6 btn-danger" title="删除转移" aria-label="删除转移"
          onClick={(e) => { e.stopPropagation(); app.deleteTransitions([t.id]); }}>
          {I.trash(12)}
        </button>
      </div>
      <LabelDraftInput t={t}
        className="field-input font-code !h-[26px] !text-[11px] mt-1"
        style={{ background: 'var(--panel)' }}
        placeholder="（默认转移，无标签）" />
    </div>
  );
}

/* ---------------- 外观页 ---------------- */

function StyleTab() {
  const app = useApp();
  const st = app.doc.settings;

  const EdgeGlyph = ({ kind }: { kind: string }) => (
    <svg width="22" height="14" viewBox="0 0 22 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      {kind === 'straight' && <path d="M2 11 L20 3" />}
      {kind === 'orthogonal' && <path d="M2 11 H11 V3 H20" />}
      {kind === 'smoothstep' && <path d="M2 11 H7 Q11 11 11 7 V7 Q11 3 15 3 H20" />}
      {kind === 'bezier' && <path d="M2 11 C 9 11, 13 3, 20 3" />}
      <path d="M20 3 l-3.4 -1.6 v3.2 z" fill="currentColor" stroke="none" transform="rotate(0)" />
    </svg>
  );

  return (
    <div>
      <Section title="自动布局">
        <div className="grid grid-cols-2 gap-1.5">
          {([['LR', '横向层级'], ['TB', '纵向层级'], ['circle', '环形'], ['grid', '网格']] as const).map(([k, label]) => (
            <button key={k} className="btn justify-center !h-[34px]"
              style={st.layout === k ? { borderColor: 'var(--accent)', color: 'var(--accent)', background: 'var(--accent-soft)' } : undefined}
              onClick={() => app.applyLayout(k)}>
              <LayoutGlyph kind={k} /> {label}
            </button>
          ))}
        </div>
        <button className="btn w-full justify-center mt-1.5" onClick={() => app.applyLayout(st.layout)}>
          重新排布当前图 <kbd>L</kbd>
        </button>
      </Section>

      <Section title="连线样式">
        <div className="seg">
          {([['smoothstep', '折线'], ['bezier', '曲线'], ['orthogonal', '直角'], ['straight', '直线']] as const).map(([k, label]) => (
            <button key={k} className={`seg-btn ${st.edgeStyle === k ? 'on' : ''}`} title={label}
              onClick={() => app.updateSettings({ edgeStyle: k })}>
              <EdgeGlyph kind={k} />
            </button>
          ))}
        </div>
        <div className="text-[11px] mt-1 mb-2" style={{ color: 'var(--faint)' }}>
          {{ smoothstep: '圆角折线（r=12）', bezier: '贝塞尔曲线', orthogonal: '直角折线', straight: '直线' }[st.edgeStyle]}
        </div>
      </Section>

      <Section title="线宽（全局）">
        <div className="seg">
          {[1, 1.6, 2.2, 3].map((w) => (
            <button key={w} className={`seg-btn ${st.edgeWidth === w ? 'on' : ''}`}
              onClick={() => app.updateSettings({ edgeWidth: w })}>
              <svg width="18" height="8" viewBox="0 0 18 8"><line x1="1" y1="4" x2="17" y2="4" stroke="currentColor" strokeWidth={w} strokeLinecap="round" /></svg>
            </button>
          ))}
        </div>
        <div className="text-[11px] mt-1 mb-2" style={{ color: 'var(--faint)' }}>细 1 / 标准 1.6 / 中 2.2 / 粗 3 px</div>
      </Section>

      <Section title="箭头大小（全局）">
        <div className="seg">
          {[12, 16, 22].map((a) => (
            <button key={a} className={`seg-btn ${st.arrowSize === a ? 'on' : ''}`}
              onClick={() => app.updateSettings({ arrowSize: a })}>
              <svg width={a} height={a} viewBox="0 0 22 22">
                <path d={`M2 11 H${20 - a * 0.4}`} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                <path d={`M20 11 l-${a * 0.5} -${a * 0.32} v${a * 0.64} z`} fill="currentColor" />
              </svg>
            </button>
          ))}
        </div>
        <div className="text-[11px] mt-1" style={{ color: 'var(--faint)' }}>小 12 / 中 16 / 大 22 px</div>
      </Section>

      <Section title="画布选项">
        <div className="rounded-[9px] px-2.5" style={{ background: 'var(--panel-2)', border: '1px solid var(--border)' }}>
          <ToggleRow label="网格背景" on={st.showGrid} onChange={(v) => app.setViewSettings({ showGrid: v })} />
          <div style={{ borderTop: '1px dashed var(--border)' }} />
          <ToggleRow label="小地图" on={st.showMiniMap} onChange={(v) => app.setViewSettings({ showMiniMap: v })} />
          <div style={{ borderTop: '1px dashed var(--border)' }} />
          <ToggleRow label="吸附网格" hint="拖拽对齐 16px" on={st.snapToGrid} onChange={(v) => app.updateSettings({ snapToGrid: v })} />
          <div style={{ borderTop: '1px dashed var(--border)' }} />
          <ToggleRow label="结点显示动作文本" hint="entry / during / exit" on={st.showActionText} onChange={(v) => app.updateSettings({ showActionText: v })} />
        </div>
      </Section>
    </div>
  );
}

function LayoutGlyph({ kind }: { kind: string }) {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      {kind === 'LR' && <><rect x="1" y="6" width="4" height="4" rx="1" /><rect x="11" y="6" width="4" height="4" rx="1" /><path d="M5.5 8h4" stroke="currentColor" strokeWidth="1.4" /><path d="M9.5 8l-2 -1.4v2.8z" /></>}
      {kind === 'TB' && <><rect x="6" y="1" width="4" height="4" rx="1" /><rect x="6" y="11" width="4" height="4" rx="1" /><path d="M8 5.5v4" stroke="currentColor" strokeWidth="1.4" /><path d="M8 9.5l-1.4 -2h2.8z" /></>}
      {kind === 'circle' && <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="2.6 2" />}
      {kind === 'grid' && <><rect x="1.5" y="1.5" width="5" height="5" rx="1" /><rect x="9.5" y="1.5" width="5" height="5" rx="1" /><rect x="1.5" y="9.5" width="5" height="5" rx="1" /><rect x="9.5" y="9.5" width="5" height="5" rx="1" /></>}
    </svg>
  );
}

/* ============================================================
 * 右侧属性面板（Inspector，随选择变化五态）
 * ============================================================ */

export function Inspector() {
  const app = useApp();
  const { states, transitions } = app.sel;
  let body: ReactNode;
  if (states.length === 1) body = <StateInspector id={states[0]} />;
  else if (states.length > 1) body = <MultiStateInspector ids={states} />;
  else if (transitions.length === 1) body = <EdgeInspector id={transitions[0]} />;
  else if (transitions.length > 1) body = <MultiEdgeInspector ids={transitions} />;
  else body = <EmptyInspector />;

  return (
    <aside className="w-[300px] flex-none flex flex-col overflow-y-auto"
      style={{ background: 'var(--panel)', borderLeft: '1px solid var(--border)' }}>
      <div className="px-3.5 h-[42px] flex items-center gap-2 flex-none" style={{ borderBottom: '1px solid var(--border)' }}>
        <span style={{ color: 'var(--accent)' }}>{I.box(15)}</span>
        <span className="font-display font-bold text-[13px]">属性面板</span>
        <span className="text-[10.5px] ml-auto px-1.5 py-[2px] rounded-[5px]"
          style={{ background: 'var(--panel-2)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
          {states.length === 1 ? '状态' : states.length > 1 ? `${states.length} 个状态`
            : transitions.length === 1 ? '转移' : transitions.length > 1 ? `${transitions.length} 条转移` : '无选择'}
        </span>
      </div>
      <div className="pb-6 anim-fade" key={states.join(',') + '|' + transitions.join(',')}>
        {body}
      </div>
    </aside>
  );
}

function StateInspector({ id }: { id: string }) {
  const app = useApp();
  const s = app.doc.states.find((x) => x.id === id);
  if (!s) return null;
  const isStart = s.id === START_ID;
  const deg = useMemo(() => app.doc.transitions.filter((t) => t.source === id || t.target === id).length,
    [app.doc.transitions, id]);

  return (
    <div>
      <Section title="名称">
        <input className="field-input font-semibold" value={isStart ? 'start' : s.name} disabled={isStart}
          onChange={(e) => app.updateState(s.id, { name: e.target.value })}
          onBlur={(e) => { if (!e.target.value.trim()) e.target.value = s.name; }}
          aria-label="状态名称" />
        {isStart && <div className="text-[11px] mt-1 flex items-center gap-1" style={{ color: 'var(--faint)' }}>{I.lock(11)} 初始结点不可改名 / 删除</div>}
      </Section>

      {!isStart && (
        <Section title="类型">
          <div className="seg">
            {([['state', '普通'], ['terminal', '终止'], ['junction', '连接点']] as const).map(([k, label]) => (
              <button key={k} className={`seg-btn ${s.kind === k ? 'on' : ''}`}
                onClick={() => app.updateState(s.id, { kind: k })}>{label}</button>
            ))}
          </div>
        </Section>
      )}

      <Section title="配色">
        <Swatches value={s.color} onPick={(c) => { if (c !== 'follow') app.updateState(s.id, { color: c }); }} />
      </Section>

      {!isStart && s.kind !== 'junction' && (
        <Section title="动作（Stateflow 风格）">
          {(['entry', 'during', 'exit'] as const).map((k) => (
            <div key={k} className="mb-1.5">
              <label className="field-label font-code">{k}/</label>
              <textarea className="field-input font-code !text-[11.5px]" rows={2}
                defaultValue={s[k] ?? ''}
                placeholder={k === 'entry' ? '进入时执行' : k === 'during' ? '驻留期间执行' : '离开时执行'}
                onBlur={(e) => app.updateState(s.id, { [k]: e.target.value || undefined } as Partial<ProjectState>)} />
            </div>
          ))}
        </Section>
      )}

      {!isStart && (
        <Section title="备注">
          <textarea className="field-input !text-[11.5px]" rows={2} defaultValue={s.note ?? ''}
            placeholder="仅编辑器可见，不导出"
            onBlur={(e) => app.updateState(s.id, { note: e.target.value || undefined })} />
        </Section>
      )}

      <Section title="信息">
        <div className="text-[11.5px] rounded-[9px] px-3 py-2 font-code"
          style={{ background: 'var(--panel-2)', border: '1px solid var(--border)', color: 'var(--muted)' }}>
          id: {s.id}<br />
          位置: ({Math.round(s.position.x)}, {Math.round(s.position.y)})<br />
          关联转移: {deg} 条
        </div>
      </Section>

      {!isStart && (
        <div className="px-3.5 mt-4 flex gap-1.5">
          <button className="btn flex-1 justify-center" onClick={() => { app.focusOn(s.id); }}>
            {I.locate(13)} 定位
          </button>
          <button className="btn btn-danger flex-1 justify-center" onClick={() => app.deleteStates([s.id])}>
            {I.trash(13)} 删除
          </button>
        </div>
      )}
    </div>
  );
}

function EdgeInspector({ id }: { id: string }) {
  const app = useApp();
  const t = app.doc.transitions.find((x) => x.id === id);
  if (!t) return null;
  const selfLoop = t.source === t.target;

  return (
    <div>
      <Section title="标签（Stateflow 语法）" right={selfLoop ? (
        <span className="text-[10px] px-1.5 py-[2px] rounded-[5px] flex items-center gap-[3px]"
          style={{ color: 'var(--warn)', background: 'var(--panel-2)', border: '1px solid var(--border)' }}>{I.loop(9)} 自环</span>
      ) : undefined}>
        <LabelDraftInput t={t} className="field-input font-code !text-[11.5px]"
          placeholder="event[cond]{cond_act}/action" />
        <div className="text-[10.5px] mt-1 font-code" style={{ color: 'var(--faint)' }}>
          事件[守卫条件]&#123;条件动作&#125;/转移动作
        </div>
      </Section>

      <Section title="四段分字段">
        {([['event', '事件 event'], ['condition', '条件 condition'], ['conditionAction', '条件动作 {…}'], ['transitionAction', '转移动作 /…']] as const).map(([k, label]) => (
          <div key={k} className="mb-1.5">
            <label className="field-label">{label}</label>
            <input className="field-input font-code !text-[11.5px]" value={t[k] ?? ''}
              onChange={(e) => app.updateTransition(t.id, { [k]: e.target.value || undefined } as Partial<ProjectTransition>)} />
          </div>
        ))}
      </Section>

      <Section title="端点">
        <div className="grid grid-cols-2 gap-1.5">
          <div>
            <label className="field-label">源</label>
            <StateSelect value={t.source} onChange={(v) => app.updateTransition(t.id, { source: v })} ariaLabel="源状态" />
          </div>
          <div>
            <label className="field-label">目标</label>
            <StateSelect value={t.target} onChange={(v) => app.updateTransition(t.id, { target: v })} ariaLabel="目标状态" />
          </div>
        </div>
      </Section>

      <Section title="显示">
        <div className="rounded-[9px] px-2.5" style={{ background: 'var(--panel-2)', border: '1px solid var(--border)' }}>
          <ToggleRow label="启用（渲染并导出）" on={t.enabled !== false}
            onChange={(v) => app.updateTransition(t.id, { enabled: v })} />
        </div>
      </Section>

      <Section title="连线外观（覆盖全局）">
        <div className="field-label">线宽</div>
        <div className="seg mb-2">
          <button className={`seg-btn ${t.lineWidth === undefined ? 'on' : ''}`}
            onClick={() => app.updateTransition(t.id, { lineWidth: undefined })}>全局</button>
          {[1, 1.6, 2.2, 3].map((w) => (
            <button key={w} className={`seg-btn ${t.lineWidth === w ? 'on' : ''}`}
              onClick={() => app.updateTransition(t.id, { lineWidth: w })}>
              <svg width="14" height="8" viewBox="0 0 14 8"><line x1="1" y1="4" x2="13" y2="4" stroke="currentColor" strokeWidth={w} strokeLinecap="round" /></svg>
            </button>
          ))}
        </div>
        <div className="rounded-[9px] px-2.5 mb-2" style={{ background: 'var(--panel-2)', border: '1px solid var(--border)' }}>
          <ToggleRow label="虚线" on={t.dashed === true}
            onChange={(v) => app.updateTransition(t.id, { dashed: v || undefined })} />
        </div>
        <div className="field-label">线颜色</div>
        <Swatches allowFollow value={t.lineColor ?? 'follow'}
          onPick={(c) => app.updateTransition(t.id, { lineColor: c === 'follow' ? undefined : c })} />
      </Section>

      <Section title="备注">
        <textarea className="field-input !text-[11.5px]" rows={2} defaultValue={t.note ?? ''}
          placeholder="仅编辑器可见"
          onBlur={(e) => app.updateTransition(t.id, { note: e.target.value || undefined })} />
      </Section>

      <div className="px-3.5 mt-4">
        <button className="btn btn-danger w-full justify-center" onClick={() => app.deleteTransitions([t.id])}>
          {I.trash(13)} 删除转移
        </button>
      </div>
    </div>
  );
}

function MultiStateInspector({ ids }: { ids: string[] }) {
  const app = useApp();
  const aligns: [string, string][] = [
    ['left', '左对齐'], ['hcenter', '水平居中'], ['right', '右对齐'],
    ['top', '顶对齐'], ['vcenter', '垂直居中'], ['bottom', '底对齐'],
  ];
  return (
    <div>
      <Section title={`已选中 ${ids.length} 个状态`}>
        <div className="text-[11.5px]" style={{ color: 'var(--muted)' }}>对齐基准为选中集整体包围盒</div>
      </Section>
      <Section title="对齐">
        <div className="grid grid-cols-3 gap-1.5">
          {aligns.map(([k, label]) => (
            <button key={k} className="btn justify-center !h-[34px] !px-1" title={label}
              onClick={() => app.alignStates(ids, k)}>
              <AlignIcon kind={k} />
            </button>
          ))}
        </div>
      </Section>
      <Section title="分布">
        <div className="grid grid-cols-2 gap-1.5">
          <button className="btn justify-center !h-[34px]" onClick={() => app.distributeStates(ids, 'h')}
            title="水平等距分布（首尾不动）">
            <AlignIcon kind="dh" /> 水平等距
          </button>
          <button className="btn justify-center !h-[34px]" onClick={() => app.distributeStates(ids, 'v')}
            title="垂直等距分布（首尾不动）">
            <AlignIcon kind="dv" /> 垂直等距
          </button>
        </div>
      </Section>
      <Section title="批量配色">
        <Swatches value={null} onPick={(c) => { if (c !== 'follow') app.setStatesColor(ids, c); }} />
      </Section>
      <div className="px-3.5 mt-4">
        <button className="btn btn-danger w-full justify-center"
          onClick={() => app.deleteStates(ids)}>
          {I.trash(13)} 删除 {ids.filter((x) => x !== START_ID).length} 个状态
        </button>
      </div>
    </div>
  );
}

function MultiEdgeInspector({ ids }: { ids: string[] }) {
  const app = useApp();
  return (
    <div>
      <Section title={`已选中 ${ids.length} 条转移`}>
        <div className="text-[11.5px]" style={{ color: 'var(--muted)' }}>可批量显示 / 隐藏或删除</div>
      </Section>
      <div className="px-3.5 flex flex-col gap-1.5 mt-2">
        <button className="btn justify-center" onClick={() => app.updateTransitionsBulk(ids, { enabled: true })}>
          {I.eye(13)} 全部显示
        </button>
        <button className="btn justify-center" onClick={() => app.updateTransitionsBulk(ids, { enabled: false })}>
          {I.eyeOff(13)} 全部隐藏
        </button>
        <button className="btn btn-danger justify-center" onClick={() => app.deleteTransitions(ids)}>
          {I.trash(13)} 删除全部
        </button>
      </div>
    </div>
  );
}

function EmptyInspector() {
  const app = useApp();
  const n = app.doc.states.length;
  const m = app.doc.transitions.length;
  return (
    <div>
      <Section title="当前工程">
        <div className="rounded-[10px] p-3.5" style={{ background: 'var(--panel-2)', border: '1px solid var(--border)' }}>
          <div className="font-display font-bold text-[20px] leading-none">
            {app.doc.name}
          </div>
          <div className="mt-2.5 flex gap-4 text-[12px]" style={{ color: 'var(--muted)' }}>
            <span><b className="font-display text-[15px]" style={{ color: 'var(--accent)' }}>{n}</b> 个状态</span>
            <span><b className="font-display text-[15px]" style={{ color: 'var(--accent)' }}>{m}</b> 条转移</span>
          </div>
        </div>
      </Section>
      <Section title="操作提示">
        <ul className="text-[11.5px] leading-[1.9] pl-1" style={{ color: 'var(--muted)' }}>
          <li>· 双击画布空白处 → 新建状态</li>
          <li>· 悬停结点，拖边缘圆点 → 创建转移</li>
          <li>· 双击结点 → 行内重命名</li>
          <li>· Shift 拖空白 → 框选多个状态</li>
          <li>· Delete → 删除选中</li>
        </ul>
      </Section>
      <div className="px-3.5 mt-4 flex flex-col gap-1.5">
        <button className="btn btn-accent justify-center" onClick={() => app.addState()}>
          {I.plus(13)} 新建状态
        </button>
        <button className="btn justify-center" onClick={() => app.loadSample(0)}>载入示例：交通信号灯</button>
        <button className="btn justify-center" onClick={() => app.loadSample(1)}>载入示例：电机控制</button>
      </div>
    </div>
  );
}
