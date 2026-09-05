/* ============================================================
 * 顶栏 + 页面页签 + 右下角新建页面 + 状态栏 + 导出/帮助弹窗 + Toast
 * ============================================================ */
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useStudio } from '../studioStore';
import { sanitizeFilename } from '../lib/core';
import { svgToPng, downloadBlob, BkIcon, BI } from '../lib/boardkit';

function sv(d: string, size = 16) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

const Ic = {
  undo: sv('M8 5 3 10l5 5M3 10h11a6 6 0 0 1 6 6v1'),
  redo: sv('m16 5 5 5-5 5M21 10H10a6 6 0 0 0-6 6v1'),
  sun: sv('M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0-5v2m0 14v2M3 12h2m14 0h2M5.6 5.6l1.4 1.4m10 10 1.4 1.4m0-12.8L17 7M7 17l-1.4 1.4'),
  moon: sv('M20 13.5A8 8 0 0 1 10.5 4 8 8 0 1 0 20 13.5Z'),
  download: sv('M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2'),
  copy: sv('M8 8h12v12H8zM4 16V4h12'),
  help: sv('M9 9a3 3 0 1 1 4.6 2.5c-.9.6-1.6 1.2-1.6 2.5m0 3h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z'),
  chevD: sv('m6 9 6 6 6-6', 14),
  plus: sv('M12 5v14M5 12h14'),
  x: sv('M6 6l12 12M18 6 6 18', 13),
  canvas: sv('M5 4h6v5H5zM13 15h6v5h-6zM13 4h6v5h-6zM8 9v3.5a2 2 0 0 0 2 2h6'),
  board: sv('M4 5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5Zm4 10-2.5 3h13L15 13.5 12.5 16 10 13l-2 2Z'),
};

function useClickOutside(onOut: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onOut(); };
    window.addEventListener('mousedown', h);
    return () => window.removeEventListener('mousedown', h);
  }, [onOut]);
  return ref;
}

