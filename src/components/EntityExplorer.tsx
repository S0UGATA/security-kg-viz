import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { SearchBar } from './SearchBar';
import { GraphView } from './GraphView';
import { queryEntityMultiHop, type Triple, type TraversalMode } from '../lib/duckdb';
import { buildGraph, type GraphData } from '../lib/graph-builder';
import type { LabelMode } from './GraphView';
import { SOURCE_COLORS, SOURCE_LABELS } from '../lib/constants';

export function EntityExplorer() {
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [triples, setTriples] = useState<Triple[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchedEntity, setSearchedEntity] = useState<string | null>('T1059');
  const [copied, setCopied] = useState(false);
  const [tripleLimit, setTripleLimit] = useState(500);
  const [traversal, setTraversal] = useState<TraversalMode>('bfs');
  const [labelMode, setLabelMode] = useState<LabelMode>('auto');

  const tripleLimitRef = useRef(tripleLimit);
  tripleLimitRef.current = tripleLimit;
  const traversalRef = useRef(traversal);
  traversalRef.current = traversal;
  const searchedEntityRef = useRef(searchedEntity);
  searchedEntityRef.current = searchedEntity;

  const handleSearch = useCallback(async (entityId: string) => {
    setLoading(true);
    setError(null);
    try {
      const results = await queryEntityMultiHop(entityId, 10, tripleLimitRef.current, traversalRef.current);
      setTriples(results);
      setSearchedEntity(entityId);
      if (results.length === 0) {
        setError(`No triples found for "${entityId}"`);
        setGraphData(null);
        return;
      }
      const data = buildGraph(results, entityId);
      setGraphData(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Query failed');
      setGraphData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (searchedEntityRef.current) handleSearch(searchedEntityRef.current);
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
      if (link.label && !preds.has(link.label)) {
        preds.set(link.label, link.color);
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
              value={tripleLimit}
              onChange={(e) => setTripleLimit(Math.max(1, Number(e.target.value) || 500))}
            />
          </label>
          <label className="limit-control">
            <span>Traversal</span>
            <select value={traversal} onChange={(e) => setTraversal(e.target.value as TraversalMode)}>
              <option value="bfs">BFS</option>
              <option value="dfs">DFS</option>
            </select>
          </label>
          <label className="limit-control">
            <span>Labels</span>
            <select value={labelMode} onChange={(e) => setLabelMode(e.target.value as LabelMode)}>
              <option value="auto">Auto</option>
              <option value="all">All</option>
              <option value="none">None</option>
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
        <GraphView data={graphData} onNodeClick={handleNodeClick} labelMode={labelMode} />
        {graphData && searchedEntity && (
          <>
            <div className="triple-count">
              <span
                className="entity-label-copy"
                title="Click to copy"
                onClick={() => {
                  navigator.clipboard.writeText(searchedEntity);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {searchedEntity} {copied ? '(copied!)' : ''}
              </span>
              {' '}&middot; {triples.length} triples &middot; {graphData.nodes.length} nodes &middot; {graphData.links.length} edges
              {triples.length >= tripleLimit && ` (limited to ${tripleLimit})`}
            </div>
            <div className="graph-legend">
              <h4>Sources</h4>
              {activeSources.map((source) => (
                <div key={source} className="legend-item">
                  <span
                    className="legend-dot"
                    style={{ background: SOURCE_COLORS[source] || SOURCE_COLORS.unknown }}
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
