// Categorical palette tuned for maximum perceptual separation across 24
// sources. Hues are spaced and lightness varied so neighbouring sources don't
// blend in the 3D viewer. Keep these in sync with SOURCE_LABELS below.
export const SOURCE_COLORS: Record<string, string> = {
  // Reds
  attack: '#e6194B',         // signature bright red
  kev: '#800000',            // maroon (KEV — exploited in the wild)
  // Oranges
  capec: '#f58231',          // orange
  nuclei: '#d65a00',         // deep orange
  // Yellow / olive / brown
  cwe: '#ffe119',            // yellow
  vulnrichment: '#bf9000',   // dark gold
  exploitdb: '#9A6324',      // brown
  epss: '#d2b48c',           // tan
  // Greens
  atomic: '#bfef45',         // lime
  d3fend: '#3cb44b',         // green (defensive)
  osv: '#006400',            // dark green
  // Teals
  car: '#14b8a6',            // teal
  nist_800_53: '#0f766e',    // deep teal
  // Cyan / blues
  cpe: '#42d4f4',            // cyan
  cve: '#4363d8',            // blue (signature)
  euvd: '#1e3a8a',           // navy
  sigma: '#6366f1',          // indigo
  // Purples
  ghsa: '#7c3aed',           // vivid purple
  atlas: '#a21caf',          // magenta-purple
  loldrivers: '#4c1d95',     // deep purple
  lolbas: '#c084fc',         // light purple
  misp_galaxy: '#dcbeff',    // pale lavender
  // Pinks
  engage: '#f032e6',         // magenta
  f3: '#ec4899',             // hot pink (fraud)
  // ATT&CK sub-domains share the parent red
  'attack/enterprise': '#e6194B',
  'attack/mobile': '#e6194B',
  'attack/ics': '#e6194B',
  // Reserved
  literal: '#708090',
};

export const SOURCE_LABELS: Record<string, string> = {
  attack: 'MITRE ATT&CK',
  capec: 'CAPEC',
  cwe: 'CWE',
  cve: 'CVE',
  cpe: 'CPE',
  d3fend: 'D3FEND',
  atlas: 'MITRE ATLAS',
  car: 'CAR',
  engage: 'MITRE Engage',
  f3: 'MITRE F3 (Fraud)',
  ghsa: 'GitHub Advisories',
  exploitdb: 'ExploitDB',
  epss: 'EPSS',
  kev: 'CISA KEV',
  sigma: 'Sigma Rules',
  vulnrichment: 'CISA Vulnrichment',
  misp_galaxy: 'MISP Galaxy',
  atomic: 'Atomic Red Team',
  lolbas: 'LOLBAS',
  loldrivers: 'LOLDrivers',
  nist_800_53: 'NIST 800-53',
  nuclei: 'Nuclei Templates',
  euvd: 'ENISA EUVD',
  osv: 'OSV',
  'attack/enterprise': 'ATT&CK Enterprise',
  'attack/mobile': 'ATT&CK Mobile',
  'attack/ics': 'ATT&CK ICS',
  literal: 'Literal Values',
};

export function detectSource(id: string): string {
  if (/^T\d+/.test(id)) return 'attack';
  if (/^TA\d+/.test(id)) return 'attack';
  if (/^G\d+/.test(id)) return 'attack';
  if (/^S\d+/.test(id)) return 'attack';
  if (/^M\d+/.test(id)) return 'attack';
  if (/^DS\d+/.test(id)) return 'attack';
  if (/^C\d{4}/.test(id)) return 'attack';   // Campaigns
  if (/^DC\d+/.test(id)) return 'attack';    // Data Components
  if (/^CAPEC-\d+/.test(id)) return 'capec';
  if (/^CWE-\d+/.test(id)) return 'cwe';
  if (/^CVE-\d{4}-/.test(id)) return 'cve';
  if (/^cpe:/i.test(id)) return 'cpe';
  if (/^D3-/.test(id)) return 'd3fend';
  if (/^AML\./.test(id)) return 'atlas';
  if (/^CAR-/.test(id)) return 'car';
  if (/^E[AV][CV]\d+/.test(id)) return 'engage';
  if (/^DET\d+/.test(id)) return 'engage';   // Engage detections
  if (/^F\d{4}/.test(id)) return 'f3';       // F3 fraud techniques (e.g., F1002.001)
  if (/^GHSA-/.test(id)) return 'ghsa';
  if (/^EDB-\d+/.test(id)) return 'exploitdb';
  if (/^EUVD-/.test(id)) return 'euvd';
  // OSV ecosystem-prefixed IDs (GHSA/CVE handled above; rest fall here)
  if (/^(ALPINE-|RUSTSEC-|PYSEC-|GO-|DSA-|DLA-|DTSA-|USN-|UBUNTU-|DEBIAN-|MAL-|RHSA-|RHBA-|RHEA-|OSV-|BIT-|HSEC-|CURL-|HASKELL-|MGASA-|GSD-|RLSA-|RXSA-|SUSE-|OPENSUSE-)/i.test(id)) return 'osv';
  // NIST 800-53 control IDs: two letters, dash, digits (e.g., SI-4, AC-3, CM-7)
  if (/^[A-Z]{2}-\d+(\(\d+\))?$/.test(id)) return 'nist_800_53';
  // Sigma / Atomic Red Team / LOLDrivers all use UUID v4 IDs — collision is
  // unavoidable from the ID alone; the actual source comes from the triple's
  // `source` column at query time (resolveSource in graph-builder).
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return 'sigma';
  return 'literal';
}

