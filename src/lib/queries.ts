// Named-queries module. Single source of truth for every SQL aggregation
// the UI runs against the `kg` view, plus a tiny in-memory cache that
// invalidates whenever the active parquet view changes (see onKgChanged
// in duckdb.ts).
//
// Views never construct SQL directly any more \u2014 they call `q.something()`.
// Cache is keyed on (query name, args). Two adapters justify the seam:
//   - parquet-scan via duckdb-wasm (today)
//   - precomputed stats JSON from HuggingFace (statsFileUrl, also here).

import {
  querySQL,
  queryEntityMultiHop,
  onKgChanged,
  getCurrentParquetUrl,
  getCurrentParquetSource,
  type Triple,
  type TraversalMode,
} from './duckdb';
import { statsFileUrl } from './constants';

export interface SummaryRow {
  totalTriples: number;
  uniqueSubjects: number;
  uniqueObjects: number;
  uniquePredicates: number;
}
export interface PredicateCount { predicate: string; count: number; }
export interface SourceCount { source: string; count: number; }
export interface CrossSourceLinkRow { from: string; to: string; count: number; predicate?: string; }
export interface ConnectedEntity { entity: string; count: number; }

// ---------- cache ----------

// Two-tier cache:
//   Tier 1 (memory): 5-min TTL, promise-valued so racing callers share one query.
//                    Cleared on source switch via onKgChanged.
//   Tier 2 (IndexedDB): 24h TTL, survives reloads & source switches. Source URL
//                    is baked into every persisted key so a different parquet
//                    just picks up its own slot. Bump CACHE_SCHEMA_VERSION to
//                    invalidate every persisted entry if a query's SQL changes.
interface CacheEntry<T> { promise: Promise<T>; ts: number; }
const TTL_MS = 5 * 60 * 1000;
const PERSIST_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_SCHEMA_VERSION = 'v1';
const cache = new Map<string, CacheEntry<unknown>>();

onKgChanged(() => cache.clear());

// ---------- IndexedDB persistence ----------

const IDB_NAME = 'security-kg-viz';
const IDB_STORE = 'query-cache';
let idbPromise: Promise<IDBDatabase | null> | null = null;

function openIdb(): Promise<IDBDatabase | null> {
  if (idbPromise) return idbPromise;
  idbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') { resolve(null); return; }
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(IDB_STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return idbPromise;
}

function persistKey(key: string): string {
  const src = getCurrentParquetSource();
  const srcKey = Array.isArray(src) ? `partitioned:${src.length}` : src;
  return `${CACHE_SCHEMA_VERSION}::${srcKey}::${key}`;
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openIdb();
  if (!db) return undefined;
  return new Promise<T | undefined>((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => {
        const entry = req.result as { ts: number; value: T } | undefined;
        if (!entry || Date.now() - entry.ts > PERSIST_TTL_MS) { resolve(undefined); return; }
        resolve(entry.value);
      };
      req.onerror = () => resolve(undefined);
    } catch { resolve(undefined); }
  });
}

async function idbSet<T>(key: string, value: T): Promise<void> {
  const db = await openIdb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put({ ts: Date.now(), value }, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch { resolve(); }
  });
}

function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key) as CacheEntry<T> | undefined;
  if (hit && Date.now() - hit.ts < TTL_MS) return hit.promise;
  const fullKey = persistKey(key);
  const promise = (async () => {
    const persisted = await idbGet<T>(fullKey);
    if (persisted !== undefined) return persisted;
    const value = await fn();
    // Fire-and-forget persistence; failures here mustn't block the caller
    // (quota errors, private-browsing IDB blocks, etc.).
    void idbSet(fullKey, value);
    return value;
  })().catch((e) => {
    // Don't cache failures \u2014 next call gets a fresh attempt.
    if (cache.get(key)?.promise === promise) cache.delete(key);
    throw e;
  });
  cache.set(key, { promise, ts: Date.now() });
  return promise;
}

export function clearQueryCache() {
  cache.clear();
}

export async function clearPersistedQueryCache(): Promise<void> {
  cache.clear();
  const db = await openIdb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch { resolve(); }
  });
}

// ---------- precomputed stats adapter ----------

export interface PrecomputedStats {
  totalTriples?: number;
  uniqueSubjects?: number;
  uniqueObjects?: number;
  uniquePredicates?: number;
  bySource?: SourceCount[];
  topPredicates?: PredicateCount[];
  topConnectedEntities?: ConnectedEntity[];
  crossSourceLinks?: CrossSourceLinkRow[];
  sourceDetails?: Record<string, { triples: number; entities: number; predicates: number }>;
}

// Returns null on 404 / parse failure so callers can fall through to live SQL.
export function fetchPrecomputedStats(): Promise<PrecomputedStats | null> {
  const url = statsFileUrl(getCurrentParquetUrl());
  return cached(`stats:${url}`, async () => {
    try {
      const resp = await fetch(url);
      if (!resp.ok) return null;
      const data = (await resp.json()) as PrecomputedStats;
      return typeof data.totalTriples === 'number' ? data : null;
    } catch {
      return null;
    }
  });
}

