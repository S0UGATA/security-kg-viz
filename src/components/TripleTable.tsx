import type { Triple } from '../lib/duckdb';

interface Props {
  triples: Triple[];
  maxRows?: number;
}

// Adapter that renders the same triples GraphView would, as a plain HTML
// table. Used as the ErrorBoundary fallback when 3d-force-graph / THREE
// fail (WebGL lost context, GPU OOM, etc.) so users keep access to the
// data even when the renderer is dead. Also handy on its own for users
// who just want the rows.
export function TripleTable({ triples, maxRows = 1000 }: Props) {
  const rows = triples.slice(0, maxRows);
  const truncated = triples.length > maxRows;

  return (
    <div className="triple-table-wrap">
      {truncated && (
        <p className="triple-table-truncated">
          Showing {maxRows.toLocaleString()} of {triples.length.toLocaleString()} triples.
        </p>
      )}
      <table className="triple-table">
        <thead>
          <tr>
            <th>Subject</th>
            <th>Predicate</th>
            <th>Object</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t, i) => (
            <tr key={i}>
              <td>{t.subject}</td>
              <td>{t.predicate}</td>
              <td>{t.object}</td>
              <td>{t.source}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
