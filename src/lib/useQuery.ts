// useQuery \u2014 generation-counter race-cancellation in one place.
//
// Replaces the three flavours of "is this still the current request?" that
// previously lived in Dashboard (let cancelled=false), SourceMap (same), and
// EntityExplorer (searchGenRef). Every async view now shares one pattern.
//
// Cache lives in src/lib/queries.ts (keyed on query name + args); this hook
// is purely about lifecycle: loading, error, stale-discard.

import { useEffect, useRef, useState } from 'react';

export interface QueryResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

export function useQuery<T>(
  fn: () => Promise<T>,
  deps: ReadonlyArray<unknown>,
  options: { enabled?: boolean } = {},
): QueryResult<T> {
  const enabled = options.enabled ?? true;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const genRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    const gen = ++genRef.current;
    setLoading(true);
    setError(null);
    fn()
      .then((result) => {
        if (genRef.current !== gen) return;
        setData(result);
      })
      .catch((e: unknown) => {
        if (genRef.current !== gen) return;
        setError(e instanceof Error ? e.message : 'Query failed');
      })
      .finally(() => {
        if (genRef.current === gen) setLoading(false);
      });
    return () => {
      // Bump generation so any in-flight resolution is discarded.
      genRef.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  return { data, loading, error };
}
