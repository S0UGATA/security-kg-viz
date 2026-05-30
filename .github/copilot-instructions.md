# Security KG Viz — AI agent guide

Fully static React 19 + Vite 6 + TypeScript (strict) SPA that visualizes a 26M+ triple security knowledge graph (24 sources, aggregated from the upstream [`security-kg`](https://github.com/S0UGATA/security-kg) project) by running **DuckDB-WASM in the browser** against a remote Parquet file on HuggingFace (HTTP range requests, no backend). Rendering uses **3d-force-graph** ([src/components/GraphView.tsx](../src/components/GraphView.tsx) wraps `ForceGraph3D` + `three`).

## Architecture (read these together)

- [src/lib/duckdb.ts](../src/lib/duckdb.ts) — **singleton** `AsyncDuckDBConnection` lazily created by `getConnection()`. Registers a `kg` view over `parquet_scan(<url>)`. All data access goes through helpers here:
  - `queryEntity`, `queryEntityMultiHop(id, depth, limit, 'bfs'|'dfs')`, `querySQL`, `setParquetUrl` (mutex-guarded, rolls back to previous URL on failure).
  - Status changes broadcast via `onStatusChange` listener (`'idle' | 'loading-wasm' | 'loading-parquet' | 'ready' | 'error'`) — consumed by [src/App.tsx](../src/App.tsx) header indicator.
  - The `kg` schema is fixed: `subject, predicate, object, source, object_type, meta` (all string). `object_type !== 'id'` means the object is a literal (collapsed by lowercase in graph-builder); `meta` is a per-triple JSON string from the upstream converters (CVSS vectors, OSV version ranges, mapping scores, etc.) — every `Triple` interface and SELECT must include it.
- [src/lib/constants.ts](../src/lib/constants.ts) — single source of truth for the **curated 24-hue source palette** (`SOURCE_COLORS`, grouped by family — reds for attack/kev, blues for cve/euvd/sigma, etc. — so neighbouring sources stay visually distinct in the 3D viewer; do not replace with auto-generated HSL), display names (`SOURCE_LABELS`), `detectSource(id)` regex heuristics (e.g. `T1059` → `attack`, `CAPEC-1` → `capec`, `EUVD-2024-…` → `euvd`, `SI-4` → `nist_800_53`, UUIDv4 → `sigma`), `AVAILABLE_PARQUET_FILES`, and URL builders `parquetFileUrl` / `statsFileUrl` (stats live in HF `stats/<name>.stats.json`). Add new sources here first.
- [src/lib/graph-builder.ts](../src/lib/graph-builder.ts) — pure `Triple[] → GraphData` transform. Conventions: literals are canonicalized via `literalCanonical` (lowercased key) so duplicates merge; predicate→color uses a cached string-hash → HSL; the `centerEntity` node is enlarged and flagged `isCenter`. `GraphLink` carries `predicate`, `triplesSource`, and `meta`, and `buildLinkLabel` renders `predicate [source]` into the hover tooltip (meta is kept on the link object but not shown in the label to avoid cluttering the legend).
- [src/App.tsx](../src/App.tsx) — tabbed shell. **Switching the parquet source bumps `sourceKey`, which is part of each tab's `key=` to force-remount and discard cached state.** When adding a tab that holds query state, follow this pattern.
- [src/components/GraphView.tsx](../src/components/GraphView.tsx) — imperative wrapper around `ForceGraph3D`. **Critical pattern:** every `THREE` geometry/material/texture must be tracked in `disposablesRef` / `sharedSpheresRef` / `sharedMaterialsRef` and released in `cleanupAll()` (called on unmount and before re-rendering new data). Shared geometry/material caches keyed by rounded size/color avoid per-node allocation. Use refs (`onNodeClickRef`, `labelModeRef`) for callbacks/props that the imperative engine reads during animation frames.
- [src/components/Dashboard.tsx](../src/components/Dashboard.tsx) — tries `statsFileUrl(getCurrentParquetUrl())` first (instant, pre-computed), falls back to phased live DuckDB queries on 404. Chart.js modules are explicitly `ChartJS.register(...)`'d at module top.

## Conventions & gotchas

- **Strict TS, no unused locals/params, no implicit any.** `tsc -b` runs in `npm run build`; keep the build green.
- SQL in `duckdb.ts` is built via string interpolation but sanitized: IDs escape `'` → `''`, limits go through `sanitizeLimit` (1–100000). Preserve this when adding queries — never concat raw user input.
- The `SqlConsole` tab exposes raw SQL via `querySQL` (read-only since the parquet view is immutable); example queries live in `EXAMPLE_QUERIES` in [src/lib/constants.ts](../src/lib/constants.ts).
- Entity-explorer search runs multi-hop (`depth=10`, default limit 500) with BFS or DFS — see [src/components/EntityExplorer.tsx](../src/components/EntityExplorer.tsx). It uses a `searchGenRef` generation counter to discard stale async results; copy this pattern for any new async-driven view.
- Vite config: `optimizeDeps.exclude: ['@duckdb/duckdb-wasm']` (required — duckdb pulls its own workers from jsDelivr at runtime via `getJsDelivrBundles()`), and `manualChunks` split out `three`, `3d-force-graph`, `chartjs`, `react`. `base` comes from `VITE_BASE_PATH` env (set in CI to `/<repo-name>/`).

## Workflows

- `npm run dev` — Vite dev server. First query takes seconds (WASM + parquet metadata download).
- `npm run build` — `tsc -b && vite build`. `npm run typecheck` for type-only check.
- Deployment: [.github/workflows/deploy.yml](workflows/deploy.yml) builds with `VITE_BASE_PATH=/<repo>/` and publishes `dist/` to GitHub Pages on push to `main`.
- **Stats are generated elsewhere** — pre-computed `stats/<name>.stats.json` files live in the upstream [`s0u9ata/security-kg`](https://huggingface.co/datasets/s0u9ata/security-kg) HF dataset repo. Do **not** add a stats-generation script or CI job here; [src/components/Dashboard.tsx](../src/components/Dashboard.tsx) just fetches them via `statsFileUrl(...)` with a live-DuckDB fallback.
- **Keep [README.md](../README.md) and [CLAUDE.md](../CLAUDE.md) in sync with code changes.** When you change architecture, dependencies, views, project structure, the deploy workflow, or add/remove a data source, update the matching sections in this file, README.md, and CLAUDE.md in the same change.
- No test suite is configured.

## When adding a new data source

1. Add color (pick a hue that's clearly distinct from existing sources in the same family) + label + (optionally) `detectSource` regex in [src/lib/constants.ts](../src/lib/constants.ts).
2. Add a parquet file entry to `AVAILABLE_PARQUET_FILES` so `DataSourceSelector` picks it up.
3. If the source needs an edge in the Source Map, add it to `KNOWN_LINKS` in [src/lib/graph-builder.ts](../src/lib/graph-builder.ts).
4. Update the sources table in [README.md](../README.md) and [CLAUDE.md](../CLAUDE.md).
