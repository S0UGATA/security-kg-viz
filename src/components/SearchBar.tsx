import { useState, useEffect, useRef, type FormEvent, type ReactNode } from 'react';

interface SearchBarProps {
  onSearch: (entityId: string) => void;
  disabled?: boolean;
  children?: ReactNode;
  value?: string;
}

const SUGGESTIONS = ['T1059', 'CVE-2021-44228', 'CWE-79', 'CAPEC-66', 'GHSA-jfh8-c2jp-5v3q', 'D3-AL'];

export function SearchBar({ onSearch, disabled, children, value }: SearchBarProps) {
  const [query, setQuery] = useState(value ?? '');
  const lastSearchRef = useRef('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (value != null) setQuery(value);
  }, [value]);

  const doSearch = (term: string) => {
    const trimmed = term.trim();
    if (!trimmed || trimmed === lastSearchRef.current) return;
    lastSearchRef.current = trimmed;
    onSearch(trimmed);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    lastSearchRef.current = '';
    doSearch(query);
  };

  return (
    <>
      <form className="search-bar" onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search entity ID (e.g., T1059, CVE-2021-44228, CWE-79)..."
          disabled={disabled}
          aria-label="Search entity ID"
        />
        <button type="submit" disabled={disabled || !query.trim()}>
          Search
        </button>
        {children}
      </form>
      <div className="search-suggestions">
        <span>Try:</span>
        {SUGGESTIONS.map((id) => (
          <button key={id} onClick={() => { setQuery(id); doSearch(id); inputRef.current?.focus(); }}>
            {id}
          </button>
        ))}
      </div>
    </>
  );
}