function Drop({ label, children, width = 190 }: { label: ReactNode; children: (close: () => void) => ReactNode; width?: number }) {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside(() => setOpen(false));
  return (
    <div className="relative" ref={ref}>
      <button className="btn !gap-1 !py-1" onClick={() => setOpen((v) => !v)}
        style={open ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}>
        {label}{Ic.chevD}
      </button>
      {open && (
        <div className="menu-panel absolute right-0 top-[calc(100%+6px)] z-40" style={{ width }} onClick={() => setOpen(false)}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

/* ================= 顶栏 ================= */

export function TopBar() {
  const app = useStudio();
  const st = app.doc.settings;
  const nameRef = useRef<HTMLInputElement>(null);

  const doSave = async (format: 'svg' | 'png', scale: number, close: () => void) => {
    close();
    app.setSel({ kind: null, id: null });
    await new Promise((r) => setTimeout(r, 90));
    const h = app.exportHandle.current;
    if (!h) { app.toast('画布尚未就绪', 'err'); return; }
    const out = h(format === 'png' ? 'white' : 'theme');
    if (!out) { app.toast('导出失败：画布为空', 'err'); return; }
    const base = sanitizeFilename(app.page.name || app.doc.name);
    try {
      if (format === 'svg') {
        downloadBlob(new Blob([out.svg], { type: 'image/svg+xml' }), `${base}.svg`);
      } else {
        const blob = await svgToPng(out.svg, out.w, out.h, scale);
        downloadBlob(blob, `${base}@${scale}x.png`);
      }
      app.toast(`已导出 ${format.toUpperCase()}`);
    } catch {
      app.toast('导出失败，请重试', 'err');
    }
  };

  const doCopy = async (close: () => void) => {
    close();
    app.setSel({ kind: null, id: null });
    await new Promise((r) => setTimeout(r, 90));
    const h = app.exportHandle.current;
    if (!h) return;
    const out = h('white');
    if (!out) { app.toast('画布为空', 'err'); return; }
    try {
      const blob = await svgToPng(out.svg, out.w, out.h, 2);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      app.toast('已复制 2× PNG 到剪贴板');
    } catch {
      app.toast('复制失败，请改用导出', 'err');
    }
  };

  return (
    <div className="flex items-center gap-2 px-3 h-[46px] flex-none"
      style={{ background: 'var(--panel)', borderBottom: '1px solid var(--border)' }}>
      {/* 品牌 */}
      <div className="flex items-center gap-2 mr-1 select-none">
        <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
          <rect x="2" y="10" width="12" height="12" rx="3" fill="var(--accent)" />
          <rect x="18" y="4" width="12" height="10" rx="3" fill="#64748b" />
          <rect x="18" y="18" width="12" height="10" rx="3" fill="#f59e0b" />
          <path d="M14 14 L18 9 M14 18 L18 23" stroke="var(--accent)" strokeWidth="2" />
        </svg>
        <div className="leading-none">
          <div className="text-[13px] font-extrabold tracking-tight" style={{ color: 'var(--text)' }}>StateFlow Studio</div>
          <div className="text-[9px] font-semibold mt-0.5" style={{ color: 'var(--muted)' }}>状态机 · 流程图 · 白板</div>
        </div>
      </div>

      <div className="w-px h-5" style={{ background: 'var(--border)' }} />

      {/* 工程名（内联编辑） */}
      <input
        ref={nameRef}
        className="text-[12.5px] font-bold px-2 py-1 rounded-md w-[150px] focus:outline-none"
        style={{ background: 'transparent', color: 'var(--text)', border: '1px solid transparent' }}
        value={app.doc.name}
        onChange={(e) => app.set({ ...app.doc, name: e.target.value }, false)}
        onBlur={(e) => {
          const v = e.target.value.trim();
          app.set({ ...app.doc, name: v || '未命名工程' });
          e.target.style.border = '1px solid transparent';
        }}
        onFocus={(e) => { e.target.style.border = '1px solid var(--accent)'; e.target.select(); }}
        title="工程名（点击编辑）" aria-label="工程名"
      />

      <div className="flex items-center gap-1">
        <button className="icon-btn" onClick={app.undo} disabled={!app.canUndo} title="撤销 (Ctrl/⌘+Z)" aria-label="撤销">{Ic.undo}</button>
        <button className="icon-btn" onClick={app.redo} disabled={!app.canRedo} title="重做 (Ctrl/⌘+Shift+Z)" aria-label="重做">{Ic.redo}</button>
      </div>

      <div className="flex-1" />

      <button className={`icon-btn ${st.theme === 'light' ? '' : 'on'}`}
        onClick={() => app.set({ ...app.doc, settings: { ...st, theme: st.theme === 'light' ? 'dark' : 'light' } }, false)}
        title={st.theme === 'light' ? '切换暗色主题' : '切换亮色主题'} aria-label="切换主题">
        {st.theme === 'light' ? Ic.moon : Ic.sun}
      </button>

      <Drop label="导出" width={210}>
        {() => (
          <>
            <button className="menu-item" onClick={() => doSave('png', 2, () => {})}>导出 PNG（2×）</button>
            <button className="menu-item" onClick={() => doSave('png', 4, () => {})}>导出 PNG（4× 高清）</button>
            <button className="menu-item" onClick={() => doSave('svg', 1, () => {})}>导出 SVG 矢量</button>
            <div className="menu-sep" />
            <button className="menu-item" onClick={() => doCopy(() => {})}>{Ic.copy} 复制到剪贴板</button>
          </>
        )}
      </Drop>

      <Drop label="帮助" width={300}>
        {(close) => (
          <>
            <button className="menu-item" onClick={() => { close(); }}>
              <span className="font-bold">快捷键</span>
            </button>
            <div className="px-3 pb-2 text-[11px] leading-5" style={{ color: 'var(--muted)' }}>
              <kbd>双击空白</kbd> 新建状态/文字 · <kbd>拖圆点</kbd> 连线<br />
              <kbd>双击子流程</kbd> 展开/收纳 · <kbd>Delete</kbd> 删除选中<br />
              <kbd>Ctrl/⌘+Z</kbd> 撤销 · <kbd>Ctrl/⌘+Shift+Z</kbd> 重做<br />
              <kbd>F</kbd> 适应视图 · <kbd>V</kbd> 选择工具 · <kbd>Esc</kbd> 取消
            </div>
            <div className="menu-sep" />
            <div className="px-3 py-2 text-[11px] leading-5" style={{ color: 'var(--muted)' }}>
              <span className="font-bold" style={{ color: 'var(--text)' }}>关于 StateFlow Studio</span><br />
              三合一可视化建模工具：状态机（Stateflow 风格转移标签）、流程图（可递归展开的子流程）、白板（图片 + 形状叠加）。数据自动保存在本地浏览器，无任何网络请求。
            </div>
          </>
        )}
      </Drop>
    </div>
  );
}

/* ================= 页面页签 ================= */

export function PageTabs() {
  const app = useStudio();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  return (
    <div className="flex items-end gap-1 px-3 pt-1.5 flex-none overflow-x-auto"
      style={{ background: 'var(--panel)', borderBottom: '1px solid var(--border)' }}>
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
            title="点击切换 · 双击重命名"
          >
            {p.type === 'canvas' ? Ic.canvas : Ic.board}
            {editing === p.id ? (
              <input autoFocus className="w-[80px] bg-transparent focus:outline-none font-bold"
                style={{ color: 'var(--text)', borderBottom: '1px solid var(--accent)' }}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => { app.renamePage(p.id, draft); setEditing(null); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { app.renamePage(p.id, draft); setEditing(null); }
                  if (e.key === 'Escape') setEditing(null);
                }}
                onClick={(e) => e.stopPropagation()} />
            ) : (
              <span>{p.name}</span>
            )}
            <span className="text-[9px] font-bold px-1 rounded" style={{ background: 'var(--panel)', color: 'var(--muted)' }}>
              {p.type === 'canvas' ? '画布' : '白板'}
            </span>
            {app.doc.pages.length > 1 && (
              <button
                className="opacity-0 group-hover:opacity-100 w-4 h-4 rounded flex items-center justify-center transition-opacity hover:bg-[var(--border)]"
                style={{ color: 'var(--muted)' }}
                title="删除页面"
                onClick={(e) => { e.stopPropagation(); app.deletePage(p.id); }}
              >{Ic.x}</button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ================= 右下角新建页面 ================= */

export function NewPageFab() {
  const app = useStudio();
  const [open, setOpen] = useState(false);
  const ref = useClickOutside(() => setOpen(false));

  return (
    <div className="absolute right-3 bottom-[60px] z-20" ref={ref}>
      {open && (
        <div className="absolute bottom-[46px] right-0 w-[220px] rounded-xl overflow-hidden"
          style={{ background: 'var(--panel-2)', border: '1px solid var(--border)', boxShadow: 'var(--shadow)' }}>
          <div className="px-3 py-2 text-[10.5px] font-bold" style={{ color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>
            选择新页面类型
          </div>
          <button className="w-full flex items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-[var(--accent-soft)]"
            onClick={() => { app.addPage('canvas'); setOpen(false); }}>
            <span style={{ color: 'var(--accent)' }}>{Ic.canvas}</span>
            <span>
              <span className="block text-[12px] font-bold" style={{ color: 'var(--text)' }}>画布页</span>
              <span className="block text-[10.5px] leading-4" style={{ color: 'var(--muted)' }}>状态机 + 流程图（含子流程），同类型元素自由连线</span>
            </span>
          </button>
          <button className="w-full flex items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-[var(--accent-soft)]"
            onClick={() => { app.addPage('whiteboard'); setOpen(false); }}>
            <span style={{ color: '#f59e0b' }}>{Ic.board}</span>
            <span>
              <span className="block text-[12px] font-bold" style={{ color: 'var(--text)' }}>白板页</span>
              <span className="block text-[10.5px] leading-4" style={{ color: 'var(--muted)' }}>插入图片作底图，叠加矩形/箭头等形状标注</span>
            </span>
          </button>
          <button className="w-full flex items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-[var(--accent-soft)]"
            style={{ borderTop: '1px solid var(--border)' }}
            onClick={() => { app.duplicatePage(app.page.id); setOpen(false); }}>
            <span style={{ color: 'var(--muted)' }}>{Ic.copy}</span>
            <span>
              <span className="block text-[12px] font-bold" style={{ color: 'var(--text)' }}>复制当前页</span>
              <span className="block text-[10.5px] leading-4" style={{ color: 'var(--muted)' }}>以「{app.page.name}」为模板新建一页</span>
            </span>
          </button>
        </div>
      )}
      <button
        className="w-10 h-10 rounded-full flex items-center justify-center transition-transform hover:scale-105 active:scale-95"
        style={{ background: 'var(--accent)', color: '#fff', boxShadow: '0 4px 14px color-mix(in srgb, var(--accent) 45%, transparent)' }}
        title="新建页面" aria-label="新建页面"
        onClick={() => setOpen((v) => !v)}
      >
        <BkIcon d={BI.plus} size={20} sw={2.2} />
      </button>
    </div>
  );
}

/* ================= 状态栏 ================= */

export function StatusBar() {
  const app = useStudio();
  const { page, sel, savedAt } = app;
  const counts = page.type === 'canvas'
    ? `${page.states.length} 状态 · ${page.transitions.length} 转移 · ${page.flowNodes.length} 流程节点 · ${page.flowEdges.length} 连线`
    : `${page.wbShapes.length} 个元素`;
  const selText = sel.kind === 'state' ? '已选中：状态（可编辑；连出的线即状态转移）'
    : sel.kind === 'transition' ? '已选中：状态转移（右侧编辑 event/条件/动作）'
    : sel.kind === 'flow' ? '已选中：流程节点'
    : sel.kind === 'flowEdge' ? '已选中：流程连线（右侧编辑标签）'
    : sel.kind === 'wb' ? '已选中：白板元素'
    : page.type === 'canvas'
      ? '双击空白新建状态 · 悬停元素拖出圆点连线 · 双击子流程展开'
      : '左侧插入图片 · 拖拽绘制形状 · 双击空白添加文字';

  return (
    <div className="flex items-center gap-3 px-3 h-[26px] flex-none text-[10.5px]"
      style={{ background: 'var(--panel)', borderTop: '1px solid var(--border)', color: 'var(--muted)' }}>
      <span className="font-bold flex items-center gap-1" style={{ color: 'var(--text)' }}>
        {page.type === 'canvas' ? Ic.canvas : Ic.board} {page.name}
      </span>
      <span style={{ color: 'var(--border-strong)' }}>|</span>
      <span>{counts}</span>
      <span className="flex-1" />
      <span className="hidden md:inline">{selText}</span>
      <span style={{ color: 'var(--border-strong)' }}>|</span>
      <span className={savedAt ? 'save-pulse' : ''}>
        自动保存在本地浏览器{savedAt ? ` · ${new Date(savedAt).toLocaleTimeString('zh-CN', { hour12: false })}` : ''}
      </span>
    </div>
  );
}

/* ================= Toast ================= */

export function Toasts() {
  const app = useStudio();
  return (
    <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2 pointer-events-none">
      {app.toasts.map((t) => (
        <div key={t.id} className="toast px-4 py-2 rounded-lg text-[12px] font-semibold"
          style={{
            background: t.type === 'err' ? '#ef4444' : t.type === 'info' ? 'var(--panel-2)' : 'var(--accent)',
            color: t.type === 'info' ? 'var(--text)' : '#fff',
            border: t.type === 'info' ? '1px solid var(--border)' : 'none',
            boxShadow: 'var(--shadow)',
          }}>
          {t.msg}
        </div>
      ))}
    </div>
  );
}
