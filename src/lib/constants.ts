export const SOURCE_COLORS: Record<string, string> = {
  attack: '#ff2d2d',
  capec: '#ff8c00',
  cwe: '#ffd700',
  cve: '#1e90ff',
  cpe: '#00ced1',
  d3fend: '#00ff7f',
  atlas: '#ba55d3',
  car: '#20b2aa',
  engage: '#ff1493',
  ghsa: '#7b68ee',
  exploitdb: '#ff6347',
  epss: '#00ffff',
  kev: '#ff4500',
  sigma: '#6495ed',
  vulnrichment: '#e0a458',
  misp_galaxy: '#c9b1ff',
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
  ghsa: 'GitHub Advisories',
  exploitdb: 'ExploitDB',
  epss: 'EPSS',
  kev: 'CISA KEV',
  sigma: 'Sigma Rules',
  vulnrichment: 'CISA Vulnrichment',
  misp_galaxy: 'MISP Galaxy',
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
  if (/^GHSA-/.test(id)) return 'ghsa';
  if (/^EDB-\d+/.test(id)) return 'exploitdb';
  // Sigma rules use UUID v4 IDs (version nibble = 4)
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return 'sigma';
  return 'literal';
}

const HF_REPO =
  'https://huggingface.co/datasets/s0u9ata/security-kg/resolve/main';
const HF_BASE = `${HF_REPO}/data`;

export const PARQUET_URL = `${HF_BASE}/combined.parquet`;

export const AVAILABLE_PARQUET_FILES = [
  { label: 'Combined (all sources)', file: 'combined.parquet' },
  { label: 'MITRE ATT&CK (all)', file: 'attack-all.parquet' },
  { label: '\u00A0\u00A0\u2514 ATT&CK Enterprise', file: 'enterprise.parquet' },
  { label: '\u00A0\u00A0\u2514 ATT&CK Mobile', file: 'mobile.parquet' },
  { label: '\u00A0\u00A0\u2514 ATT&CK ICS', file: 'ics.parquet' },
  { label: 'MITRE ATLAS', file: 'atlas.parquet' },
  { label: 'CAPEC', file: 'capec.parquet' },
  { label: 'CAR', file: 'car.parquet' },
  { label: 'CPE', file: 'cpe.parquet' },
  { label: 'CVE', file: 'cve.parquet' },
  { label: 'CWE', file: 'cwe.parquet' },
  { label: 'D3FEND', file: 'd3fend.parquet' },
  { label: 'MITRE Engage', file: 'engage.parquet' },
  { label: 'EPSS', file: 'epss.parquet' },
  { label: 'ExploitDB', file: 'exploitdb.parquet' },
  { label: 'GitHub Advisories', file: 'ghsa.parquet' },
  { label: 'CISA KEV', file: 'kev.parquet' },
  { label: 'Sigma Rules', file: 'sigma.parquet' },
  { label: 'Vuln Enrichment', file: 'vulnrichment.parquet' },
  { label: 'MISP Galaxy', file: 'misp_galaxy.parquet' },
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
