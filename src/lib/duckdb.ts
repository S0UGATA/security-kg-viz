import * as duckdb from '@duckdb/duckdb-wasm';
import { PARQUET_URL } from './constants';

let connInstance: duckdb.AsyncDuckDBConnection | null = null;
let initPromise: Promise<duckdb.AsyncDuckDBConnection> | null = null;
let currentParquetUrl: string = PARQUET_URL;
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

export function getCurrentParquetUrl(): string {
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

  if (!isValidParquetUrl(currentParquetUrl)) {
    throw new Error('Invalid parquet URL');
  }
  await conn.query(`
    CREATE VIEW kg AS
    SELECT * FROM parquet_scan('${escapeSql(currentParquetUrl)}')
  `);

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

export async function setParquetUrl(url: string): Promise<void> {
  if (!isValidParquetUrl(url)) {
    throw new Error('Invalid URL: must be an http:// or https:// URL');
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
      await conn.query(`
        CREATE VIEW kg AS
        SELECT * FROM parquet_scan('${escapeSql(url)}')
      `);
      currentParquetUrl = url;
      setStatus('ready');
    } catch (err) {
      await conn.query(`
        CREATE VIEW kg AS
        SELECT * FROM parquet_scan('${escapeSql(currentParquetUrl)}')
      `);
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
  meta: string;
}

export async function queryEntity(entityId: string, limit = 500): Promise<Triple[]> {
  const conn = await getConnection();
  const escaped = escapeSql(entityId);
  const safeLimit = sanitizeLimit(limit);
  const result = await conn.query(`
    SELECT subject, predicate, object, source, object_type, meta
    FROM kg
    WHERE subject ILIKE '${escaped}' OR object ILIKE '${escaped}'
    LIMIT ${safeLimit}
  `);
  return result.toArray().map((row: Record<string, unknown>) => ({
    subject: String(row.subject),
    predicate: String(row.predicate),
    object: String(row.object),
    source: String(row.source ?? ''),
    object_type: String(row.object_type ?? ''),
    meta: String(row.meta ?? ''),
  }));
}

export type TraversalMode = 'bfs' | 'dfs';

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
  // DISTINCT skipped on purpose: callers dedup on the SPO key and DISTINCT
  // would force DuckDB to hash all matching rows (expensive for hub entities).
  const result = await conn.query(`
    SELECT subject, predicate, object, source, object_type, meta
    FROM kg
    WHERE subject IN (${escaped}) OR object IN (${escaped})
    LIMIT ${safeLimit}
  `);
  return result.toArray().map((row: Record<string, unknown>) => ({
    subject: String(row.subject),
    predicate: String(row.predicate),
    object: String(row.object),
    source: String(row.source ?? ''),
    object_type: String(row.object_type ?? ''),
    meta: String(row.meta ?? ''),
  }));
}

async function traverseBFS(
  entityId: string,
  depth: number,
  limit: number,
): Promise<Triple[]> {
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

async function traverseDFS(
  entityId: string,
  depth: number,
  limit: number,
): Promise<Triple[]> {
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
    const nextIds: string[] = [];
    for (const t of rows) {
      if (allTriples.size >= limit) break;
      const key = `${t.subject}\t${t.predicate}\t${t.object}`;
      if (!allTriples.has(key)) {
        allTriples.set(key, t);
        for (const e of [t.subject, t.object]) {
          if (!visited.has(e)) nextIds.push(e);
        }
      }
    }
    // Push reversed so the first neighbor is explored first (LIFO).
    for (let i = nextIds.length - 1; i >= 0; i--) {
      stack.push({ id: nextIds[i], depth: d + 1 });
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
  if (mode === 'dfs') return traverseDFS(entityId, depth, limit);
  return traverseBFS(entityId, depth, limit);
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
