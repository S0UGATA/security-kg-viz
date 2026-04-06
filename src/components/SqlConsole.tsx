import { useState, useCallback, type FormEvent } from 'react';
import { querySQL } from '../lib/duckdb';
import { EXAMPLE_QUERIES } from '../lib/constants';

export function SqlConsole() {
  const [sql, setSql] = useState('SELECT subject, predicate, object, source, object_type FROM kg LIMIT 20');
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<unknown[][]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queryTime, setQueryTime] = useState<number | null>(null);

  const handleRun = useCallback(
    async (e?: FormEvent) => {
      e?.preventDefault();
      const trimmed = sql.trim();
      if (!trimmed) return;

      setLoading(true);
      setError(null);
      setQueryTime(null);
      const start = performance.now();

      try {
        const result = await querySQL(trimmed);
        setQueryTime(Math.round(performance.now() - start));
        setColumns(result.columns);
        setRows(result.rows);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Query failed');
        setColumns([]);
        setRows([]);
      } finally {
        setLoading(false);
      }
    },
    [sql],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleRun();
    }
  };

  return (
    <div className="sql-console">
      <div className="sql-editor">
        <textarea
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter SQL query... (Cmd+Enter to run)"
          spellCheck={false}
        />
        <div className="sql-controls">
          <button onClick={() => handleRun()} disabled={loading || !sql.trim()}>
            {loading ? 'Running...' : 'Run Query'}
          </button>
          {queryTime !== null && (
            <span className="query-time">{queryTime}ms</span>
          )}
        </div>
        <div className="example-queries">
          <span>Examples:</span>
          {EXAMPLE_QUERIES.map((eq) => (
            <button key={eq.label} onClick={() => { setSql(eq.sql); }}>
              {eq.label}
            </button>
          ))}
        </div>
      </div>
      <div className="sql-results">
        {loading && <div className="loading">Executing query...</div>}
        {error && <div className="error-message">{error}</div>}
        {!loading && !error && rows.length > 0 && (
          <>
            <div className="row-count">{rows.length} rows returned</div>
            <table className="results-table">
              <thead>
                <tr>
                  {columns.map((col) => (
                    <th key={col}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td key={j} title={String(cell ?? '')}>
                        {String(cell ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        {!loading && !error && rows.length === 0 && columns.length === 0 && (
          <div className="graph-empty">
            <h3>SQL Console</h3>
            <p>
              Query the security knowledge graph directly using SQL.
              <br />
              The <code>kg</code> table has columns: subject, predicate,
              object, source, object_type, meta.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
