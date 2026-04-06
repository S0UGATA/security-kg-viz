import { useState, useEffect, useCallback } from 'react';
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
import { querySQL, getCurrentParquetUrl } from '../lib/duckdb';
import { SOURCE_COLORS, SOURCE_LABELS, statsFileUrl } from '../lib/constants';


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
  const [stats, setStats] = useState<Stats>({});
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState(0); // 0=init, 1=basic, 2=sources, 3=done

  const merge = useCallback((patch: Partial<Stats>) => {
    setStats((prev) => ({ ...prev, ...patch }));
  }, []);

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
            if (!cancelled && typeof data.totalTriples === 'number') {
              setStats(data);
              setPhase(3);
              return;
            }
          }
        } catch {
          // Fall through to live queries
        }
        if (cancelled) return;

        // Phase 1: fast — total + predicates (simple aggregations)
        const [totalResult, predicateResult] = await Promise.all([
          querySQL(`
            SELECT COUNT(*) AS total,
                   COUNT(DISTINCT subject) AS subjects,
                   COUNT(DISTINCT object) AS objects,
                   COUNT(DISTINCT predicate) AS predicates
            FROM kg
          `),
          querySQL(
            'SELECT predicate, COUNT(*) AS cnt FROM kg GROUP BY predicate ORDER BY cnt DESC LIMIT 25',
          ),
        ]);
        if (cancelled) return;

        merge({
          totalTriples: Number(totalResult.rows[0]?.[0] ?? 0),
          uniqueSubjects: Number(totalResult.rows[0]?.[1] ?? 0),
          uniqueObjects: Number(totalResult.rows[0]?.[2] ?? 0),
          uniquePredicates: Number(totalResult.rows[0]?.[3] ?? 0),
          topPredicates: predicateResult.rows.map((row) => ({
            predicate: String(row[0]),
            count: Number(row[1]),
          })),
        });
        setPhase(1);

        // Phase 2: source distribution + cross-source links
        const sourceDistResult = await querySQL(
          `SELECT source, COUNT(*) AS cnt FROM kg GROUP BY source ORDER BY cnt DESC`,
        );
        if (cancelled) return;

        const bySource: Stats['bySource'] = sourceDistResult.rows.map((row) => ({
          source: String(row[0]),
          count: Number(row[1]),
        }));

        const crossResult = await querySQL(`
          WITH entity_source AS (
            SELECT DISTINCT subject, source FROM kg
          )
          SELECT k.source AS src, es.source AS dst, COUNT(*) AS cnt
          FROM kg k
          JOIN entity_source es ON k.object = es.subject
          WHERE k.object_type = 'id' AND k.source != es.source
          GROUP BY k.source, es.source
          ORDER BY cnt DESC
          LIMIT 15
        `);
        if (cancelled) return;

        const crossSourceLinks: Stats['crossSourceLinks'] = crossResult.rows.map((row) => ({
          from: String(row[0]),
          to: String(row[1]),
          count: Number(row[2]),
        }));

        merge({ bySource, crossSourceLinks });
        setPhase(2);

        // Phase 3: top connected entities
        const topResult = await querySQL(`
          SELECT entity, SUM(cnt) AS total FROM (
            SELECT subject AS entity, COUNT(*) AS cnt FROM kg GROUP BY subject
            UNION ALL
            SELECT object AS entity, COUNT(*) AS cnt FROM kg GROUP BY object
          )
          WHERE entity IS NOT NULL
            AND length(trim(entity)) > 1
            AND lower(trim(entity)) NOT IN ('no', 'none', 'n/a', 'na', '-', '--', 'null', 'unknown', 'other', 'true', 'false')
          GROUP BY entity
          ORDER BY total DESC
          LIMIT 15
        `);
        if (cancelled) return;

        merge({
          topConnectedEntities: topResult.rows.map((row) => ({
            entity: String(row[0]),
            count: Number(row[1]),
          })),
        });
        setPhase(3);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load stats');
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [merge]);

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
