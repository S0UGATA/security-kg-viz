import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { DataSourceSelector } from './components/DataSourceSelector';
import { About } from './components/About';
import { ErrorBoundary } from './components/ErrorBoundary';
import { onStatusChange, getConnection, type DuckDBStatus } from './lib/duckdb';

// Heavy tabs are loaded on demand so the cold-start bundle excludes Three.js,
// 3d-force-graph, and Chart.js. About stays eager (it's tiny and always
// reachable as a docs entry point). Each lazy() call becomes its own chunk;
// the manualChunks config in vite.config.ts keeps the shared 3D / chart libs
// in separate chunks that load alongside the first tab that needs them.
const Dashboard = lazy(() => import('./components/Dashboard').then((m) => ({ default: m.Dashboard })));
const SourceMap = lazy(() => import('./components/SourceMap').then((m) => ({ default: m.SourceMap })));
const EntityExplorer = lazy(() => import('./components/EntityExplorer').then((m) => ({ default: m.EntityExplorer })));
const SqlConsole = lazy(() => import('./components/SqlConsole').then((m) => ({ default: m.SqlConsole })));

function TabLoading() {
  return <div className="loading">Loading...</div>;
}

type Tab = 'dashboard' | 'sources' | 'explorer' | 'sql' | 'about';

export function App() {
  const [activeTab, setActiveTab] = useState<Tab>('explorer');
  const [dbStatus, setDbStatus] = useState<DuckDBStatus>('idle');
  const [dbDetail, setDbDetail] = useState<string>();
  const [sourceKey, setSourceKey] = useState(0);
  const tabButtonsRef = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    return onStatusChange((status, detail) => {
      setDbStatus(status);
      setDbDetail(detail);
    });
  }, []);

  // Prewarm: start DuckDB-WASM download + parquet view creation as soon as
  // the shell mounts, in parallel with the UI render and lazy tab chunk
  // fetches. Without this, the first query in any tab serially waits for
  // ~5MB of WASM + parquet metadata. Errors are swallowed because the same
  // initialise path runs when the first real query lands and will surface
  // the error then.
  useEffect(() => {
    getConnection().catch(() => { /* surfaced via onStatusChange */ });
    // Also start fetching the default tab's chunk now (parallel with WASM
    // download) so React.lazy doesn't add a serial render delay.
    import('./components/EntityExplorer');
  }, []);

  const handleSourceSwitch = useCallback(() => {
    setSourceKey((k) => k + 1);
  }, []);

  const tabs: { id: Tab; label: string }[] = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'sources', label: 'Source Map' },
    { id: 'explorer', label: 'Entity Explorer' },
    { id: 'sql', label: 'SQL Console' },
    { id: 'about', label: 'About' },
  ];

  return (
    <div className="app">
      <header className="app-header">
        <h1>Security Knowledge Graph</h1>
        <nav className="tabs" role="tablist">
          {tabs.map((tab, i) => (
            <button
              key={tab.id}
              ref={(el) => { tabButtonsRef.current[i] = el; }}
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls="app-tabpanel"
              tabIndex={activeTab === tab.id ? 0 : -1}
              className={activeTab === tab.id ? 'active' : ''}
              onClick={() => setActiveTab(tab.id)}
              onKeyDown={(e) => {
                const next = e.key === 'ArrowRight' ? (i + 1) % tabs.length
                  : e.key === 'ArrowLeft' ? (i - 1 + tabs.length) % tabs.length
                  : -1;
                if (next >= 0) {
                  e.preventDefault();
                  setActiveTab(tabs[next].id);
                  tabButtonsRef.current[next]?.focus();
                }
              }}
            >
              {tab.label}
            </button>
          ))}
        </nav>
        <DataSourceSelector onSwitch={handleSourceSwitch} />
        <div className="db-status">
          <span className={`status-dot ${dbStatus}`} />
          <span className="status-text">
            {dbStatus === 'idle' && 'DuckDB: Not started'}
            {dbStatus === 'loading-wasm' && 'Loading WASM...'}
            {dbStatus === 'loading-parquet' && 'Connecting to data...'}
            {dbStatus === 'ready' && 'DuckDB: Ready'}
            {dbStatus === 'error' && `Error: ${dbDetail}`}
          </span>
        </div>
      </header>
      <main className="app-content" role="tabpanel" id="app-tabpanel" aria-labelledby={`tab-${activeTab}`}>
        {activeTab === 'dashboard' && (
          <ErrorBoundary key={`dash-${sourceKey}`}>
            <Suspense fallback={<TabLoading />}><Dashboard /></Suspense>
          </ErrorBoundary>
        )}
        {activeTab === 'sources' && (
          <ErrorBoundary key={`src-${sourceKey}`}>
            <Suspense fallback={<TabLoading />}><SourceMap /></Suspense>
          </ErrorBoundary>
        )}
        {activeTab === 'explorer' && (
          <ErrorBoundary key={`exp-${sourceKey}`}>
            <Suspense fallback={<TabLoading />}><EntityExplorer /></Suspense>
          </ErrorBoundary>
        )}
        {activeTab === 'sql' && (
          <ErrorBoundary key={`sql-${sourceKey}`}>
            <Suspense fallback={<TabLoading />}><SqlConsole /></Suspense>
          </ErrorBoundary>
        )}
        {activeTab === 'about' && <About />}
      </main>
    </div>
  );
}
