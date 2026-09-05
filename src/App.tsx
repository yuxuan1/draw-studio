import { StudioProvider } from './studioStore';
import { TopBar, StatusBar, Toasts } from './components/UnifiedChrome';
import { LeftPanel, Inspector } from './components/UnifiedPanels';
import { UnifiedCanvas } from './components/UnifiedCanvas';

function Shell() {
  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--app-bg)' }}>
      <TopBar />
      <div className="flex-1 flex min-h-0">
        <LeftPanel />
        <UnifiedCanvas />
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
