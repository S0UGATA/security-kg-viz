import { useMemo } from 'react';
import { GraphView } from './GraphView';
import { buildSourceGraph, type SourceStats, type CrossSourceLink, type SourceDetail } from '../lib/graph-builder';
import { SOURCE_LABELS } from '../lib/constants';
import { q, fetchPrecomputedStats } from '../lib/queries';
import { useQuery } from '../lib/useQuery';

export function SourceMap() {
  // Same precomputed-then-live pattern as Dashboard. Live queries gated on
  // the precomputed miss so we don't double-fetch.
  const precomputed = useQuery(fetchPrecomputedStats, []);
  const useLive = !precomputed.loading && precomputed.data == null;

  const sourcesQ = useQuery(q.countBySource, [], { enabled: useLive });
  const cross = useQuery(
    () => q.crossSourceLinks({ limit: 50, includePredicate: true }),
    [],
    { enabled: useLive },
  );

  const error = precomputed.error ?? sourcesQ.error ?? cross.error;
  const loading = precomputed.loading
    || (useLive && (sourcesQ.loading || cross.loading));

  const resolved = useMemo<
    { bySource: SourceStats[]; crossSourceLinks: CrossSourceLink[]; sourceDetails?: Record<string, SourceDetail> } | null
  >(() => {
    if (precomputed.data?.bySource && precomputed.data?.crossSourceLinks) {
      return {
        bySource: precomputed.data.bySource,
        crossSourceLinks: precomputed.data.crossSourceLinks,
        sourceDetails: precomputed.data.sourceDetails,
      };
    }
    if (sourcesQ.data && cross.data) {
      return { bySource: sourcesQ.data, crossSourceLinks: cross.data };
    }
    return null;
  }, [precomputed.data, sourcesQ.data, cross.data]);

  if (loading && !resolved) {
    return <div className="loading">Loading source map...</div>;
  }

  if (error) {
    return (
      <div className="source-map">
        <div className="error-message">{error}</div>
      </div>
    );
  }

  if (!resolved) return null;

  const data = buildSourceGraph(resolved.bySource, resolved.crossSourceLinks, resolved.sourceDetails);

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
