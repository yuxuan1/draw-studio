import { StudioProvider } from './studioStore';
import { TopBar, PageTabs, NewPageFab, StatusBar, Toasts } from './components/UnifiedChrome';
import { LeftPanel, Inspector } from './components/UnifiedPanels';
import { UnifiedCanvas } from './components/UnifiedCanvas';

function Shell() {
  return (
    <div className="h-full flex flex-col relative" style={{ background: 'var(--app-bg)' }}>
      <TopBar />
      <PageTabs />
      <div className="flex-1 flex min-h-0">
        <LeftPanel />
        <div className="relative flex-1 flex min-w-0">
          <UnifiedCanvas />
          <NewPageFab />
        </div>
        <Inspector />
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
