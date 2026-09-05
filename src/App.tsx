import { useEffect, useState } from 'react';
import { AppProvider, useApp } from './store';
import { TopBar, StatusBar, ExportModal, HelpModal, Toasts } from './components/Chrome';
import { LeftPanel, Inspector } from './components/Panels';
import { Canvas } from './components/Canvas';
import { FlowchartEditor } from './components/FlowchartEditor';
import { WhiteboardEditor } from './components/WhiteboardEditor';
import { BkIcon, BI } from './lib/boardkit';

type Mode = 'state' | 'flow' | 'board';

const MODES: { key: Mode; icon: string; label: string; hint: string }[] = [
  { key: 'state', icon: BI.state, label: '状态机', hint: 'Stateflow 风格状态机设计' },
  { key: 'flow', icon: BI.flow, label: '流程图', hint: 'XMind 式多级收纳流程图' },
  { key: 'board', icon: BI.board, label: '白板', hint: '图片标注与自由形状' },
];

/* 左侧模式导航栏 */
function ModeRail({ mode, setMode }: { mode: Mode; setMode: (m: Mode) => void }) {
  const app = useApp();
  const theme = app.doc.settings.theme;
  return (
    <div className="w-[54px] shrink-0 border-r flex flex-col items-center py-2.5 gap-1.5"
      style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}>
      <div className="w-8 h-8 rounded-lg flex items-center justify-center mb-1 font-black text-[15px]"
        style={{ background: 'var(--accent)', color: '#fff' }} title="StateFlow Studio">S</div>
      {MODES.map((m) => (
        <button key={m.key} onClick={() => setMode(m.key)} title={`${m.label} · ${m.hint}`} aria-label={m.label}
          className="relative w-10 h-10 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-all group"
          style={mode === m.key
            ? { background: 'var(--accent-soft)', color: 'var(--accent)' }
            : { color: 'var(--muted)' }}>
          {mode === m.key && (
            <span className="absolute left-[-7px] top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-full" style={{ background: 'var(--accent)' }} />
          )}
          <BkIcon d={m.icon} size={19} />
          <span className="text-[8.5px] font-semibold leading-none">{m.label}</span>
        </button>
      ))}
      <div className="flex-1" />
      <button className="w-10 h-10 rounded-xl flex items-center justify-center transition-colors"
        style={{ color: 'var(--muted)' }} title={theme === 'light' ? '切换暗色主题' : '切换亮色主题'}
        onClick={() => app.setViewSettings({ theme: theme === 'light' ? 'dark' : 'light' })}>
        <BkIcon d={theme === 'light' ? BI.moon : BI.sun} size={18} />
      </button>
    </div>
  );
}

function Shell() {
  const app = useApp();
  const theme = app.doc.settings.theme;
  const [mode, setMode] = useState<Mode>('state');

  /* 主题应用到 <html> */
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  /* 状态机模式的全局快捷键（输入框聚焦时不触发；其余模式由各自编辑器处理） */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (mode !== 'state') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.closest('input,textarea,select') || t.isContentEditable)) {
        if (e.key === 'Escape') (t as HTMLElement).blur?.();
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();

      if (mod && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) app.redo(); else app.undo();
      } else if (mod && k === 'y') {
        e.preventDefault();
        app.redo();
      } else if (mod && k === 's') {
        e.preventDefault();
        app.saveProjectFile();
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        app.requestFit();
      } else if (e.key === 'l' || e.key === 'L') {
        e.preventDefault();
        app.applyLayout(app.doc.settings.layout);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        const ae = document.activeElement;
        const canvasFocused = !ae || ae === document.body ||
          (ae instanceof HTMLElement && (ae.id === 'canvas-root' || ae.closest('#canvas-root')));
        if (canvasFocused && (app.sel.states.length || app.sel.transitions.length)) {
          e.preventDefault();
          app.deleteSelection();
        }
      } else if (e.key === 'Escape') {
        if (app.modal) app.setModal(null);
        else if (app.renamingId) app.setRenamingId(null);
        else app.setSel({ states: [], transitions: [] });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [app, mode]);

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--app-bg)' }}>
      <div className="flex-1 flex min-h-0">
        <ModeRail mode={mode} setMode={setMode} />
        {mode === 'state' && (
          <div className="flex-1 flex flex-col min-w-0">
            <TopBar />
            <div className="flex-1 flex min-h-0">
              <LeftPanel />
              <Canvas />
              <Inspector />
            </div>
            <StatusBar />
          </div>
        )}
        {mode === 'flow' && <FlowchartEditor />}
        {mode === 'board' && <WhiteboardEditor />}
      </div>

      {mode === 'state' && app.modal === 'export' && <ExportModal />}
      {mode === 'state' && app.modal === 'help' && <HelpModal />}
      <Toasts />
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
