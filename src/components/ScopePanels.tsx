/* ============================================================
 * ScopePanels —— 左侧（节点库 + 结构大纲）/ 右侧（检查器）
 * 颜色选择器展示当前主题下的实际颜色（所见即所得）。
 * ============================================================ */
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useScope } from '../store/scopeStore';
import { SHAPE_COLORS, SHAPE_COLOR_ORDER, readableOn } from '../lib/core';
import type { ShapeColorKey } from '../lib/domain';
import { NODE_DEFAULTS, NODE_TYPE_LABEL, buildHierarchy, calledBy } from '../lib/domain';
import type { NodeType, HierarchyNode, ID, CallNode, Edge } from '../lib/domain';

const sv = (d: string, s = 16) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);
const Ic = {
  chevL: sv('M15 6l-6 6 6 6', 14), chevR: sv('M9 6l6 6-6 6', 14), chevD: sv('M6 9l6 6 6-6', 12),
  plus: sv('M12 5v14M5 12h14'), trash: sv('M4 7h16M9 7V5h6v2m-8 0 1 13h8l1-13'),
  layout: sv('M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z'),
  proc: sv('M4 6h16v4H4zM4 14h16v4H4z'),
};

/* ================= 左侧面板（结构大纲 + 共同调用库） ================= */
export function LeftPanel({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const app = useScope();
  const [outlineOpen, setOutlineOpen] = useState(true);
  const [libOpen, setLibOpen] = useState(true);
  const [fnSelected, setFnSelected] = useState<ID | null>(null);
  const [renamingFn, setRenamingFn] = useState<ID | null>(null);
  const editable = app.mode === 'edit';

  if (!open) {
    return (
      <div className="w-[30px] flex-none flex flex-col items-center pt-2" style={{ background: 'var(--panel)', borderRight: '1px solid var(--border)' }}>
        <button onClick={onToggle} title="展开面板" aria-label="展开面板"
          className="w-6 h-6 rounded-md flex items-center justify-center hover:bg-[var(--panel-2)]" style={{ color: 'var(--muted)' }}>
          {Ic.chevR}
        </button>
      </div>
    );
  }

  const page = app.project.pages.find((p) => p.id === app.scope.pageId);
  const hierarchy = page?.rootProcessId ? buildHierarchy(app.project, page.rootProcessId) : null;
  const refs = fnSelected ? calledBy(app.project, fnSelected) : [];

  return (
    <div className="w-[208px] flex-none flex flex-col overflow-y-auto" style={{ background: 'var(--panel)', borderRight: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between px-3.5 pt-2.5 pb-1.5">
        <span className="text-[10.5px] font-bold tracking-wider" style={{ color: 'var(--muted)' }}>导航</span>
        <button onClick={onToggle} title="收纳面板" aria-label="收纳面板"
          className="w-5 h-5 rounded flex items-center justify-center hover:bg-[var(--panel-2)]" style={{ color: 'var(--muted)' }}>
          {Ic.chevL}
        </button>
      </div>

      {editable && (
        <div className="px-3.5 pb-2">
          <button className="btn w-full justify-center" onClick={app.autoLayout} title="对当前流程自动布局（可撤销）">
            {Ic.layout} 自动布局
          </button>
        </div>
      )}

      {/* 结构大纲 */}
      <div className="px-3.5 pt-1 pb-1 flex items-center justify-between">
        <button className="flex items-center gap-1 text-[10.5px] font-bold tracking-wider" style={{ color: 'var(--muted)' }}
          onClick={() => setOutlineOpen((v) => !v)}>
          {outlineOpen ? Ic.chevD : Ic.chevR} 结构大纲
        </button>
      </div>
      {outlineOpen && (
        <div className="px-2 pb-3">
          {hierarchy ? <OutlineTree node={hierarchy} depth={0} currentId={app.scope.processId} /> : (
            <div className="px-2 py-2 text-[10.5px]" style={{ color: 'var(--muted)' }}>暂无流程</div>
          )}
        </div>
      )}

      {/* 共同调用库 */}
      <div className="px-3.5 pt-1 pb-1 flex items-center justify-between" style={{ borderTop: '1px solid var(--border)' }}>
        <button className="flex items-center gap-1 text-[10.5px] font-bold tracking-wider" style={{ color: 'var(--muted)' }}
          onClick={() => setLibOpen((v) => !v)}>
          {libOpen ? Ic.chevD : Ic.chevR} 共同调用库
        </button>
        {editable && (
          <button onClick={app.addFunction} title="新建公共函数" aria-label="新建公共函数"
            className="w-5 h-5 rounded flex items-center justify-center hover:bg-[var(--panel-2)]" style={{ color: 'var(--accent)' }}>
            {Ic.plus}
          </button>
        )}
      </div>
      {libOpen && (
        <div className="px-2 pb-3 flex flex-col gap-1">
          {app.project.functions.length === 0 && (
            <div className="px-2 py-2 text-[10.5px]" style={{ color: 'var(--muted)' }}>
              {editable ? '尚无公共函数，点 ＋ 创建' : '尚无公共函数'}
            </div>
          )}
          {app.project.functions.map((f) => {
            const active = fnSelected === f.id;
            const n = calledBy(app.project, f.id).length;
            return (
              <div key={f.id} className="rounded-lg border transition-colors"
                style={{ borderColor: active ? 'var(--accent)' : 'var(--border)', background: active ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : 'var(--panel-2)' }}>
                <div className="flex items-center gap-1.5 px-2 py-1.5">
                  {renamingFn === f.id ? (
                    <input autoFocus defaultValue={f.name}
                      className="field-input flex-1 min-w-0 !py-1 !text-[11px]"
                      onBlur={(e) => { const v = e.target.value.trim(); if (v) app.renameFunction(f.id, v); setRenamingFn(null); }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { const v = (e.target as HTMLInputElement).value.trim(); if (v) app.renameFunction(f.id, v); setRenamingFn(null); }
                        if (e.key === 'Escape') setRenamingFn(null);
                      }} />
                  ) : (
                    <button className="flex-1 text-left min-w-0" onClick={() => setFnSelected(active ? null : f.id)}
                      title="点击查看引用位置（called-by）">
                      <div className="text-[11.5px] font-bold truncate" style={{ color: active ? 'var(--accent)' : 'var(--text)' }}>{f.name}</div>
                      <div className="text-[9.5px]" style={{ color: 'var(--muted)' }}>
                        {f.type === 'shared' ? '公共' : f.type === 'library' ? '库' : f.type === 'external' ? '外部' : '本地'} · {n} 处引用
                      </div>
                    </button>
                  )}
                  {editable && (
                    <>
                      <button onClick={() => setRenamingFn(f.id)} title="重命名" aria-label="重命名函数"
                        className="w-5 h-5 rounded flex items-center justify-center hover:bg-[var(--panel)]" style={{ color: 'var(--muted)' }}>
                        <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M17 3l4 4L8 20l-5 1 1-5L17 3z" /></svg>
                      </button>
                      <button onClick={() => app.deleteFunction(f.id)} title="删除（被引用时不可删）" aria-label="删除函数"
                        className="w-5 h-5 rounded flex items-center justify-center hover:bg-[var(--panel)]" style={{ color: 'var(--muted)' }}>
                        {Ic.trash}
                      </button>
                    </>
                  )}
                </div>
                {active && (
                  <div className="px-2 pb-1.5 flex flex-col gap-0.5" style={{ borderTop: '1px solid var(--border)' }}>
                    <div className="text-[9.5px] font-bold pt-1.5 pb-0.5" style={{ color: 'var(--muted)' }}>引用位置（called-by）</div>
                    {refs.length === 0 && <div className="text-[10.5px] py-1" style={{ color: 'var(--muted)' }}>暂无引用</div>}
                    {refs.map((r) => (
                      <button key={r.nodeId} onClick={() => { app.enterScope(r.processId); app.setSel({ kind: 'node', ids: [r.nodeId] }); }}
                        className="text-left px-1.5 py-1 rounded text-[10.5px] transition-colors hover:bg-[var(--panel)]"
                        style={{ color: 'var(--text)' }}
                        title="跳转到引用处">
                        <span style={{ color: 'var(--accent)' }}>{r.nodeName}</span>
                        <span style={{ color: 'var(--muted)' }}> ← {r.processName}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-auto p-3.5 text-[10px] leading-4" style={{ color: 'var(--muted)' }}>
        双击「调用」进入子流程<br />按 P 键在鼠标处插入节点
      </div>
    </div>
  );
}

function OutlineTree({ node, depth, currentId }: { node: HierarchyNode; depth: number; currentId?: ID }) {
  const app = useScope();
  const [open, setOpen] = useState(true);
  const isCur = node.process.id === currentId;
  return (
    <div>
      <div className="flex items-center gap-1 rounded-md px-1.5 py-1 cursor-pointer transition-colors hover:bg-[var(--panel-2)]"
        style={{ paddingLeft: 6 + depth * 14, background: isCur ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : undefined }}
        onClick={() => app.gotoProcess(node.process.id)}>
        {node.children.length > 0 ? (
          <button onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }} style={{ color: 'var(--muted)' }} aria-label="展开/收起">
            {open ? Ic.chevD : Ic.chevR}
          </button>
        ) : <span className="w-[12px]" />}
        <span className="w-1.5 h-1.5 rounded-full flex-none" style={{ background: 'var(--accent)' }} />
        <span className="text-[11.5px] font-semibold truncate" style={{ color: isCur ? 'var(--accent)' : 'var(--text)' }}>
          {node.process.name}
        </span>
        <span className="ml-auto text-[9.5px] flex-none" style={{ color: 'var(--muted)' }}>{node.process.nodes.length}</span>
      </div>
      {open && node.children.map((c) => <OutlineTree key={c.process.id} node={c} depth={depth + 1} currentId={currentId} />)}
    </div>
  );
}

/* ================= 右侧检查器 ================= */
export function Inspector({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const app = useScope();
  const { sel } = app;
  const body = useMemo(() => {
    if (sel.kind === 'node' && sel.ids.length > 1) return <MultiInspector />;
    if (sel.kind === 'node' && sel.id) {
      const n = app.projection.nodes.find((x) => x.id === sel.id);
      return n ? <NodeInspector id={n.id} /> : null;
    }
    if (sel.kind === 'edge' && sel.id) {
      const e = app.projection.edges.find((x) => x.id === sel.id);
      return e ? <EdgeInspector e={e} /> : null;
    }
    return <EmptyInspector />;
  }, [sel, app.projection]);

  if (!open) {
    return (
      <div className="w-[30px] flex-none flex flex-col items-center pt-2" style={{ background: 'var(--panel)', borderLeft: '1px solid var(--border)' }}>
        <button onClick={onToggle} title="展开属性面板" aria-label="展开属性面板"
          className="w-6 h-6 rounded-md flex items-center justify-center hover:bg-[var(--panel-2)]" style={{ color: 'var(--muted)' }}>
          {Ic.chevL}
        </button>
      </div>
    );
  }
  return (
    <div className="w-[232px] flex-none overflow-y-auto" style={{ background: 'var(--panel)', borderLeft: '1px solid var(--border)' }}>
      <div className="flex items-center justify-end px-2 pt-2">
        <button onClick={onToggle} title="收纳属性面板" aria-label="收纳属性面板"
          className="w-5 h-5 rounded flex items-center justify-center hover:bg-[var(--panel-2)]" style={{ color: 'var(--muted)' }}>
          {Ic.chevR}
        </button>
      </div>
      {body}
    </div>
  );
}

function Head({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="px-3.5 pt-1 pb-2">
      <div className="text-[13px] font-extrabold" style={{ color: 'var(--text)' }}>{title}</div>
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
function DeleteBtn({ onClick }: { onClick: () => void }) {
  return (
    <div className="px-3.5 py-2">
      <button className="btn w-full justify-center" style={{ color: '#e11d48', borderColor: 'color-mix(in srgb,#e11d48 40%, transparent)' }} onClick={onClick}>
        {Ic.trash} 删除
      </button>
    </div>
  );
}

function EmptyInspector() {
  const app = useScope();
  const proc = app.currentProcess;
  return (
    <div className="px-3.5 py-6 text-center">
      <Head title={proc?.name ?? '未命名流程'} sub={`${proc?.nodes.length ?? 0} 节点 · ${proc?.edges.length ?? 0} 连线`} />
      <p className="text-[10.5px] leading-4 mt-2" style={{ color: 'var(--muted)' }}>
        从左侧节点库放置元素；<br />拖拽节点四角锚点创建连线；<br />双击「调用」节点进入子流程。
      </p>
    </div>
  );
}

function NodeInspector({ id }: { id: ID }) {
  const app = useScope();
  const n = app.projection.nodes.find((x) => x.id === id)!;
  const colorKey = ((n.properties?.color as string) ?? NODE_DEFAULTS[n.type].color) as ShapeColorKey;
  const isCall = n.type === 'call';
  const targetProc = isCall ? app.project.processes.find((p) => p.id === (n as unknown as CallNode).targetProcessId) : null;
  return (
    <>
      <Head title={NODE_TYPE_LABEL[n.type]} sub="流程节点" />
      <Field label="名称">
        <input className="field-input w-full" value={n.name} onChange={(e) => app.renameNode(id, e.target.value)} />
      </Field>
      <Field label="类型">
        <select className="field-input w-full" value={n.type} onChange={(e) => app.setNodeType(id, e.target.value as NodeType)}>
          {(Object.keys(NODE_TYPE_LABEL) as NodeType[]).map((t) => <option key={t} value={t}>{NODE_TYPE_LABEL[t]}</option>)}
        </select>
      </Field>
      <Field label="填充颜色">
        <div className="flex flex-wrap gap-1.5">
          {SHAPE_COLOR_ORDER.map((c) => {
            const { fill, stroke } = SHAPE_COLORS[c][app.theme];
            return (
              <button key={c} onClick={() => app.setNodeColor(id, c)}
                className="w-[22px] h-[22px] rounded-full transition-transform hover:scale-110"
                style={{ background: fill, border: `2px solid ${stroke}`, outline: colorKey === c ? `2px solid ${stroke}` : 'none', outlineOffset: 2 }}
                aria-label={c} />
            );
          })}
        </div>
      </Field>
      {isCall && (
        <Field label="调用的子流程">
          <div className="flex items-center gap-1.5">
            <span className="text-[11.5px] font-semibold truncate flex-1" style={{ color: 'var(--text)' }}>{targetProc?.name ?? '（缺失）'}</span>
            {targetProc && (
              <button className="btn !py-1 !text-[10.5px]" onClick={() => app.enterScope(targetProc.id)}>进入 →</button>
            )}
          </div>
        </Field>
      )}
      <DeleteBtn onClick={app.deleteSel} />
    </>
  );
}

function EdgeInspector({ e }: { e: Edge }) {
  const app = useScope();
  const kind = e.style?.type ?? 'default';
  return (
    <>
      <Head title="连线" sub="流程连线 · 可配置线形/虚线/颜色" />
      <Field label="标签">
        <input className="field-input w-full" value={e.label ?? ''} placeholder="如：是 / 完成"
          onChange={(ev) => app.setEdgeLabel(e.id, ev.target.value)} />
      </Field>
      <Field label="线形">
        <div className="seg w-full">
          {([['default', '默认'], ['smoothstep', '平滑'], ['step', '直角'], ['straight', '直线']] as const).map(([v, t]) => (
            <button key={v} className={`seg-btn flex-1 ${kind === v ? 'on' : ''}`}
              onClick={() => app.setEdgeStyle(e.id, { type: v })}>{t}</button>
          ))}
        </div>
      </Field>
      <div className="px-3.5 py-1.5 flex items-center justify-between">
        <span className="text-[11.5px] font-medium" style={{ color: 'var(--text)' }}>虚线</span>
        <button className={`switch ${e.style?.dashed ? 'on' : ''}`} onClick={() => app.setEdgeStyle(e.id, { dashed: !e.style?.dashed })} aria-label="虚线">
          <span className="absolute top-[2px] rounded-full bg-white transition-all" style={{ width: 15, height: 15, left: e.style?.dashed ? 17 : 2 }} />
        </button>
      </div>
      <DeleteBtn onClick={() => app.deleteEdge(e.id)} />
    </>
  );
}

/* ---------- 多选：对齐 / 分布 ---------- */
function MultiInspector() {
  const app = useScope();
  const items = app.projection.nodes.filter((n) => app.sel.ids.includes(n.id))
    .map((n) => ({ id: n.id, x: n.x, y: n.y, w: n.w, h: n.h }));
  if (items.length < 2) return null;
  const minX = Math.min(...items.map((i) => i.x)), maxX2 = Math.max(...items.map((i) => i.x + i.w));
  const minY = Math.min(...items.map((i) => i.y)), maxY2 = Math.max(...items.map((i) => i.y + i.h));
  const apply = (fn: (i: typeof items[number]) => { x: number; y: number }) => {
    items.forEach((i) => app.moveNode(i.id, fn(i)));
  };
  const AL: Record<string, { d: string; t: string; run: () => void }> = {
    left: { d: 'M5 4v16M9 7h9v3H9zM9 14h6v3H9z', t: '左对齐', run: () => apply((i) => ({ x: minX, y: i.y })) },
    hc: { d: 'M12 4v16M7 7h10v3H7zM9 14h6v3H9z', t: '水平居中', run: () => apply((i) => ({ x: Math.round((minX + maxX2) / 2 - i.w / 2), y: i.y })) },
    right: { d: 'M19 4v16M6 7h9v3H6zM9 14h6v3H9z', t: '右对齐', run: () => apply((i) => ({ x: maxX2 - i.w, y: i.y })) },
    top: { d: 'M4 5h16M7 9h3v9H7zM14 9h3v5h-3z', t: '顶对齐', run: () => apply((i) => ({ x: i.x, y: minY })) },
    vc: { d: 'M4 12h16M7 7h3v10H7zM14 9h3v6h-3z', t: '垂直居中', run: () => apply((i) => ({ x: i.x, y: Math.round((minY + maxY2) / 2 - i.h / 2) })) },
    bottom: { d: 'M4 19h16M7 6h3v9H7zM14 10h3v5h-3z', t: '底对齐', run: () => apply((i) => ({ x: i.x, y: maxY2 - i.h })) },
  };
  return (
    <>
      <Head title={`已选中 ${items.length} 个节点`} sub="多选对齐（基准 = 包围盒）" />
      <div className="px-3.5 pb-2 pt-2 grid grid-cols-3 gap-1.5">
        {Object.entries(AL).map(([k, o]) => (
          <button key={k} title={o.t} aria-label={o.t} onClick={o.run}
            className="h-9 rounded-lg flex items-center justify-center border transition-all hover:border-[var(--accent)] hover:text-[var(--accent)] active:scale-95"
            style={{ borderColor: 'var(--border)', background: 'var(--panel-2)', color: 'var(--text)' }}>
            {sv(o.d, 16)}
          </button>
        ))}
      </div>
      <DeleteBtn onClick={app.deleteSel} />
    </>
  );
}