const HF_REPO =
  'https://huggingface.co/datasets/s0u9ata/security-kg/resolve/main';
const HF_BASE = `${HF_REPO}/data`;

export const PARQUET_URL = `${HF_BASE}/combined.parquet`;

// Sentinel for the partitioned mode: a single `kg` view built via
// read_parquet() over every per-source file. DuckDB can prune entire files
// when queries filter by `source`. Slower than combined.parquet for
// full-scan queries (more HTTP range requests), and skips the dedup that
// combined.parquet applies, so duplicates may appear across sources.
export const PARTITIONED_FILE_TOKEN = '__partitioned__';

// Per-source parquet files used when PARTITIONED_FILE_TOKEN is selected.
// Excludes the aggregate files (combined, attack-all) so each row is
// attributed to exactly one source.
const PARTITIONED_FILES = [
  'enterprise.parquet', 'mobile.parquet', 'ics.parquet',
  'atlas.parquet', 'engage.parquet', 'f3.parquet',
  'capec.parquet', 'car.parquet', 'cpe.parquet', 'cve.parquet', 'cwe.parquet',
  'd3fend.parquet', 'epss.parquet', 'euvd.parquet', 'exploitdb.parquet',
  'ghsa.parquet', 'kev.parquet', 'vulnrichment.parquet', 'sigma.parquet',
  'misp_galaxy.parquet', 'atomic.parquet', 'lolbas.parquet', 'loldrivers.parquet',
  'nist_800_53.parquet', 'nuclei.parquet', 'osv.parquet',
];
export const PARTITIONED_PARQUET_URLS: string[] =
  PARTITIONED_FILES.map((f) => `${HF_BASE}/${f}`);

export const AVAILABLE_PARQUET_FILES = [
  { label: 'Combined (all sources)', file: 'combined.parquet' },
  { label: 'Partitioned (per-source union, experimental)', file: PARTITIONED_FILE_TOKEN },
  { label: 'MITRE ATT&CK (all)', file: 'attack-all.parquet' },
  { label: '\u00A0\u00A0\u2514 ATT&CK Enterprise', file: 'enterprise.parquet' },
  { label: '\u00A0\u00A0\u2514 ATT&CK Mobile', file: 'mobile.parquet' },
  { label: '\u00A0\u00A0\u2514 ATT&CK ICS', file: 'ics.parquet' },
  { label: 'MITRE ATLAS', file: 'atlas.parquet' },
  { label: 'MITRE Engage', file: 'engage.parquet' },
  { label: 'MITRE F3 (Fraud)', file: 'f3.parquet' },
  { label: 'CAPEC', file: 'capec.parquet' },
  { label: 'CAR', file: 'car.parquet' },
  { label: 'CPE', file: 'cpe.parquet' },
  { label: 'CVE', file: 'cve.parquet' },
  { label: 'CWE', file: 'cwe.parquet' },
  { label: 'D3FEND', file: 'd3fend.parquet' },
  { label: 'EPSS', file: 'epss.parquet' },
  { label: 'ENISA EUVD', file: 'euvd.parquet' },
  { label: 'ExploitDB', file: 'exploitdb.parquet' },
  { label: 'GitHub Advisories', file: 'ghsa.parquet' },
  { label: 'CISA KEV', file: 'kev.parquet' },
  { label: 'CISA Vulnrichment', file: 'vulnrichment.parquet' },
  { label: 'Sigma Rules', file: 'sigma.parquet' },
  { label: 'MISP Galaxy', file: 'misp_galaxy.parquet' },
  { label: 'Atomic Red Team', file: 'atomic.parquet' },
  { label: 'LOLBAS', file: 'lolbas.parquet' },
  { label: 'LOLDrivers', file: 'loldrivers.parquet' },
  { label: 'NIST 800-53', file: 'nist_800_53.parquet' },
  { label: 'Nuclei Templates', file: 'nuclei.parquet' },
  { label: 'OSV', file: 'osv.parquet' },
];

export function parquetFileUrl(file: string): string {
  if (file.startsWith('http://') || file.startsWith('https://')) return file;
  return `${HF_BASE}/${file}`;
}

export function statsFileUrl(parquetFile: string): string {
  const statsFile = parquetFile.split('/').pop()!.replace(/\.parquet$/, '.stats.json');
  return `${HF_REPO}/stats/${statsFile}`;
}

export const EXAMPLE_QUERIES = [
  {
    label: 'Triples by source',
    sql: `SELECT source, COUNT(*) AS cnt FROM kg GROUP BY source ORDER BY cnt DESC`,
  },
  {
    label: 'Object types distribution',
    sql: `SELECT object_type, COUNT(*) AS cnt FROM kg GROUP BY object_type ORDER BY cnt DESC`,
  },
  {
    label: 'Top 20 predicates',
    sql: `SELECT predicate, COUNT(*) AS cnt FROM kg GROUP BY predicate ORDER BY cnt DESC LIMIT 20`,
  },
  {
    label: 'ATT&CK techniques linked to CWEs',
    sql: `SELECT subject, predicate, object, source FROM kg WHERE source = 'attack' AND object LIKE 'CWE-%' LIMIT 100`,
  },
  {
    label: 'CVEs with most relationships',
    sql: `SELECT subject, COUNT(*) AS cnt FROM kg WHERE source = 'cve' GROUP BY subject ORDER BY cnt DESC LIMIT 20`,
  },
];
