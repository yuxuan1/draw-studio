import { useState } from 'react';
import { StudioProvider } from './studioStore';
import { TopBar, PageTabs, NewPageFab, StatusBar, Toasts } from './components/UnifiedChrome';
import { LeftPanel, Inspector } from './components/UnifiedPanels';
import { UnifiedCanvas } from './components/UnifiedCanvas';

function Shell() {
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  return (
    <div className="h-full flex flex-col relative" style={{ background: 'var(--app-bg)' }}>
      <TopBar />
      <PageTabs />
      <div className="flex-1 flex min-h-0">
        <LeftPanel open={leftOpen} onToggle={() => setLeftOpen((v) => !v)} />
        <div className="relative flex-1 flex min-w-0">
          <UnifiedCanvas />
          <NewPageFab />
        </div>
        <Inspector open={rightOpen} onToggle={() => setRightOpen((v) => !v)} />
      </div>
      <StatusBar />
      <Toasts />
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
