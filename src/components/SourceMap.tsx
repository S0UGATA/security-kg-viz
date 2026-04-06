import { useState, useEffect } from 'react';
import { GraphView } from './GraphView';
import { buildSourceGraph, type SourceStats, type CrossSourceLink, type SourceDetail } from '../lib/graph-builder';
import { SOURCE_LABELS, statsFileUrl } from '../lib/constants';
import { getCurrentParquetUrl, querySQL } from '../lib/duckdb';

export function SourceMap() {
  const [bySource, setBySource] = useState<SourceStats[] | null>(null);
  const [crossSourceLinks, setCrossSourceLinks] = useState<CrossSourceLink[] | null>(null);
  const [sourceDetails, setSourceDetails] = useState<Record<string, SourceDetail> | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        // Try pre-computed stats JSON first
        try {
          const url = statsFileUrl(getCurrentParquetUrl());
          const resp = await fetch(url);
          if (resp.ok) {
            const data = await resp.json();
            if (!cancelled && data.bySource && data.crossSourceLinks) {
              setBySource(data.bySource);
              setCrossSourceLinks(data.crossSourceLinks);
              if (data.sourceDetails) setSourceDetails(data.sourceDetails);
              setLoading(false);
              return;
            }
          }
        } catch {
          // Fall through to live queries
        }
        if (cancelled) return;

        // Fallback: live DuckDB queries using the source column
        const sourceResult = await querySQL(
          `SELECT source, COUNT(*) AS cnt FROM kg GROUP BY source ORDER BY cnt DESC`,
        );
        if (cancelled) return;

        const sources: SourceStats[] = sourceResult.rows.map((row) => ({
          source: String(row[0]),
          count: Number(row[1]),
        }));

        const crossResult = await querySQL(`
          WITH entity_source AS (
            SELECT DISTINCT subject, source FROM kg
          )
          SELECT k.source AS src, es.source AS dst, mode(k.predicate) AS pred, COUNT(*) AS cnt
          FROM kg k
          JOIN entity_source es ON k.object = es.subject
          WHERE k.object_type = 'id' AND k.source != es.source
          GROUP BY k.source, es.source
          ORDER BY cnt DESC
          LIMIT 50
        `);
        if (cancelled) return;

        const links: CrossSourceLink[] = crossResult.rows.map((row) => ({
          from: String(row[0]),
          to: String(row[1]),
          count: Number(row[3]),
          predicate: row[2] ? String(row[2]) : undefined,
        }));

        setBySource(sources);
        setCrossSourceLinks(links);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load source map data');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return <div className="loading">Loading source map...</div>;
  }

  if (error) {
    return (
      <div className="source-map">
        <div className="error-message">{error}</div>
      </div>
    );
  }

  if (!bySource || !crossSourceLinks) return null;

  const data = buildSourceGraph(bySource, crossSourceLinks, sourceDetails);

  const sources = data.nodes
    .map((n) => ({ id: n.id, color: n.color, label: n.label }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const predicates = (() => {
    const preds = new Map<string, string>();
    for (const link of data.links) {
      if (link.label && !preds.has(link.label)) {
        preds.set(link.label, link.color);
      }
    }
    return Array.from(preds.entries())
      .map(([label, color]) => ({ label, color }))
      .sort((a, b) => a.label.localeCompare(b.label));
  })();

  return (
    <div className="source-map">
      <GraphView data={data} labelMode="all" />
      <div className="graph-legend">
        <h4>Data Sources ({sources.length})</h4>
        {sources.map((s) => (
          <div key={s.id} className="legend-item">
            <span className="legend-dot" style={{ background: s.color }} />
            {SOURCE_LABELS[s.id] || s.id}
          </div>
        ))}
        {predicates.length > 0 && (
          <>
            <h4 style={{ marginTop: '0.75rem' }}>Connections</h4>
            {predicates.map((p) => (
              <div key={p.label} className="legend-item">
                <span className="legend-line" style={{ background: p.color }} />
                {p.label}
              </div>
            ))}
          </>
        )}
      </div>
      <div className="triple-count">
        {data.nodes.length} sources &middot; {data.links.length} cross-source relationships
      </div>
    </div>
  );
}
