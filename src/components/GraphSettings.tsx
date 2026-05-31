import { useState } from 'react';
import type { ViewOptions, LayoutMode, LabelMode } from '../lib/viewOptions';

interface GraphSettingsProps {
  options: ViewOptions;
  onChange: (patch: Partial<ViewOptions>) => void;
  onFit: () => void;
  onTogglePause: () => void;
  paused: boolean;
}

export function GraphSettings({
  options, onChange, onFit, onTogglePause, paused,
}: GraphSettingsProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className={`graph-settings ${open ? 'open' : ''}`}>
      <button
        type="button"
        className="graph-settings-toggle"
        onClick={() => setOpen((o) => !o)}
        title="View options"
        aria-label="View options"
      >
        {open ? '×' : '⚙'}
      </button>
      {open && (
        <div className="graph-settings-panel">
          <div className="settings-actions">
            <button type="button" onClick={onFit}>Fit to view</button>
            <button type="button" onClick={onTogglePause}>
              {paused ? 'Resume' : 'Pause'}
            </button>
          </div>

          <h5>Display</h5>
          <label className="settings-row">
            <input
              type="checkbox"
              checked={options.autoRotate}
              onChange={(e) => onChange({ autoRotate: e.target.checked })}
            />
            <span>Auto-rotate camera</span>
          </label>
          <label className="settings-row">
            <input
              type="checkbox"
              checked={options.highlightNeighbors}
              onChange={(e) => onChange({ highlightNeighbors: e.target.checked })}
            />
            <span>Highlight on hover</span>
          </label>
          <label className="settings-row">
            <input
              type="checkbox"
              checked={options.particles}
              onChange={(e) => onChange({ particles: e.target.checked })}
            />
            <span>Flow particles on links</span>
          </label>
          <label className="settings-row">
            <input
              type="checkbox"
              checked={options.bloom}
              onChange={(e) => onChange({ bloom: e.target.checked })}
            />
            <span>Bloom glow (GPU heavy)</span>
          </label>

          <h5>Layout</h5>
          <label className="settings-row">
            <span>Mode</span>
            <select
              value={options.layout}
              onChange={(e) => onChange({ layout: e.target.value as LayoutMode })}
            >
              <option value="force">Force-directed</option>
              <option value="radialout">Radial (centred)</option>
              <option value="td">Top-down tree</option>
            </select>
          </label>
          <label className="settings-row">
            <span>Labels</span>
            <select
              value={options.labelMode}
              onChange={(e) => onChange({ labelMode: e.target.value as LabelMode })}
            >
              <option value="auto">Auto (focus band)</option>
              <option value="all">All</option>
              <option value="none">None</option>
            </select>
          </label>

          <h5>Forces</h5>
          <label className="settings-row slider-row">
            <span>Repulsion ×{options.chargeMul.toFixed(1)}</span>
            <input
              type="range"
              min={0.3} max={3} step={0.1}
              value={options.chargeMul}
              onChange={(e) => onChange({ chargeMul: Number(e.target.value) })}
            />
          </label>
          <label className="settings-row slider-row">
            <span>Link length ×{options.linkDistanceMul.toFixed(1)}</span>
            <input
              type="range"
              min={0.3} max={3} step={0.1}
              value={options.linkDistanceMul}
              onChange={(e) => onChange({ linkDistanceMul: Number(e.target.value) })}
            />
          </label>
        </div>
      )}
    </div>
  );
}
