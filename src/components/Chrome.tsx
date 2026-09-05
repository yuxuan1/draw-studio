/* ============================================================
 * Chrome —— 顶栏（撤销/重做 · 主题切换 · 导出）+ 页面页签 + 状态栏 + Toast
 * ============================================================ */
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useStudio } from '../store';
import { svgToPng, downloadBlob } from '../lib/boardkit';

const sv = (d: string, s = 16) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);
const Ic = {
  undo: sv('M8 5 3 10l5 5M3 10h11a6 6 0 0 1 6 6v1'),
  redo: sv('m16 5 5 5-5 5M21 10H10a6 6 0 0 0-6 6v1'),
  sun: sv('M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0-5v2m0 14v2M3 12h2m14 0h2M5.6 5.6l1.4 1.4m10 10 1.4 1.4m0-12.8L17 7M7 17l-1.4 1.4'),
  moon: sv('M20 13.5A8 8 0 0 1 10.5 4 8 8 0 1 0 20 13.5Z'),
  download: sv('M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2'),
  chevD: sv('m6 9 6 6 6-6', 14),
  plus: sv('M12 5v14M5 12h14'),
  x: sv('M6 6l12 12M18 6 6 18', 13),
  canvas: sv('M5 4h6v5H5zM13 15h6v5h-6zM13 4h6v5h-6zM8 9v3.5a2 2 0 0 0 2 2h6'),
  board: sv('M4 5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5Zm4 10-2.5 3h13L15 13.5 12.5 16 10 13l-2 2Z'),
};

function Drop({ label, children, width = 190 }: { label: ReactNode; children: (close: () => void) => ReactNode; width?: number }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', h);
    return () => window.removeEventListener('mousedown', h);
  }, []);
  return (
    <div className="relative" ref={ref}>
      <button className="btn !gap-1 !py-1" onClick={() => setOpen((v) => !v)}
        style={open ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}>
        {label}{Ic.chevD}
      </button>
      {open && <div className="menu-panel left-0 top-[34px]" style={{ width }}>{children(() => setOpen(false))}</div>}
    </div>
  );
}

