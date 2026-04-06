import { useState, useEffect, useCallback } from 'react';
import { Dashboard } from './components/Dashboard';
import { DataSourceSelector } from './components/DataSourceSelector';
import { EntityExplorer } from './components/EntityExplorer';
import { SourceMap } from './components/SourceMap';
import { SqlConsole } from './components/SqlConsole';
import { About } from './components/About';
import { onStatusChange, type DuckDBStatus } from './lib/duckdb';

type Tab = 'dashboard' | 'sources' | 'explorer' | 'sql' | 'about';

export function App() {
  const [activeTab, setActiveTab] = useState<Tab>('explorer');
  const [dbStatus, setDbStatus] = useState<DuckDBStatus>('idle');
  const [dbDetail, setDbDetail] = useState<string>();
  const [sourceKey, setSourceKey] = useState(0);

  useEffect(() => {
    return onStatusChange((status, detail) => {
      setDbStatus(status);
      setDbDetail(detail);
    });
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
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`panel-${tab.id}`}
              tabIndex={activeTab === tab.id ? 0 : -1}
              className={activeTab === tab.id ? 'active' : ''}
              onClick={() => setActiveTab(tab.id)}
              onKeyDown={(e) => {
                const next = e.key === 'ArrowRight' ? (i + 1) % tabs.length
                  : e.key === 'ArrowLeft' ? (i - 1 + tabs.length) % tabs.length
                  : -1;
                if (next >= 0) {
                  setActiveTab(tabs[next].id);
                  (e.currentTarget.parentElement?.children[next] as HTMLElement)?.focus();
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
      <main className="app-content" role="tabpanel" id={`panel-${activeTab}`}>
        {activeTab === 'dashboard' && <Dashboard key={`dash-${sourceKey}`} />}
        {activeTab === 'sources' && <SourceMap />}
        {activeTab === 'explorer' && <EntityExplorer key={`exp-${sourceKey}`} />}
        {activeTab === 'sql' && <SqlConsole key={`sql-${sourceKey}`} />}
        {activeTab === 'about' && <About />}
      </main>
    </div>
  );
}
