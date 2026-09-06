/* ============================================================
 * App —— FlowForge 外壳：ScopeProvider + 顶栏 + 页面页签 + 三栏 + Toast
 * ============================================================ */
import { useEffect, useState } from 'react';
import { ScopeProvider, useScope } from './store/scopeStore';
import ScopeCanvas from './components/ScopeCanvas';
import { LeftPanel, Inspector } from './components/ScopePanels';
import { THEME, SHAPE_COLORS } from './lib/core';
import { NODE_DEFAULTS, NODE_TYPE_LABEL } from './lib/domain';
import type { NodeType } from './lib/domain';

export default function App() {
  return (
    <ScopeProvider>
      <Shell />
    </ScopeProvider>
  );
}

function Shell() {
  const app = useScope();
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);

  /* 全局快捷键（输入框聚焦时不触发） */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) app.redo(); else app.undo(); }
      else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); app.redo(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); app.deleteSel(); }
      else if (e.key === 'f' || e.key === 'F') { e.preventDefault(); app.requestFit(); }
      else if (e.key === 'p' || e.key === 'P') { e.preventDefault(); app.palette.open ? app.closePalette() : app.openPalette(); }
      else if (e.key === 'Escape') {
        if (app.palette.open) app.closePalette();
        app.setSel({ kind: null }); app.setPreviewNodeId(null);
      }
      else if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); app.back(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [app]);

  const th = THEME[app.theme];

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden" style={{ background: 'var(--app-bg)', color: 'var(--text)' }}>
      <TopBar />
      <PageTabs />
      <div className="flex-1 flex min-h-0">
        <LeftPanel open={leftOpen} onToggle={() => setLeftOpen((v) => !v)} />
        <ScopeCanvas />
        {app.mode === 'edit' && <Inspector open={rightOpen} onToggle={() => setRightOpen((v) => !v)} />}
      </div>
      <StatusBar />
      <NodePalette />
      {/* Toast */}
      <div className="fixed bottom-12 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2 pointer-events-none">
        {app.toasts.map((t) => (
          <div key={t.id} className="toast px-4 py-2 rounded-lg text-[12px] font-semibold"
            style={{
              background: t.type === 'err' ? '#e11d48' : 'var(--panel)',
              color: t.type === 'err' ? '#fff' : 'var(--text)',
              border: t.type === 'err' ? 'none' : '1px solid var(--border)',
              boxShadow: 'var(--shadow)',
            }}>{t.msg}</div>
        ))}
      </div>
      <span className="hidden">{th.sel}</span>
    </div>
  );
}