/* ================= 顶栏 ================= */
export function TopBar() {
  const app = useStudio();
  const { doc, theme, setTheme } = app;
  const st = doc.settings;

  const doExport = async (format: 'png' | 'svg', scale: number, close: () => void) => {
    close();
    const h = app.exportHandle.current;
    if (!h) { app.toast('画布尚未就绪', 'err'); return; }
    const out = h(format === 'png' ? 'white' : 'theme');
    if (!out) { app.toast('导出失败：画布为空', 'err'); return; }
    const base = (app.page.name || app.doc.name).replace(/[\\/:*?"<>|]/g, '_');
    if (format === 'svg') {
      downloadBlob(new Blob([out.svg], { type: 'image/svg+xml' }), `${base}.svg`);
    } else {
      const png = await svgToPng(out.svg, scale);
      downloadBlob(png, `${base}@${scale}x.png`);
    }
    app.toast(`已导出 ${format.toUpperCase()}`);
  };

  return (
    <div className="flex items-center gap-2 px-3 h-[46px] flex-none" style={{ background: 'var(--panel)', borderBottom: '1px solid var(--border)' }}>
      <div className="flex items-center gap-2 mr-1">
        <span className="w-6 h-6 rounded-md flex items-center justify-center font-display font-bold text-[13px]"
          style={{ background: 'var(--accent)', color: '#fff' }}>S</span>
        <span className="font-display font-bold text-[14px] tracking-tight" style={{ color: 'var(--text)' }}>StateFlow Studio</span>
      </div>
      <input className="field-input !h-[28px] !text-[12px] w-[150px]" value={doc.name}
        onChange={(e) => app.set({ ...doc, name: e.target.value }, false)} aria-label="工程名" />

      <div className="flex items-center gap-0.5 ml-1">
        <button className="icon-btn" onClick={app.undo} disabled={!app.canUndo} title="撤销 (Ctrl/⌘+Z)" aria-label="撤销">{Ic.undo}</button>
        <button className="icon-btn" onClick={app.redo} disabled={!app.canRedo} title="重做 (Ctrl/⌘+Shift+Z)" aria-label="重做">{Ic.redo}</button>
      </div>

      <div className="flex-1" />

      <Drop label="导出" width={200}>
        {(close) => (
          <>
            <button className="menu-item" onClick={() => doExport('png', 2, close)}>{Ic.download} PNG 图片（2×）</button>
            <button className="menu-item" onClick={() => doExport('png', 4, close)}>{Ic.download} PNG 图片（4×）</button>
            <button className="menu-item" onClick={() => doExport('svg', 1, close)}>{Ic.download} SVG 矢量</button>
          </>
        )}
      </Drop>

      <button
        className="icon-btn"
        onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
        title={theme === 'light' ? '切换暗色主题' : '切换亮色主题'} aria-label="切换主题"
        style={{ color: theme === 'dark' ? 'var(--warn)' : 'var(--accent)' }}>
        {theme === 'light' ? Ic.moon : Ic.sun}
      </button>
    </div>
  );
}

/* ================= 页面页签 ================= */
export function PageTabs() {
  const app = useStudio();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  return (
    <div className="flex items-end gap-1 px-3 pt-1.5 flex-none overflow-x-auto" style={{ background: 'var(--panel)', borderBottom: '1px solid var(--border)' }}>
      {app.doc.pages.map((p) => {
        const active = p.id === app.doc.activePageId;
        return (
          <div key={p.id}
            className="group flex items-center gap-1.5 pl-3 pr-1.5 h-[30px] rounded-t-lg text-[11.5px] font-semibold cursor-pointer select-none transition-colors"
            style={{
              background: active ? 'var(--app-bg)' : 'transparent',
              color: active ? 'var(--accent)' : 'var(--muted)',
              border: '1px solid ' + (active ? 'var(--border)' : 'transparent'),
              borderBottom: active ? '1px solid var(--app-bg)' : 'none',
              marginBottom: active ? -1 : 0,
            }}
            onClick={() => app.setActivePage(p.id)}
            onDoubleClick={() => { setEditing(p.id); setDraft(p.name); }}
            title="点击切换 · 双击重命名">
            <span style={{ display: 'inline-flex' }}>{p.type === 'canvas' ? Ic.canvas : Ic.board}</span>
            {editing === p.id ? (
              <input autoFocus className="w-[80px] bg-transparent focus:outline-none font-bold"
                style={{ color: 'var(--text)', borderBottom: '1px solid var(--accent)' }}
                value={draft} onChange={(e) => setDraft(e.target.value)}
                onBlur={() => { app.renamePageSafe(p.id, draft); setEditing(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { app.renamePageSafe(p.id, draft); setEditing(null); } if (e.key === 'Escape') setEditing(null); }}
                onClick={(e) => e.stopPropagation()} />
            ) : (
              <span>{p.name}</span>
            )}
            <span className="text-[9px] font-bold px-1 rounded" style={{ background: 'var(--panel)', color: 'var(--muted)' }}>
              {p.type === 'canvas' ? '画布' : '白板'}
            </span>
            {app.doc.pages.length > 1 && (
              <button className="opacity-0 group-hover:opacity-100 w-4 h-4 rounded flex items-center justify-center transition-opacity hover:bg-[var(--border)]"
                style={{ color: 'var(--muted)' }} title="删除页面"
                onClick={(e) => { e.stopPropagation(); app.deletePage(p.id); }}>{Ic.x}</button>
            )}
          </div>
        );
      })}
      <button className="icon-btn !w-6 !h-6 mb-0.5" title="新建页面" aria-label="新建页面" onClick={() => app.addPage('canvas')}
        style={{ color: 'var(--muted)' }}>{Ic.plus}</button>
    </div>
  );
}

/* ================= 右下角新建页面 ================= */
export function NewPageFab() {
  const app = useStudio();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', h);
    return () => window.removeEventListener('mousedown', h);
  }, []);
  return (
    <div className="absolute right-3 bottom-[150px] z-20" ref={ref}>
      {open && (
        <div className="absolute bottom-[46px] right-0 w-[220px] rounded-xl overflow-hidden"
          style={{ background: 'var(--panel-2)', border: '1px solid var(--border)', boxShadow: 'var(--shadow)' }}>
          <div className="px-3 py-2 text-[10.5px] font-bold" style={{ color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>选择新页面类型</div>
          <button className="w-full flex items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-[var(--accent-soft)]"
            onClick={() => { app.addPage('canvas'); setOpen(false); }}>
            <span style={{ color: 'var(--accent)' }}>{Ic.canvas}</span>
            <span><span className="block text-[12px] font-bold" style={{ color: 'var(--text)' }}>画布页</span>
              <span className="block text-[10.5px] leading-4" style={{ color: 'var(--muted)' }}>状态机 + 流程图（含子流程）</span></span>
          </button>
          <button className="w-full flex items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-[var(--accent-soft)]"
            onClick={() => { app.addPage('whiteboard'); setOpen(false); }}>
            <span style={{ color: '#f59e0b' }}>{Ic.board}</span>
            <span><span className="block text-[12px] font-bold" style={{ color: 'var(--text)' }}>白板页</span>
              <span className="block text-[10.5px] leading-4" style={{ color: 'var(--muted)' }}>插入图片作底图，叠加形状标注</span></span>
          </button>
        </div>
      )}
      <button className="w-10 h-10 rounded-full flex items-center justify-center transition-transform hover:scale-105 active:scale-95"
        style={{ background: 'var(--accent)', color: '#fff', boxShadow: '0 4px 14px color-mix(in srgb, var(--accent) 45%, transparent)' }}
        title="新建页面" aria-label="新建页面" onClick={() => setOpen((v) => !v)}>
        <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
      </button>
    </div>
  );
}

/* ================= 状态栏 ================= */
export function StatusBar() {
  const app = useStudio();
  const { page, sel, savedAt } = app;
  const counts = page.type === 'canvas'
    ? `${page.states.length} 个状态 · ${page.transitions.length} 条转移 · ${page.flowNodes.length} 个流程结点`
    : `${page.wbShapes.length} 个白板元素`;
  const selText = sel.ids.length > 1
    ? `已选中 ${sel.ids.length} 个元素`
    : sel.id
      ? `已选中 1 个${sel.kind === 'state' ? '状态' : sel.kind === 'transition' ? '转移' : sel.kind === 'flow' ? '流程结点' : sel.kind === 'wb' ? '白板元素' : '元素'}`
      : page.type === 'canvas'
        ? '双击空白新建状态 · 悬停元素拖出圆点连线 · 双击子流程展开'
        : '左侧插入图片 · 拖拽绘制形状 · 双击空白添加文字';
  return (
    <div className="flex items-center gap-3 px-3 h-[26px] flex-none text-[10.5px]" style={{ background: 'var(--panel)', borderTop: '1px solid var(--border)', color: 'var(--muted)' }}>
      <span className="font-semibold">{counts}</span>
      <span className="flex-1 truncate">{selText}</span>
      {savedAt > 0 && <span className="flex items-center gap-1" title="工程自动保存在本地浏览器中"><span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--accent)' }} />已自动保存</span>}
    </div>
  );
}

/* ================= Toast ================= */
export function Toasts() {
  const { toasts } = useStudio();
  return (
    <div className="absolute bottom-[36px] left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 items-center pointer-events-none">
      {toasts.map((t) => (
        <div key={t.id} className="toast px-4 py-2 rounded-lg text-[12px] font-semibold"
          style={{ color: t.type === 'err' ? 'var(--danger)' : 'var(--text)' }}>
          {t.msg}
        </div>
      ))}
    </div>
  );
}
