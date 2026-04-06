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
    SELECT * FROM parquet_scan('${currentParquetUrl}')
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
        SELECT * FROM parquet_scan('${url}')
      `);
      currentParquetUrl = url;
      setStatus('ready');
    } catch (err) {
      await conn.query(`
        CREATE VIEW kg AS
        SELECT * FROM parquet_scan('${currentParquetUrl}')
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
}

export async function queryEntity(entityId: string, limit = 500): Promise<Triple[]> {
  const conn = await getConnection();
  const escaped = entityId.replace(/'/g, "''");
  const safeLimit = sanitizeLimit(limit);
  const result = await conn.query(`
    SELECT subject, predicate, object, source, object_type
    FROM kg
    WHERE subject = '${escaped}' OR object = '${escaped}'
    LIMIT ${safeLimit}
  `);
  return result.toArray().map((row: Record<string, unknown>) => ({
    subject: String(row.subject),
    predicate: String(row.predicate),
    object: String(row.object),
    source: String(row.source ?? ''),
    object_type: String(row.object_type ?? ''),
  }));
}

export type TraversalMode = 'bfs' | 'dfs';

async function fetchNeighbors(entityIds: string[], limit: number): Promise<Triple[]> {
  const conn = await getConnection();
  const escaped = entityIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(',');
  const safeLimit = sanitizeLimit(limit);
  const result = await conn.query(`
    SELECT subject, predicate, object, source, object_type
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
  }));
}

async function traverseBFS(
  entityId: string,
  depth: number,
  limit: number,
): Promise<Triple[]> {
  const allTriples = new Map<string, Triple>();
  let frontier = new Set([entityId]);
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
  const allTriples = new Map<string, Triple>();
  const visited = new Set<string>();

  // DFS with batched queries per depth level
  const stack: [string[], number][] = [[[entityId], 0]];

  while (stack.length > 0 && allTriples.size < limit) {
    const [ids, d] = stack.pop()!;
    const unvisited = ids.filter((id) => !visited.has(id));
    if (unvisited.length === 0 || d > depth) continue;
    for (const id of unvisited) visited.add(id);

    const rows = await fetchNeighbors(unvisited, limit - allTriples.size);
    const neighborsBySource = new Map<string, string[]>();
    for (const t of rows) {
      if (allTriples.size >= limit) break;
      const key = `${t.subject}\t${t.predicate}\t${t.object}`;
      if (!allTriples.has(key)) {
        allTriples.set(key, t);
        for (const entity of [t.subject, t.object]) {
          if (!visited.has(entity)) {
            const srcKey = unvisited.includes(entity) ? '__self__' : entity;
            if (srcKey !== '__self__') {
              if (!neighborsBySource.has(srcKey)) neighborsBySource.set(srcKey, []);
              neighborsBySource.get(srcKey)!.push(entity);
            }
          }
        }
      }
    }
    if (d < depth) {
      const allNeighbors = new Set<string>();
      for (const [, entities] of neighborsBySource) {
        for (const e of entities) allNeighbors.add(e);
      }
      if (allNeighbors.size > 0) {
        stack.push([Array.from(allNeighbors), d + 1]);
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
