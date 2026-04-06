import { useState } from 'react';
import { AVAILABLE_PARQUET_FILES, parquetFileUrl, PARQUET_URL } from '../lib/constants';
import { setParquetUrl, getCurrentParquetUrl } from '../lib/duckdb';

interface DataSourceSelectorProps {
  onSwitch?: () => void;
}

export function DataSourceSelector({ onSwitch }: DataSourceSelectorProps) {
  const [customUrl, setCustomUrl] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentUrl = getCurrentParquetUrl();
  const currentFile = AVAILABLE_PARQUET_FILES.find(
    (f) => parquetFileUrl(f.file) === currentUrl,
  )?.file ?? '';

  async function switchSource(url: string, onSuccess?: () => void) {
    if (url === currentUrl) return;
    setSwitching(true);
    setError(null);
    try {
      await setParquetUrl(url);
      onSwitch?.();
      onSuccess?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to switch');
    } finally {
      setSwitching(false);
    }
  }

  return (
    <div className="data-source-selector">
      <label htmlFor="parquet-select">Data source:</label>
      <select
        id="parquet-select"
        value={currentFile}
        onChange={(e) => switchSource(parquetFileUrl(e.target.value))}
        disabled={switching}
      >
        {!currentFile && <option value="">Custom URL</option>}
        {AVAILABLE_PARQUET_FILES.map((f) => (
          <option key={f.file} value={f.file}>
            {f.label}
          </option>
        ))}
      </select>
      <button
        className="custom-url-toggle"
        onClick={() => {
          setShowCustom(!showCustom);
          setCustomUrl(currentUrl);
        }}
        title="Use custom Parquet URL"
        disabled={switching}
      >
        ...
      </button>
      {switching && <span className="source-switching">Switching...</span>}
      {error && <span className="source-error" role="alert">{error}</span>}
      {showCustom && (
        <form
          className="custom-url-form"
          onSubmit={(e) => {
            e.preventDefault();
            const url = customUrl.trim();
            if (url) switchSource(url, () => setShowCustom(false));
          }}
        >
          <input
            type="url"
            value={customUrl}
            onChange={(e) => setCustomUrl(e.target.value)}
            placeholder={PARQUET_URL}
            disabled={switching}
          />
          <button type="submit" disabled={switching || !customUrl.trim()}>
            Load
          </button>
        </form>
      )}
    </div>
  );
}