function TopBar() {
  const app = useScope();
  return (
    <div className="flex items-center gap-2 px-3 h-[46px] flex-none" style={{ background: 'var(--panel)', borderBottom: '1px solid var(--border)' }}>
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-md flex items-center justify-center" style={{ background: 'var(--accent)' }}>
          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 5h6v5H4zM14 14h6v5h-6zM10 7.5h4a3 3 0 0 1 3 3V14M7 10v4a3 3 0 0 0 3 3h4" />
          </svg>
        </div>
        <div className="leading-tight">
          <div className="text-[13px] font-extrabold tracking-tight" style={{ color: 'var(--text)' }}>{app.project.name}</div>
          <div className="text-[9px] font-semibold tracking-widest" style={{ color: 'var(--muted)' }}>FLOWFORGE · 流程设计</div>
        </div>
      </div>
      <div className="flex-1" />
      <button className="icon-btn" onClick={app.undo} disabled={!app.canUndo} title="撤销 (Ctrl+Z)" aria-label="撤销">
        <Svg d="M8 5 3 10l5 5M3 10h11a6 6 0 0 1 6 6v1" />
      </button>
      <button className="icon-btn" onClick={app.redo} disabled={!app.canRedo} title="重做 (Ctrl+Shift+Z)" aria-label="重做">
        <Svg d="m16 5 5 5-5 5M21 10H10a6 6 0 0 0-6 6v1" />
      </button>
      <div className="w-px h-5 mx-1" style={{ background: 'var(--border)' }} />
      <button className={`icon-btn ${app.mode === 'read' ? 'on' : ''}`} onClick={app.toggleMode}
        title={app.mode === 'read' ? '当前阅读模式 · 点击切换到编辑模式' : '当前编辑模式 · 点击切换到阅读模式'} aria-label="切换阅读/编辑模式">
        {app.mode === 'read'
          ? <Svg d="M12 5c-5 0-8.5 4.5-9.8 7 1.3 2.5 4.8 7 9.8 7s8.5-4.5 9.8-7C20.5 9.5 17 5 12 5Zm0 10a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z" />
          : <Svg d="M17 3l4 4L8 20l-5 1 1-5L17 3z" />}
      </button>
      <button className="icon-btn" onClick={app.autoLayout} title="自动布局" aria-label="自动布局" disabled={app.mode === 'read'}>
        <Svg d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />
      </button>
      <button className={`icon-btn ${app.theme === 'dark' ? 'on' : ''}`}
        onClick={() => app.setTheme(app.theme === 'light' ? 'dark' : 'light')}
        title={app.theme === 'light' ? '切换暗色主题' : '切换亮色主题'} aria-label="切换主题">
        {app.theme === 'light'
          ? <Svg d="M20 13.5A8 8 0 0 1 10.5 4 8 8 0 1 0 20 13.5Z" />
          : <Svg d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0-5v2m0 14v2M3 12h2m14 0h2M5.6 5.6l1.4 1.4m10 10 1.4 1.4m0-12.8L17 7M7 17l-1.4 1.4" />}
      </button>
    </div>
  );
}

function PageTabs() {
  const app = useScope();
  return (
    <div className="flex items-end gap-1 px-3 pt-1.5 flex-none overflow-x-auto" style={{ background: 'var(--panel)', borderBottom: '1px solid var(--border)' }}>
      {app.project.pages.map((p) => {
        const active = p.id === app.scope.pageId;
        return (
          <button key={p.id} onClick={() => app.gotoPage(p.id)}
            className="px-3.5 py-1.5 rounded-t-lg text-[12px] font-bold transition-colors whitespace-nowrap"
            style={{
              background: active ? 'var(--app-bg)' : 'transparent',
              color: active ? 'var(--accent)' : 'var(--muted)',
              border: active ? '1px solid var(--border)' : '1px solid transparent',
              borderBottom: active ? '1px solid var(--app-bg)' : '1px solid transparent',
              marginBottom: -1,
            }}>
            {p.type === 'flow' ? '▦ ' : '◉ '}{p.name}
          </button>
        );
      })}
      <button onClick={app.addPage} className="px-2.5 py-1.5 rounded-t-lg text-[13px] font-bold transition-colors hover:text-[var(--accent)]"
        style={{ color: 'var(--muted)' }} title="新建页面" aria-label="新建页面">＋</button>
    </div>
  );
}

function StatusBar() {
  const app = useScope();
  const proc = app.currentProcess;
  const selCount = app.sel.kind === 'node' ? app.sel.ids.length : app.sel.kind === 'edge' ? 1 : 0;
  return (
    <div className="flex items-center gap-3 px-3 h-[26px] flex-none text-[10.5px]" style={{ background: 'var(--panel)', borderTop: '1px solid var(--border)', color: 'var(--muted)' }}>
      <span className="font-semibold">{proc ? `${proc.nodes.length} 节点 · ${proc.edges.length} 连线` : '—'}</span>
      <span>·</span>
      <span>{selCount ? `已选中 ${selCount} 项` : '按 P 插入节点 · 双击「调用」进入子流程'}</span>
      <div className="flex-1" />
      {app.savedAt > 0 && <span className="save-pulse">已自动保存到本地</span>}
      <span style={{ color: app.mode === 'read' ? 'var(--accent)' : 'var(--muted)' }}>{app.mode === 'read' ? '阅读模式' : '编辑模式'}</span>
      <span>当前作用域：{proc?.name ?? '—'}</span>
    </div>
  );
}

function Svg({ d }: { d: string }) {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

/* ---------- P 键形状选择面板 ---------- */
const PALETTE_ORDER: NodeType[] = ['start', 'end', 'action', 'decision', 'loop', 'parallel', 'join', 'wait', 'return', 'call', 'reference', 'comment'];

function NodePalette() {
  const app = useScope();
  const { palette } = app;
  if (!palette.open || app.mode !== 'edit') return null;
  const th = THEME[app.theme];

  const place = (t: NodeType) => { app.placeNode(t); };
  const swatch = (t: NodeType) => {
    const c = NODE_DEFAULTS[t].color;
    return <span className="inline-block w-3 h-3 rounded-sm flex-none" style={{ background: SHAPE_COLORS[c][app.theme].fill, border: `1.5px solid ${SHAPE_COLORS[c][app.theme].stroke}` }} />;
  };

  return (
    <>
      {/* 点击外部关闭 */}
      <div className="fixed inset-0 z-40" onClick={app.closePalette} />
      <div className="fixed z-50 rounded-xl overflow-hidden"
        style={{
          left: palette.x, top: palette.y, width: 232,
          background: 'var(--panel)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-pop, 0 12px 32px rgba(0,0,0,.25))',
          animation: 'pop .16s ease',
        }}>
        <div className="flex items-center justify-between px-3 py-2" style={{ background: 'var(--panel-2)', borderBottom: '1px solid var(--border)' }}>
          <span className="text-[11px] font-bold tracking-wide" style={{ color: 'var(--muted)' }}>
            {palette.step === 'call' ? '选择目标子流程' : palette.step === 'reference' ? '选择引用函数' : '插入节点（P）'}
          </span>
          {palette.step ? (
            <button onClick={() => app.setPaletteStep(null)} className="text-[10.5px] font-bold px-1.5 py-0.5 rounded hover:bg-[var(--panel)]" style={{ color: 'var(--accent)' }}>← 返回</button>
          ) : (
            <button onClick={app.closePalette} className="text-[13px] leading-none px-1" style={{ color: 'var(--muted)' }} aria-label="关闭">✕</button>
          )}
        </div>

        {palette.step === null && (
          <div className="max-h-[340px] overflow-y-auto p-1.5">
            {PALETTE_ORDER.map((t) => (
              <button key={t}
                onClick={() => (t === 'call' ? app.setPaletteStep('call') : t === 'reference' ? app.setPaletteStep('reference') : place(t))}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors hover:bg-[var(--panel-2)]">
                {swatch(t)}
                <span className="text-[12px] font-semibold flex-1" style={{ color: 'var(--text)' }}>{NODE_TYPE_LABEL[t]}</span>
                {(t === 'call' || t === 'reference') && <span className="text-[11px]" style={{ color: 'var(--muted)' }}>›</span>}
              </button>
            ))}
          </div>
        )}

        {palette.step === 'call' && (
          <div className="max-h-[340px] overflow-y-auto p-1.5">
            {app.project.processes.filter((p) => p.id !== app.scope.processId).map((p) => (
              <button key={p.id} onClick={() => app.placeNode('call', { targetProcessId: p.id })}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors hover:bg-[var(--panel-2)]">
                <Svg d="M4 6h16v4H4zM4 14h16v4H4z" />
                <span className="text-[12px] font-semibold truncate" style={{ color: 'var(--text)' }}>{p.name}</span>
              </button>
            ))}
            {app.project.processes.length <= 1 && <div className="px-2 py-2 text-[11px]" style={{ color: 'var(--muted)' }}>暂无其它流程可调用</div>}
          </div>
        )}

        {palette.step === 'reference' && (
          <div className="max-h-[340px] overflow-y-auto p-1.5">
            {app.project.functions.map((f) => (
              <button key={f.id}
                onClick={() => app.placeNode('reference', { functionId: f.id })}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors hover:bg-[var(--panel-2)]">
                <Svg d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
                <span className="text-[12px] font-semibold truncate flex-1" style={{ color: 'var(--text)' }}>{f.name}</span>
                <span className="text-[10px]" style={{ color: 'var(--muted)' }}>{f.type === 'shared' ? '公共' : f.type}</span>
              </button>
            ))}
            {app.project.functions.length === 0 && <div className="px-2 py-2 text-[11px]" style={{ color: 'var(--muted)' }}>尚无函数，可在左侧「共同调用库」创建</div>}
          </div>
        )}
      </div>
    </>
  );
}
