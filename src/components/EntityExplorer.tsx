import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { SearchBar } from './SearchBar';
import { GraphView, type GraphViewHandle } from './GraphView';
import { GraphSettings } from './GraphSettings';
import { ErrorBoundary } from './ErrorBoundary';
import { TripleTable } from './TripleTable';
import { type Triple, type TraversalMode } from '../lib/duckdb';
import { q } from '../lib/queries';
import { buildGraph, type GraphData } from '../lib/graph-builder';
import { useViewOptions } from '../lib/viewOptions';
import { SOURCE_COLORS, SOURCE_LABELS } from '../lib/constants';

export function EntityExplorer() {
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [triples, setTriples] = useState<Triple[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchedEntity, setSearchedEntity] = useState<string | null>('T1059');
  const [copied, setCopied] = useState(false);
  const [tripleLimit, setTripleLimit] = useState(500);
  const [tripleLimitDraft, setTripleLimitDraft] = useState(500);
  const [traversal, setTraversal] = useState<TraversalMode>('bfs');
  const [viewOptions, updateViewOptions] = useViewOptions();
  const [complete, setComplete] = useState(false);
  const [paused, setPaused] = useState(false);
  const graphRef = useRef<GraphViewHandle>(null);

  const tripleLimitRef = useRef(tripleLimit);
  tripleLimitRef.current = tripleLimit;
  const traversalRef = useRef(traversal);
  traversalRef.current = traversal;
  // Keep the latest searched entity in a ref so the traversal-options effect
  // below can re-run a query for it without listing it as a dependency
  // (which would cause a duplicate query on every search / node click,
  // since handleSearch itself updates searchedEntity).
  const searchedEntityRef = useRef(searchedEntity);
  searchedEntityRef.current = searchedEntity;
  const searchGenRef = useRef(0);
  const completeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(completeTimerRef.current), []);

  const handleSearch = useCallback(async (entityId: string) => {
    const gen = ++searchGenRef.current;
    clearTimeout(completeTimerRef.current);
    setLoading(true);
    setError(null);
    setComplete(false);
    setSearchedEntity(entityId);
    setGraphData(null);
    setTriples([]);
    try {
      // Depth 3 covers ~all useful structure for hub entities at limit=500:
      // hops 4-10 only burn round trips that never land in the triple budget.
      const results = await q.entityNeighborhood(
        entityId, 3, tripleLimitRef.current, traversalRef.current,
      );
      if (searchGenRef.current !== gen) return;
      setTriples(results);
      if (results.length === 0) {
        setError(`No triples found for "${entityId}"`);
        setGraphData(null);
        return;
      }
      setGraphData(buildGraph(results, entityId));
      setComplete(true);
      completeTimerRef.current = setTimeout(() => {
        if (searchGenRef.current === gen) setComplete(false);
      }, 2000);
    } catch (e) {
      if (searchGenRef.current !== gen) return;
      setError(e instanceof Error ? e.message : 'Query failed');
      setGraphData(null);
    } finally {
      if (searchGenRef.current === gen) setLoading(false);
    }
  }, []);

  // Re-fetch when traversal options change (and once on mount with the
  // default searchedEntity).
  useEffect(() => {
    const id = searchedEntityRef.current;
    if (id) handleSearch(id);
  }, [tripleLimit, traversal, handleSearch]);

  const handleNodeClick = useCallback((nodeId: string) => {
    handleSearch(nodeId);
  }, [handleSearch]);

  const activeSources = useMemo(() => {
    if (!graphData) return [];
    const sources = new Set<string>();
    for (const node of graphData.nodes) {
      if (node.source) sources.add(node.source);
    }
    return Array.from(sources).sort();
  }, [graphData]);

  const activePredicates = useMemo(() => {
    if (!graphData) return [];
    const preds = new Map<string, string>();
    for (const link of graphData.links) {
      // Group by predicate (not full label with meta) so noisy predicates like
      // rdf:type don't explode into one legend row per meta variant. Skip
      // structural predicates that don't add semantic value.
      if (!link.predicate || link.predicate === 'rdf:type') continue;
      if (!preds.has(link.predicate)) {
        preds.set(link.predicate, link.color);
      }
    }
    return Array.from(preds.entries())
      .map(([label, color]) => ({ label, color }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [graphData]);

  return (
    <div className="entity-explorer">
      <div className="explorer-controls">
        <SearchBar onSearch={handleSearch} disabled={loading} value={searchedEntity ?? ''} />
        <div className="explorer-options">
          <label className="limit-control">
            <span>Limit</span>
            <input
              type="number"
              min={1}
              max={5000}
              value={tripleLimitDraft}
              onChange={(e) => setTripleLimitDraft(Math.max(1, Number(e.target.value) || 500))}
              onBlur={() => setTripleLimit(tripleLimitDraft)}
              onKeyDown={(e) => { if (e.key === 'Enter') setTripleLimit(tripleLimitDraft); }}
            />
          </label>
          <label className="limit-control">
            <span>Traversal</span>
            <select value={traversal} onChange={(e) => setTraversal(e.target.value as TraversalMode)}>
              <option value="bfs">BFS</option>
              <option value="dfs">DFS</option>
            </select>
          </label>
        </div>
      </div>
      {loading && <div className="loading">Querying knowledge graph...</div>}
      {error && <div className="error-message">{error}</div>}
      <div className="graph-container">
        {!graphData && !loading && !error && (
          <div className="graph-empty">
            <h3>Security Knowledge Graph Explorer</h3>
            <p>Search for an entity to visualize its neighborhood in the knowledge graph.</p>
            <p>Click a node to drill down. Drag nodes to rearrange. Scroll to zoom.</p>
          </div>
        )}
        <ErrorBoundary
          fallback={(err, reset) => (
            <div className="graph-fallback">
              <div className="error-message">
                3D renderer crashed ({err.message}). Showing triples as a table.
                {' '}<button type="button" onClick={reset}>Retry</button>
              </div>
              <TripleTable triples={triples} />
            </div>
          )}
        >
          <GraphView
            ref={graphRef}
            data={graphData}
            onNodeClick={handleNodeClick}
            viewOptions={viewOptions}
          />
        </ErrorBoundary>
        {graphData && (
          <GraphSettings
            options={viewOptions}
            onChange={updateViewOptions}
            onFit={() => graphRef.current?.fit()}
            onTogglePause={() => {
              graphRef.current?.togglePause();
              setPaused((p) => !p);
            }}
            paused={paused}
          />
        )}
        {graphData && searchedEntity && (
          <>
            <div className="triple-count">
              <button
                type="button"
                className="entity-label-copy"
                title="Click to copy"
                onClick={async () => {
                  try {
                    if (navigator.clipboard?.writeText) {
                      await navigator.clipboard.writeText(searchedEntity);
                    } else {
                      const ta = document.createElement('textarea');
                      ta.value = searchedEntity;
                      ta.style.position = 'fixed';
                      ta.style.opacity = '0';
                      document.body.appendChild(ta);
                      ta.select();
                      document.execCommand('copy');
                      document.body.removeChild(ta);
                    }
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  } catch {
                    /* clipboard unavailable; ignore */
                  }
                }}
              >
                {searchedEntity} {copied ? '(copied!)' : ''}
              </button>
              {' '}&middot; {triples.length} triples &middot; {graphData.nodes.length} nodes &middot; {graphData.links.length} edges
              {triples.length >= tripleLimit && ` (limited to ${tripleLimit})`}
              {complete && <span className="load-complete"> &#10003;</span>}
            </div>
            <div className="graph-legend">
              <h4>Sources</h4>
              {activeSources.map((source) => (
                <div key={source} className="legend-item">
                  <span
                    className="legend-dot"
                    style={{ background: SOURCE_COLORS[source] || SOURCE_COLORS.literal }}
                  />
                  {SOURCE_LABELS[source] || source}
                </div>
              ))}
              {activePredicates.length > 0 && (
                <>
                  <h4 style={{ marginTop: '0.75rem' }}>Connections</h4>
                  {activePredicates.map((p) => (
                    <div key={p.label} className="legend-item">
                      <span className="legend-line" style={{ background: p.color }} />
                      {p.label}
                    </div>
                  ))}
                </>
              )}
              <div style={{ marginTop: '0.5rem', fontSize: '0.625rem', color: 'var(--text-secondary)' }}>
                Click node = drill down<br />
                Drag node = rearrange<br />
                Scroll = zoom &middot; Drag = orbit
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
