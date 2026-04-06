const LINKS = [
  {
    label: 'Security KG Dataset',
    url: 'https://huggingface.co/datasets/s0u9ata/security-kg',
    description: 'The HuggingFace dataset with 18M+ security knowledge graph triples in Parquet format.',
  },
  {
    label: 'security-kg',
    url: 'https://github.com/S0UGATA/security-kg',
    description: 'Pipeline that builds the knowledge graph from MITRE ATT&CK, CVE, CWE, CAPEC, D3FEND, EPSS, Sigma, and other sources.',
  },
  {
    label: 'security-kg-viz',
    url: 'https://github.com/S0UGATA/security-kg-viz',
    description: 'This visualizer app. Static React + DuckDB-WASM + 3D force graph, deployed to GitHub Pages.',
  },
];

const SOURCES = [
  'MITRE ATT&CK (Enterprise, Mobile, ICS)',
  'CAPEC (Common Attack Pattern Enumerations)',
  'CWE (Common Weakness Enumeration)',
  'CVE (Common Vulnerabilities and Exposures)',
  'CPE (Common Platform Enumeration)',
  'D3FEND (Defensive Techniques)',
  'MITRE ATLAS (Adversarial AI/ML)',
  'MITRE Engage (Adversary Engagement)',
  'CAR (Cyber Analytics Repository)',
  'EPSS (Exploit Prediction Scoring)',
  'CISA KEV (Known Exploited Vulnerabilities)',
  'CISA Vulnrichment (SSVC, CVSS)',
  'GitHub Security Advisories (GHSA)',
  'ExploitDB (Public Exploits)',
  'Sigma Rules (Detection Rules)',
  'MISP Galaxy (Threat Intelligence)',
];

export function About() {
  return (
    <div className="about">
      <h2>About</h2>
      <p>
        An interactive browser-based explorer for a security knowledge graph containing 18M+
        triples across 16 data sources. All queries run locally via DuckDB-WASM over remote
        Parquet files — no backend required.
      </p>

      <h3>Links</h3>
      <ul className="about-links">
        {LINKS.map((link) => (
          <li key={link.url}>
            <a href={link.url} target="_blank" rel="noopener noreferrer">{link.label}</a>
            <span> — {link.description}</span>
          </li>
        ))}
      </ul>

      <h3>Data Sources</h3>
      <ul className="about-sources">
        {SOURCES.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>

      <h3>Tech Stack</h3>
      <ul className="about-sources">
        <li>React 19 + TypeScript + Vite</li>
        <li>DuckDB-WASM (in-browser SQL over remote Parquet via HTTP range requests)</li>
        <li>3d-force-graph (Three.js-based 3D force-directed graph)</li>
        <li>Chart.js (dashboard charts)</li>
      </ul>
    </div>
  );
}
