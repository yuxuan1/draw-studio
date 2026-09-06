import { useState } from 'react';
import { StudioProvider, useStudio } from './store';
import { TopBar, PageTabs, NewPageFab, StatusBar, Toasts } from './components/Chrome';
import { LeftPanel, Inspector } from './components/Panels';
import { Canvas } from './components/Canvas';

function Shell() {
  const app = useStudio();
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  return (
    <div className="h-full flex flex-col relative" style={{ background: 'var(--app-bg)' }}>
      <TopBar />
      <PageTabs />
      <div className="flex-1 flex min-h-0">
        <LeftPanel open={leftOpen} onToggle={() => setLeftOpen((v) => !v)} />
        <div className="relative flex-1 flex min-w-0">
          <Canvas />
          <NewPageFab />
        </div>
        <Inspector open={rightOpen} onToggle={() => setRightOpen((v) => !v)} />
      </div>
      <StatusBar />
      <Toasts />
      {/* 主题标识：帮助确认当前主题（调试用，极小） */}
      <span className="hidden">{app.theme}</span>
    </div>
  );
}

export default function App() {
  return (
    <StudioProvider>
      <Shell />
    </StudioProvider>
  );
}
