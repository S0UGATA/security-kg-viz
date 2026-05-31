import * as duckdb from '@duckdb/duckdb-wasm';
import { PARQUET_URL } from './constants';

let connInstance: duckdb.AsyncDuckDBConnection | null = null;
let initPromise: Promise<duckdb.AsyncDuckDBConnection> | null = null;
let currentParquetUrl: string | string[] = PARQUET_URL;
let workerInstance: Worker | null = null;

export type DuckDBStatus = 'idle' | 'loading-wasm' | 'loading-parquet' | 'ready' | 'error';

let statusListeners: Array<(status: DuckDBStatus, detail?: string) => void> = [];
let currentStatus: DuckDBStatus = 'idle';

function setStatus(status: DuckDBStatus, detail?: string) {
  currentStatus = status;
  for (const listener of statusListeners) {
    listener(status, detail);
  }
}

export function onStatusChange(listener: (status: DuckDBStatus, detail?: string) => void) {
  statusListeners.push(listener);
  listener(currentStatus);
  return () => {
    statusListeners = statusListeners.filter((l) => l !== listener);
  };
}

// Cache-invalidation seam: anything caching query results (e.g. src/lib/queries.ts)
// subscribes here and clears its cache whenever the active parquet view changes.
let kgChangeListeners: Array<() => void> = [];
export function onKgChanged(listener: () => void): () => void {
  kgChangeListeners.push(listener);
  return () => {
    kgChangeListeners = kgChangeListeners.filter((l) => l !== listener);
  };
}
function notifyKgChanged() {
  for (const l of kgChangeListeners) l();
}

export function getCurrentParquetUrl(): string {
  return Array.isArray(currentParquetUrl) ? currentParquetUrl[0] : currentParquetUrl;
}

// Display-friendly description of the active source: a single URL or a list.
export function getCurrentParquetSource(): string | string[] {
  return currentParquetUrl;
}

function isValidParquetUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function sanitizeLimit(limit: number): number {
  const n = Math.floor(limit);
  if (!Number.isFinite(n) || n < 1) return 500;
  return Math.min(n, 100000);
}

// DuckDB string-literal escape: double up single quotes. Used for every value
// interpolated into SQL (URLs, IDs, etc.) since the WASM build doesn't expose
// a parameterized prepare/bind API we use here.
function escapeSql(s: string): string {
  return s.replace(/'/g, "''");
}

// Single source of truth for the `kg` view definition. Accepts either one
// URL (parquet_scan) or a list (read_parquet with union_by_name, used by the
// "Partitioned (all sources)" mode so DuckDB can prune entire files by
// source-column predicates).
//
// Adds two computed columns that callers can rely on:
//   - object_canonical: lower-trimmed for literal objects (object_type<>'id'),
//     identical to `object` otherwise. Centralises the literal-merge rule
//     that graph-builder.ts used to own client-side.
function buildKgViewSql(source: string | string[]): string {
  const scan = Array.isArray(source)
    ? `read_parquet([${source.map((u) => `'${escapeSql(u)}'`).join(',')}], union_by_name=true)`
    : `parquet_scan('${escapeSql(source)}')`;
  // `meta` is kept in the view so SqlConsole users can inspect CVSS / OSV /
  // mapping JSON ad-hoc, but the high-volume traversal queries below DO NOT
  // project it. Parquet is columnar + DuckDB pushes projection through views,
  // so unreferenced columns never hit the wire.
  return `
    CREATE VIEW kg AS
    SELECT
      subject, predicate, object, source, object_type, meta,
      CASE WHEN object_type <> 'id' THEN lower(trim(object)) ELSE object END
        AS object_canonical
    FROM ${scan}
  `;
}

async function initialize(): Promise<duckdb.AsyncDuckDBConnection> {
  setStatus('loading-wasm', 'Downloading DuckDB WebAssembly runtime...');

  const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles();
  const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES);

  const workerUrl = URL.createObjectURL(
    new Blob([`importScripts("${bundle.mainWorker!}");`], { type: 'text/javascript' }),
  );
  try {
    if (workerInstance) workerInstance.terminate();
    workerInstance = new Worker(workerUrl);
  } finally {
    URL.revokeObjectURL(workerUrl);
  }
  const logger = new duckdb.ConsoleLogger();
  const db = new duckdb.AsyncDuckDB(logger, workerInstance);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);

  const conn = await db.connect();

  setStatus('loading-parquet', 'Registering Parquet data source...');

  const urls = Array.isArray(currentParquetUrl) ? currentParquetUrl : [currentParquetUrl];
  if (!urls.every(isValidParquetUrl)) {
    throw new Error('Invalid parquet URL');
  }
  await conn.query(buildKgViewSql(currentParquetUrl));

  setStatus('ready');
  connInstance = conn;
  return conn;
}

