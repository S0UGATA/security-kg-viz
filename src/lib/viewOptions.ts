// Persisted view-options for the 3D graph. Stored in localStorage so the
// user's preferences survive reloads. New fields can be added safely: the
// loader falls back to DEFAULT_VIEW_OPTIONS for any missing keys.

import { useCallback, useEffect, useState } from 'react';

export type LayoutMode = 'force' | 'radialout' | 'td';
export type LabelMode = 'auto' | 'all' | 'none';

export interface ViewOptions {
  autoRotate: boolean;
  highlightNeighbors: boolean;
  particles: boolean;
  layout: LayoutMode;
  bloom: boolean;
  // Multipliers applied on top of the auto-tuned d3 forces (1.0 = default).
  chargeMul: number;
  linkDistanceMul: number;
  labelMode: LabelMode;
}

export const DEFAULT_VIEW_OPTIONS: ViewOptions = {
  autoRotate: false,
  highlightNeighbors: true,
  particles: false,
  layout: 'force',
  bloom: false,
  chargeMul: 1.0,
  linkDistanceMul: 1.0,
  labelMode: 'auto',
};

const STORAGE_KEY = 'security-kg-viz:view-options:v1';

function load(): ViewOptions {
  if (typeof localStorage === 'undefined') return DEFAULT_VIEW_OPTIONS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_VIEW_OPTIONS;
    const parsed = JSON.parse(raw) as Partial<ViewOptions>;
    return { ...DEFAULT_VIEW_OPTIONS, ...parsed };
  } catch {
    return DEFAULT_VIEW_OPTIONS;
  }
}

function save(opts: ViewOptions): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(opts));
  } catch {
    /* quota / private-browsing */
  }
}

export function useViewOptions(): [ViewOptions, (patch: Partial<ViewOptions>) => void] {
  const [options, setOptions] = useState<ViewOptions>(load);

  useEffect(() => { save(options); }, [options]);

  const update = useCallback((patch: Partial<ViewOptions>) => {
    setOptions((prev) => ({ ...prev, ...patch }));
  }, []);

  return [options, update];
}
