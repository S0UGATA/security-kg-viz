import { useMemo } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  LogarithmicScale,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { Bar, Doughnut } from 'react-chartjs-2';
import { q, fetchPrecomputedStats } from '../lib/queries';
import { useQuery } from '../lib/useQuery';
import { SOURCE_COLORS, SOURCE_LABELS } from '../lib/constants';


ChartJS.register(CategoryScale, LinearScale, LogarithmicScale, BarElement, ArcElement, Title, Tooltip, Legend);

interface Stats {
  totalTriples?: number;
  uniqueSubjects?: number;
  uniqueObjects?: number;
  uniquePredicates?: number;
  bySource?: { source: string; count: number }[];
  topPredicates?: { predicate: string; count: number }[];
  topConnectedEntities?: { entity: string; count: number }[];
  crossSourceLinks?: { from: string; to: string; count: number }[];
}

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
  },
  scales: {
    x: {
      ticks: { color: '#8b949e', font: { size: 10 } },
      grid: { color: '#21262d' },
    },
    y: {
      ticks: { color: '#8b949e', font: { size: 10 } },
      grid: { color: '#21262d' },
    },
  },
};

export function Dashboard() {
  // Try the pre-computed stats JSON first; on miss (null), fall back to four
  // live queries in parallel. Each useQuery owns its own race-cancellation.
  const precomputed = useQuery(fetchPrecomputedStats, []);
  const useLive = !precomputed.loading && precomputed.data == null;

  const summary = useQuery(q.summary, [], { enabled: useLive });
  const topPreds = useQuery(() => q.topPredicates(25), [], { enabled: useLive });
  const sources = useQuery(q.countBySource, [], { enabled: useLive });
  const cross = useQuery(() => q.crossSourceLinks({ limit: 15 }), [], { enabled: useLive });
  const topEntities = useQuery(() => q.topConnectedEntities(15), [], { enabled: useLive });

  const stats = useMemo<Stats>(() => {
    if (precomputed.data) return precomputed.data;
    return {
      totalTriples: summary.data?.totalTriples,
      uniqueSubjects: summary.data?.uniqueSubjects,
      uniqueObjects: summary.data?.uniqueObjects,
      uniquePredicates: summary.data?.uniquePredicates,
      topPredicates: topPreds.data ?? undefined,
      bySource: sources.data ?? undefined,
      crossSourceLinks: cross.data ?? undefined,
      topConnectedEntities: topEntities.data ?? undefined,
    };
  }, [precomputed.data, summary.data, topPreds.data, sources.data, cross.data, topEntities.data]);

  const error =
    precomputed.error ?? summary.error ?? topPreds.error
      ?? sources.error ?? cross.error ?? topEntities.error;
  const stillLoading = precomputed.loading
    || (useLive && summary.loading && stats.totalTriples == null);
  const phase3Done = precomputed.data != null
    || (!useLive ? false
        : !summary.loading && !topPreds.loading && !sources.loading
          && !cross.loading && !topEntities.loading);
  const phase = stillLoading ? 0 : (phase3Done ? 3 : 1);

  if (error) {
    return (
      <div className="dashboard">
        <div className="error-message">{error}</div>
      </div>
    );
  }

  if (phase === 0) {
    return <div className="loading">Loading dashboard statistics...</div>;
  }

  const realSources = stats.bySource?.filter((s) => s.source !== 'literal') ?? [];

  return (
    <div className="dashboard">
      <h2>Knowledge Graph Overview</h2>
      <div className="stat-cards">
        <div className="stat-card">
          <div className="label">Total Triples</div>
          <div className="value">{stats.totalTriples?.toLocaleString() ?? '...'}</div>
        </div>
        <div className="stat-card">
          <div className="label">Unique Subjects</div>
          <div className="value">{stats.uniqueSubjects?.toLocaleString() ?? '...'}</div>
        </div>
        <div className="stat-card">
          <div className="label">Unique Objects</div>
          <div className="value">{stats.uniqueObjects?.toLocaleString() ?? '...'}</div>
        </div>
        <div className="stat-card">
          <div className="label">Predicates</div>
          <div className="value">{stats.uniquePredicates?.toLocaleString() ?? '...'}</div>
        </div>
        {realSources.length > 0 && (
          <div className="stat-card">
            <div className="label">Data Sources</div>
            <div className="value">{realSources.length}</div>
          </div>
        )}
      </div>
      <div className="charts-grid">
        {stats.bySource && stats.bySource.length > 0 && (
          <div className="chart-card">
            <h3>Triples by Source</h3>
            <div style={{ height: 450 }}>
              <Bar data={{
                labels: stats.bySource.map((s) => SOURCE_LABELS[s.source] || s.source),
                datasets: [{
                  label: 'Triples',
                  data: stats.bySource.map((s) => s.count),
                  backgroundColor: stats.bySource.map((s) => SOURCE_COLORS[s.source] || SOURCE_COLORS.literal),
                  borderWidth: 0,
                  borderRadius: 3,
                }],
              }} options={{
                ...chartOptions,
                scales: {
                  ...chartOptions.scales,
                  y: { ...chartOptions.scales.y, type: 'logarithmic' as const },
                },
              }} />
            </div>
          </div>
        )}
        {realSources.length > 0 && (
          <div className="chart-card">
            <h3>Source Distribution</h3>
            <div style={{ height: 450 }}>
              <Doughnut
                data={{
                  labels: realSources.map((s) => SOURCE_LABELS[s.source] || s.source),
                  datasets: [{
                    data: realSources.map((s) => s.count),
                    backgroundColor: realSources.map((s) => SOURCE_COLORS[s.source] || SOURCE_COLORS.literal),
                    borderColor: '#161b22',
                    borderWidth: 2,
                  }],
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: {
                      position: 'right' as const,
                      labels: { color: '#8b949e', font: { size: 11 }, padding: 12 },
                    },
                  },
                }}
              />
            </div>
          </div>
        )}
        {stats.topPredicates && stats.topPredicates.length > 0 && (
          <div className="chart-card">
            <h3>Top Predicates</h3>
            <div style={{ height: 450 }}>
              <Bar
                data={{
                  labels: stats.topPredicates.map((p) => p.predicate),
                  datasets: [{
                    label: 'Count',
                    data: stats.topPredicates.map((p) => p.count),
                    backgroundColor: '#58a6ff',
                    borderWidth: 0,
                    borderRadius: 3,
                  }],
                }}
                options={{
                  ...chartOptions,
                  indexAxis: 'y' as const,
                  scales: {
                    ...chartOptions.scales,
                    x: { ...chartOptions.scales.x, type: 'logarithmic' as const },
                  },
                }}
              />
            </div>
          </div>
        )}
        {stats.topConnectedEntities && stats.topConnectedEntities.length > 0 && (
          <div className="chart-card">
            <h3>Most Connected Entities</h3>
            <div style={{ height: 450 }}>
              <Bar
                data={{
                  labels: stats.topConnectedEntities.map((e) => e.entity),
                  datasets: [{
                    label: 'Connections',
                    data: stats.topConnectedEntities.map((e) => e.count),
                    backgroundColor: '#3fb950',
                    borderWidth: 0,
                    borderRadius: 3,
                  }],
                }}
                options={{
                  ...chartOptions,
                  indexAxis: 'y' as const,
                  scales: {
                    ...chartOptions.scales,
                    x: { ...chartOptions.scales.x, type: 'logarithmic' as const },
                  },
                }}
              />
            </div>
          </div>
        )}
        {stats.crossSourceLinks && stats.crossSourceLinks.length > 0 && (
          <div className="chart-card">
            <h3>Top Cross-Source Relationships</h3>
            <div style={{ height: 450 }}>
              <Bar
                data={{
                  labels: stats.crossSourceLinks.map(
                    (l) => `${SOURCE_LABELS[l.from] || l.from} → ${SOURCE_LABELS[l.to] || l.to}`,
                  ),
                  datasets: [{
                    label: 'Links',
                    data: stats.crossSourceLinks.map((l) => l.count),
                    backgroundColor: stats.crossSourceLinks.map((l) => SOURCE_COLORS[l.from] || SOURCE_COLORS.literal),
                    borderWidth: 0,
                    borderRadius: 3,
                  }],
                }}
                options={{
                  ...chartOptions,
                  indexAxis: 'y' as const,
                  scales: {
                    ...chartOptions.scales,
                    x: { ...chartOptions.scales.x, type: 'logarithmic' as const },
                  },
                }}
              />
            </div>
          </div>
        )}
      </div>
      {phase < 3 && (
        <div className="loading" style={{ padding: '1rem' }}>Loading more statistics...</div>
      )}
    </div>
  );
}
