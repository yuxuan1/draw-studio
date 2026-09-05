import { useEffect } from 'react';
import { AppProvider, useApp } from './store';
import { TopBar, StatusBar, ExportModal, HelpModal, Toasts } from './components/Chrome';
import { LeftPanel, Inspector } from './components/Panels';
import { Canvas } from './components/Canvas';

function Shell() {
  const app = useApp();
  const theme = app.doc.settings.theme;

  /* 主题应用到 <html> */
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  /* 全局快捷键（输入框聚焦时不触发，FR-9.6 / FR-5.4/5.5） */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
  }, [app]);

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--app-bg)' }}>
      <TopBar />
      <div className="flex-1 flex min-h-0">
        <LeftPanel />
        <Canvas />
        <Inspector />
      </div>
      <StatusBar />

      {app.modal === 'export' && <ExportModal />}
      {app.modal === 'help' && <HelpModal />}
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
