/* ============================================================
 * 顶栏（中文菜单）+ 底栏 + Toast
 * ============================================================ */
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useStudio } from '../studioStore';
import { BkIcon, BI, svgToPng, downloadBlob } from '../lib/boardkit';
import { sanitizeFilename } from '../lib/core';
import type { LayoutKind } from '../lib/core';
import { runLayout } from '../lib/layout';
import { defaultStudioDoc, sampleStudioDoc, normalizeStudio } from '../lib/studio';

function useClickOutside(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  return {
    ref, open,
    toggle: () => setOpen((o) => {
      if (!o) setTimeout(() => {
        const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); window.removeEventListener('mousedown', h); onClose(); } };
        window.addEventListener('mousedown', h);
      }, 0);
      return !o;
    }),
    close: () => setOpen(false),
  };
}

function Menu({ label, children }: { label: ReactNode; children: (close: () => void) => ReactNode }) {
  const m = useClickOutside(() => {});
  return (
    <div className="relative" ref={m.ref}>
      <button className={`menu-label ${m.open ? 'open' : ''}`} onClick={m.toggle}>{label}</button>
      {m.open && (
        <div className="menu absolute right-0 top-[calc(100%+6px)] min-w-[172px] py-1 z-50"
          style={{ background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 10, boxShadow: 'var(--shadow)' }}>
          {children(m.close)}
        </div>
      )}
    </div>
  );
}

function Item({ icon, label, onClick, danger }: { icon?: string; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button className="menu-item" onClick={onClick} style={danger ? { color: '#e11d48' } : undefined}>
      {icon && <BkIcon d={icon} size={14} />}
      <span>{label}</span>
    </button>
  );
}

