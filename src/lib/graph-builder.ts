import { SOURCE_COLORS, SOURCE_LABELS, detectSource } from './constants';
import type { Triple } from './duckdb';
type ObjectType = Triple['object_type'];

const MAX_LABEL_LENGTH = 48;

function truncateLabel(text: string): string {
  if (text.length <= MAX_LABEL_LENGTH) return text;
  return text.slice(0, MAX_LABEL_LENGTH - 1) + '\u2026';
}

export interface GraphNode {
  id: string;
  label: string;
  color: string;
  source: string;
  val: number;
  isCenter?: boolean;
  x?: number;
  y?: number;
  z?: number;
  fx?: number;
  fy?: number;
  fz?: number;
}

export interface GraphLink {
  source: string;
  target: string;
  label: string;
  color: string;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

function sourceColor(source: string): string {
  return SOURCE_COLORS[source] || SOURCE_COLORS.literal;
}

const predicateColorCache = new Map<string, string>();

export function predicateColor(predicate: string): string {
  let color = predicateColorCache.get(predicate);
  if (color) return color;
  let hash = 0;
  for (let i = 0; i < predicate.length; i++) {
    hash = predicate.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h = ((hash % 360) + 360) % 360;
  color = `hsl(${h}, 45%, 45%)`;
  predicateColorCache.set(predicate, color);
  return color;
}

export function buildGraph(triples: Triple[], centerEntity?: string): GraphData {
  // Phase 1: collect subject → source from triple metadata
  const subjectSource = new Map<string, string>();
  for (const t of triples) {
    if (t.source && !subjectSource.has(t.subject)) {
      subjectSource.set(t.subject, t.source);
    }
  }

  const nodeMap = new Map<string, GraphNode>();
  const literalCanonical = new Map<string, string>();
  const links: GraphLink[] = [];

  function resolveSource(id: string, objectType?: ObjectType): string {
    if (objectType && objectType !== 'id') return 'literal';
    if (subjectSource.has(id)) return subjectSource.get(id)!;
    return detectSource(id);
  }

  function ensureNode(id: string, objectType?: ObjectType): string {
    if (objectType && objectType !== 'id') {
      const lower = id.toLowerCase();
      const canonical = literalCanonical.get(lower);
      if (canonical) {
        const existing = nodeMap.get(canonical)!;
        existing.val = Math.min(existing.val + 1, 17);
        return canonical;
      }
      literalCanonical.set(lower, id);
    }

    const existing = nodeMap.get(id);
    if (existing) {
      existing.val = Math.min(existing.val + 1, 17);
      return id;
    }
    const source = resolveSource(id, objectType);
    nodeMap.set(id, {
      id,
      label: truncateLabel(id),
      color: sourceColor(source),
      source,
      val: 3,
    });
    return id;
  }

  for (const { subject, predicate, object, object_type } of triples) {
    ensureNode(subject);
    const objectId = ensureNode(object, object_type);
    links.push({ source: subject, target: objectId, label: predicate, color: predicateColor(predicate) });
  }

  if (centerEntity) {
    const centerLower = centerEntity.toLowerCase();
    const node = nodeMap.get(centerEntity)
      ?? Array.from(nodeMap.values()).find((n) => n.id.toLowerCase() === centerLower);
    if (node) {
      node.val = Math.max(node.val, 12);
      node.isCenter = true;
    }
  }

  return { nodes: Array.from(nodeMap.values()), links };
}

export interface SourceStats {
  source: string;
  count: number;
}

export interface CrossSourceLink {
  from: string;
  to: string;
  count: number;
  predicate?: string;
}

export interface SourceDetail {
  triples: number;
  entities: number;
  predicates: number;
}

export function buildSourceGraph(
  bySource: SourceStats[],
  crossSourceLinks: CrossSourceLink[],
  sourceDetails?: Record<string, SourceDetail>,
): GraphData {
  // Use sourceDetails for accurate per-source counts when available
  const sources = bySource.filter((s) => s.source !== 'literal');

  // Add sources that appear in sourceDetails but not in bySource
  if (sourceDetails) {
    const existing = new Set(sources.map((s) => s.source));
    for (const [id, detail] of Object.entries(sourceDetails)) {
      if (!existing.has(id)) {
        sources.push({ source: id, count: detail.triples });
      }
    }
  }

  const maxTriples = Math.max(
    ...sources.map((s) => sourceDetails?.[s.source]?.triples ?? s.count),
    1,
  );

  const nodes: GraphNode[] = sources.map((s) => {
    const triples = sourceDetails?.[s.source]?.triples ?? s.count;
    return {
      id: s.source,
      label: SOURCE_LABELS[s.source] || s.source,
      color: sourceColor(s.source),
      source: s.source,
      val: 4 + 16 * Math.log10(triples) / Math.log10(maxTriples),
    };
  });

  const nodeIds = new Set(nodes.map((n) => n.id));

  const links: GraphLink[] = crossSourceLinks
    .filter((l) => nodeIds.has(l.from) && nodeIds.has(l.to))
    .map((l) => ({
      source: l.from,
      target: l.to,
      label: l.predicate || '',
      color: l.predicate ? predicateColor(l.predicate) : '#6a6a8a',
    }));

  return { nodes, links };
}