export async function getConnection(): Promise<duckdb.AsyncDuckDBConnection> {
  if (connInstance) return connInstance;
  if (!initPromise) {
    initPromise = initialize().catch((err) => {
      setStatus('error', err instanceof Error ? err.message : 'Failed to initialize DuckDB');
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

let parquetMutex: Promise<void> = Promise.resolve();

export async function setParquetUrl(url: string | string[]): Promise<void> {
  const urls = Array.isArray(url) ? url : [url];
  if (urls.length === 0 || !urls.every(isValidParquetUrl)) {
    throw new Error('Invalid URL: must be one or more http(s) URLs');
  }

  const prev = parquetMutex;
  let resolve!: () => void;
  parquetMutex = new Promise<void>((r) => { resolve = r; });

  try {
    await prev;
    const conn = await getConnection();
    setStatus('loading-parquet', 'Switching data source...');
    try {
      await conn.query('DROP VIEW IF EXISTS kg');
      await conn.query(buildKgViewSql(url));
      currentParquetUrl = url;
      notifyKgChanged();
      setStatus('ready');
    } catch (err) {
      await conn.query(buildKgViewSql(currentParquetUrl));
      setStatus('error', err instanceof Error ? err.message : 'Failed to switch data source');
      throw err;
    }
  } finally {
    resolve();
  }
}

export interface Triple {
  subject: string;
  predicate: string;
  object: string;
  source: string;
  object_type: string;
  // Lower-trimmed object for literal nodes; equals `object` for id-typed rows.
  // Computed by the kg view (see buildKgViewSql) so every caller sees the
  // same canonical form without re-implementing the rule in JS.
  object_canonical: string;
}

export async function queryEntity(entityId: string, limit = 500): Promise<Triple[]> {
  const conn = await getConnection();
  const escaped = escapeSql(entityId);
  const safeLimit = sanitizeLimit(limit);
  const result = await conn.query(`
    SELECT subject, predicate, object, source, object_type, object_canonical
    FROM kg
    WHERE subject ILIKE '${escaped}' OR object ILIKE '${escaped}'
    LIMIT ${safeLimit}
  `);
  return rowsToTriples(result.toArray());
}

export type TraversalMode = 'bfs' | 'dfs';

function rowsToTriples(rows: Array<Record<string, unknown>>): Triple[] {
  return rows.map((row) => ({
    subject: String(row.subject),
    predicate: String(row.predicate),
    object: String(row.object),
    source: String(row.source ?? ''),
    object_type: String(row.object_type ?? ''),
    object_canonical: String(row.object_canonical ?? row.object ?? ''),
  }));
}

// Multi-hop traversal as a per-hop fetch loop. We tried a single recursive
// CTE to save round trips, but for hub entities (T1059, popular CVEs, ...)
// the recursion fanned out to millions of nodes before the outer LIMIT
// applied, hanging DuckDB-WASM. The per-hop version caps each query at the
// remaining triple budget, so total work is bounded by `limit` regardless
// of graph degree. Round-trip cost inside DuckDB-WASM is in-process, not
// network, so O(depth) calls are cheap.
async function resolveSeedEntities(entityId: string): Promise<string[]> {
  const conn = await getConnection();
  const escaped = escapeSql(entityId);
  const result = await conn.query(`
    SELECT DISTINCT id FROM (
      SELECT subject AS id FROM kg WHERE subject ILIKE '${escaped}'
      UNION ALL
      SELECT object AS id FROM kg WHERE object ILIKE '${escaped}'
    ) LIMIT 10
  `);
  const ids = result.toArray().map((r: Record<string, unknown>) => String(r.id));
  return ids.length > 0 ? ids : [entityId];
}

async function fetchNeighbors(entityIds: string[], limit: number): Promise<Triple[]> {
  const conn = await getConnection();
  const escaped = entityIds.map((id) => `'${escapeSql(id)}'`).join(',');
  const safeLimit = sanitizeLimit(limit);
  // Split the `subject IN (...) OR object IN (...)` into a UNION ALL of two
  // single-column filters. DuckDB can push each branch down independently and
  // skip parquet row-groups whose min/max stats don't intersect the entity
  // set, which the OR form prevents. DISTINCT skipped on purpose: callers
  // dedup on the SPO key and DISTINCT would force a hash over all matches.
  const cols = 'subject, predicate, object, source, object_type, object_canonical';
  const result = await conn.query(`
    SELECT * FROM (
      (SELECT ${cols} FROM kg WHERE subject IN (${escaped}) LIMIT ${safeLimit})
      UNION ALL
      (SELECT ${cols} FROM kg WHERE object  IN (${escaped}) LIMIT ${safeLimit})
    )
    LIMIT ${safeLimit}
  `);
  return rowsToTriples(result.toArray());
}

async function traverseBFS(entityId: string, depth: number, limit: number): Promise<Triple[]> {
  const seeds = await resolveSeedEntities(entityId);
  const allTriples = new Map<string, Triple>();
  let frontier = new Set(seeds);
  const visited = new Set<string>();

  for (let hop = 0; hop < depth; hop++) {
    if (allTriples.size >= limit) break;
    const newIds = Array.from(frontier).filter((id) => !visited.has(id));
    if (newIds.length === 0) break;
    for (const id of newIds) visited.add(id);

    const rows = await fetchNeighbors(newIds, limit - allTriples.size);
    const nextFrontier = new Set<string>();
    for (const t of rows) {
      if (allTriples.size >= limit) break;
      const key = `${t.subject}\t${t.predicate}\t${t.object}`;
      if (!allTriples.has(key)) {
        allTriples.set(key, t);
        if (!visited.has(t.subject)) nextFrontier.add(t.subject);
        if (!visited.has(t.object)) nextFrontier.add(t.object);
      }
    }
    frontier = nextFrontier;
  }
  return Array.from(allTriples.values());
}

async function traverseDFS(entityId: string, depth: number, limit: number): Promise<Triple[]> {
  const seeds = await resolveSeedEntities(entityId);
  const allTriples = new Map<string, Triple>();
  const visited = new Set<string>();
  // Single-entity stack so traversal is genuinely depth-first; mirrors BFS
  // hop semantics (hops 0..depth-1 expand, depth stops).
  const stack: { id: string; depth: number }[] = seeds.map((id) => ({ id, depth: 0 }));

  while (stack.length > 0 && allTriples.size < limit) {
    const { id, depth: d } = stack.pop()!;
    if (visited.has(id) || d >= depth) continue;
    visited.add(id);

    const rows = await fetchNeighbors([id], limit - allTriples.size);
    for (const t of rows) {
      if (allTriples.size >= limit) break;
      const key = `${t.subject}\t${t.predicate}\t${t.object}`;
      if (!allTriples.has(key)) {
        allTriples.set(key, t);
        if (!visited.has(t.subject)) stack.push({ id: t.subject, depth: d + 1 });
        if (!visited.has(t.object)) stack.push({ id: t.object, depth: d + 1 });
      }
    }
  }
  return Array.from(allTriples.values());
}

export async function queryEntityMultiHop(
  entityId: string,
  depth: number,
  limit = 500,
  mode: TraversalMode = 'bfs',
): Promise<Triple[]> {
  return mode === 'dfs' ? traverseDFS(entityId, depth, limit) : traverseBFS(entityId, depth, limit);
}

export async function querySQL(sql: string): Promise<{ columns: string[]; rows: unknown[][] }> {
  const conn = await getConnection();
  const result = await conn.query(sql);
  const columns = result.schema.fields.map((f) => f.name);
  const rows = result.toArray().map((row: Record<string, unknown>) =>
    columns.map((col) => row[col]),
  );
  return { columns, rows };
}