// ---------- named SQL queries ----------

async function runScalar<T>(sql: string, mapRow: (row: unknown[]) => T): Promise<T> {
  const res = await querySQL(sql);
  return mapRow(res.rows[0] ?? []);
}

async function runRows<T>(sql: string, mapRow: (row: unknown[]) => T): Promise<T[]> {
  const res = await querySQL(sql);
  return res.rows.map(mapRow);
}

export const q = {
  summary: () => cached<SummaryRow>('summary', () =>
    runScalar(
      `SELECT COUNT(*) AS total,
              COUNT(DISTINCT subject) AS subjects,
              COUNT(DISTINCT object) AS objects,
              COUNT(DISTINCT predicate) AS predicates
       FROM kg`,
      (row) => ({
        totalTriples: Number(row[0] ?? 0),
        uniqueSubjects: Number(row[1] ?? 0),
        uniqueObjects: Number(row[2] ?? 0),
        uniquePredicates: Number(row[3] ?? 0),
      }),
    ),
  ),

  topPredicates: (limit = 25) => cached<PredicateCount[]>(`topPredicates:${limit}`, () =>
    runRows(
      `SELECT predicate, COUNT(*) AS cnt FROM kg
       GROUP BY predicate ORDER BY cnt DESC LIMIT ${Math.max(1, Math.floor(limit))}`,
      (row) => ({ predicate: String(row[0]), count: Number(row[1]) }),
    ),
  ),

  countBySource: () => cached<SourceCount[]>('countBySource', () =>
    runRows(
      `SELECT source, COUNT(*) AS cnt FROM kg
       GROUP BY source ORDER BY cnt DESC`,
      (row) => ({ source: String(row[0]), count: Number(row[1]) }),
    ),
  ),

  // includePredicate: SourceMap wants the modal predicate per link, Dashboard
  // doesn't \u2014 we issue different queries (mode() is expensive) and cache each.
  crossSourceLinks: (
    { limit = 50, includePredicate = false }: { limit?: number; includePredicate?: boolean } = {},
  ) => cached<CrossSourceLinkRow[]>(
    `crossSourceLinks:${limit}:${includePredicate ? 1 : 0}`,
    () => {
      const safe = Math.max(1, Math.floor(limit));
      const sql = includePredicate
        ? `WITH entity_source AS (SELECT DISTINCT subject, source FROM kg)
           SELECT k.source AS src, es.source AS dst, mode(k.predicate) AS pred, COUNT(*) AS cnt
           FROM kg k JOIN entity_source es ON k.object = es.subject
           WHERE k.object_type = 'id' AND k.source != es.source
           GROUP BY k.source, es.source ORDER BY cnt DESC LIMIT ${safe}`
        : `WITH entity_source AS (SELECT DISTINCT subject, source FROM kg)
           SELECT k.source AS src, es.source AS dst, COUNT(*) AS cnt
           FROM kg k JOIN entity_source es ON k.object = es.subject
           WHERE k.object_type = 'id' AND k.source != es.source
           GROUP BY k.source, es.source ORDER BY cnt DESC LIMIT ${safe}`;
      return runRows<CrossSourceLinkRow>(sql, (row) =>
        includePredicate
          ? { from: String(row[0]), to: String(row[1]), predicate: row[2] ? String(row[2]) : undefined, count: Number(row[3]) }
          : { from: String(row[0]), to: String(row[1]), count: Number(row[2]) },
      );
    },
  ),

  // Filter noisy placeholders inside the SQL so DuckDB skips them before the
  // outer aggregation, and restrict the object side to id-typed rows so
  // literals like "high" don't dominate hub counts.
  topConnectedEntities: (limit = 15) => cached<ConnectedEntity[]>(
    `topConnectedEntities:${limit}`,
    () => {
      const safe = Math.max(1, Math.floor(limit));
      return runRows(
        `WITH filtered AS (
           SELECT subject AS entity FROM kg
           WHERE subject IS NOT NULL AND length(trim(subject)) > 1
             AND lower(trim(subject)) NOT IN ('no','none','n/a','na','-','--','null','unknown','other','true','false')
           UNION ALL
           SELECT object AS entity FROM kg
           WHERE object_type = 'id' AND object IS NOT NULL AND length(trim(object)) > 1
             AND lower(trim(object)) NOT IN ('no','none','n/a','na','-','--','null','unknown','other','true','false')
         )
         SELECT entity, COUNT(*) AS total FROM filtered
         GROUP BY entity ORDER BY total DESC LIMIT ${safe}`,
        (row) => ({ entity: String(row[0]), count: Number(row[1]) }),
      );
    },
  ),

  entityNeighborhood: (
    entityId: string, depth: number, limit: number, mode: TraversalMode,
  ): Promise<Triple[]> => cached<Triple[]>(
    `entity:${entityId}:${depth}:${limit}:${mode}`,
    () => queryEntityMultiHop(entityId, depth, limit, mode),
  ),
};