export function TopBar() {
  const app = useStudio();
  const { doc, set, undo, redo, canUndo, canRedo, requestFit, theme, toast, setSel, exportHandle } = app;
  const openRef = useRef<HTMLInputElement>(null);

  const layoutSm = (kind: LayoutKind, close: () => void) => {
    const smDoc = { version: 1 as const, name: doc.name, states: doc.states, transitions: doc.transitions, settings: doc.settings };
    const posMap = runLayout(smDoc, kind, doc.settings);
    const states = doc.states.map((s) => (posMap.has(s.id) ? { ...s, position: posMap.get(s.id)! } : s));
    set({ ...doc, states, settings: { ...doc.settings, layout: kind } });
    requestFit();
    toast('状态机已重新布局');
    close();
  };

  const doExport = async (format: 'png' | 'svg', scale: number, close: () => void) => {
    close();
    setSel({ kind: null, id: null });
    await new Promise((r) => setTimeout(r, 90));
    const res = exportHandle.current?.(format === 'svg' ? 'theme' : 'white');
    if (!res) { toast('导出失败：画布为空', 'err'); return; }
    const fname = sanitizeFilename(doc.name);
    if (format === 'svg') {
      downloadBlob(new Blob([res.svg], { type: 'image/svg+xml;charset=utf-8' }), `${fname}.svg`);
      toast('已导出 SVG');
    } else {
      try {
        const blob = await svgToPng(res.svg, res.w, res.h, scale);
        downloadBlob(blob, `${fname}@${scale}x.png`);
        toast(`已导出 PNG（${scale}×）`);
      } catch { toast('导出 PNG 失败', 'err'); }
    }
  };

  const saveFile = (close: () => void) => {
    downloadBlob(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }), `${sanitizeFilename(doc.name)}.smflow.json`);
    toast('工程文件已保存');
    close();
  };

  const onOpen = (f: File, close: () => void) => {
    const r = new FileReader();
    r.onload = () => {
      try {
        set(normalizeStudio(JSON.parse(String(r.result))));
        toast('工程已打开');
      } catch { toast('文件解析失败', 'err'); }
    };
    r.readAsText(f);
    close();
  };

  const ib = 'icon-btn';
  return (
    <header className="flex items-center gap-2 px-3 h-[52px] flex-none"
      style={{ background: 'var(--panel)', borderBottom: '1px solid var(--border)' }}>
      {/* 品牌 */}
      <div className="flex items-center gap-2 pr-2" style={{ borderRight: '1px solid var(--border)' }}>
        <svg width="26" height="26" viewBox="0 0 32 32">
          <rect x="3" y="11" width="11" height="11" rx="3" fill="#0d9488" />
          <rect x="18" y="4" width="11" height="9" rx="3" fill="#6366f1" />
          <rect x="18" y="19" width="11" height="9" rx="3" fill="#f59e0b" />
          <path d="M14 15 L18 9 M14 18 L18 23" stroke="#0d9488" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <div className="leading-none">
          <div className="text-[13.5px] font-bold tracking-tight" style={{ color: 'var(--text)' }}>StateFlow Studio</div>
          <div className="text-[9.5px] mt-0.5 font-semibold" style={{ color: 'var(--muted)' }}>状态机 · 流程图 · 白板</div>
        </div>
      </div>

      {/* 工程名（内联编辑） */}
      <input
        className="text-[13px] font-semibold px-2 py-1 rounded-md w-[168px] outline-none transition-colors focus:ring-2"
        style={{ background: 'transparent', color: 'var(--text)', ['--tw-ring-color' as string]: 'var(--accent-soft)' }}
        value={doc.name}
        onChange={(e) => set({ ...doc, name: e.target.value }, false)}
        onBlur={() => { if (!doc.name.trim()) set({ ...doc, name: '未命名画布' }); }}
        aria-label="工程名"
      />

      <div className="flex items-center gap-1">
        <button className={ib} onClick={undo} disabled={!canUndo} title="撤销 (Ctrl/⌘+Z)" aria-label="撤销"><BkIcon d={BI.undo} /></button>
        <button className={ib} onClick={redo} disabled={!canRedo} title="重做 (Ctrl/⌘+Shift+Z)" aria-label="重做"><BkIcon d={BI.redo} /></button>
        <button className={ib} onClick={requestFit} title="适应视图 (F)" aria-label="适应视图"><BkIcon d={BI.fit} /></button>
      </div>

      <div className="flex-1" />

      {/* 状态机布局 */}
      <Menu label={<span className="flex items-center gap-1.5"><BkIcon d={BI.flow} size={14} />状态机布局</span>}>
        {(close) => (<>
          <Item label="横向层级（LR）" onClick={() => layoutSm('LR', close)} />
          <Item label="纵向层级（TB）" onClick={() => layoutSm('TB', close)} />
          <Item label="环形" onClick={() => layoutSm('circle', close)} />
          <Item label="网格" onClick={() => layoutSm('grid', close)} />
        </>)}
      </Menu>

      {/* 文件 */}
      <Menu label="文件">
        {(close) => (<>
          <Item icon={BI.plus} label="新建空白画布" onClick={() => {
            if (window.confirm('新建将清空当前内容，确定吗？')) { set(defaultStudioDoc()); toast('已新建空白画布'); }
            close();
          }} />
          <Item icon={BI.image} label="打开工程文件…" onClick={() => { openRef.current?.click(); close(); }} />
          <Item icon={BI.download} label="保存工程文件" onClick={() => saveFile(close)} />
          <div className="menu-sep" />
          <Item label="载入示例工程" onClick={() => { set(sampleStudioDoc()); requestFit(); toast('已载入示例工程'); close(); }} />
        </>)}
      </Menu>
      <input ref={openRef} type="file" accept=".json,application/json" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onOpen(f, () => {}); e.target.value = ''; }} />

      {/* 导出 */}
      <Menu label={<span className="flex items-center gap-1.5"><BkIcon d={BI.download} size={14} />导出</span>}>
        {(close) => (<>
          <Item label="PNG · 1×" onClick={() => doExport('png', 1, close)} />
          <Item label="PNG · 2×（推荐）" onClick={() => doExport('png', 2, close)} />
          <Item label="PNG · 3×" onClick={() => doExport('png', 3, close)} />
          <div className="menu-sep" />
          <Item label="SVG 矢量" onClick={() => doExport('svg', 1, close)} />
        </>)}
      </Menu>

      {/* 帮助 */}
      <Menu label="帮助">
        {(close) => (<>
          <div className="px-3 py-2 text-[11px] leading-relaxed" style={{ color: 'var(--muted)' }}>
            <div className="font-bold mb-1" style={{ color: 'var(--text)' }}>快捷键</div>
            <div>双击空白 · 放置当前工具元素</div>
            <div>悬停状态右缘 · 拖出转移连线</div>
            <div>Delete · 删除选中</div>
            <div>Ctrl/⌘+Z · 撤销 · +Shift+Z 重做</div>
            <div>F · 适应视图 · V · 选择工具</div>
            <div>滚轮 · 缩放 · 拖空白 · 平移</div>
          </div>
          <div className="menu-sep" />
          <div className="px-3 py-2 text-[11px] leading-relaxed" style={{ color: 'var(--muted)' }}>
            <span className="font-bold" style={{ color: 'var(--text)' }}>StateFlow Studio</span> v2.0<br />
            状态机 · 流程图 · 白板 三合一画布<br />纯前端离线可用 · 数据仅存本地
          </div>
          <div className="menu-sep" />
          <Item label="知道了" onClick={close} />
        </>)}
      </Menu>

      {/* 主题 */}
      <button className={ib}
        onClick={() => set({ ...doc, settings: { ...doc.settings, theme: theme === 'light' ? 'dark' : 'light' } })}
        title={theme === 'light' ? '切换暗色主题' : '切换亮色主题'} aria-label="切换主题">
        <BkIcon d={theme === 'light' ? BI.moon : BI.sun} />
      </button>
    </header>
  );
}

export function StatusBar() {
  const app = useStudio();
  const { doc, sel } = app;
  const selText = sel.kind && sel.id
    ? `已选中 ${sel.kind === 'state' ? '状态' : sel.kind === 'transition' ? '转移' : sel.kind === 'flow' ? '流程节点' : '白板元素'}`
    : '点击选中元素 · 悬停状态右缘拖出连线 · Delete 删除';
  return (
    <footer className="flex items-center gap-3 px-3 h-[30px] flex-none text-[11px]"
      style={{ background: 'var(--panel)', borderTop: '1px solid var(--border)', color: 'var(--muted)' }}>
      <span className="font-semibold" style={{ color: 'var(--text)' }}>
        {doc.states.filter((s) => s.kind !== 'start').length} 状态 · {doc.transitions.length} 转移 · {doc.flowNodes.length} 流程 · {doc.wbShapes.length} 白板
      </span>
      <span className="truncate">{selText}</span>
      <div className="flex-1" />
      <span>工程自动保存在本地浏览器</span>
    </footer>
  );
}

export function Toasts() {
  const { toasts } = useStudio();
  return (
    <div className="fixed bottom-9 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 z-[100] pointer-events-none">
      {toasts.map((t) => (
        <div key={t.id} className="toast px-4 py-2 text-[12.5px] font-semibold"
          style={{
            background: t.type === 'err' ? '#e11d48' : 'var(--text)',
            color: t.type === 'err' ? '#fff' : 'var(--panel)',
            borderRadius: 999, boxShadow: 'var(--shadow)',
          }}>
          {t.msg}
        </div>
      ))}
    </div>
  );
}
