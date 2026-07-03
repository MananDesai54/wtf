export interface BundleNode {
  id: string;
  url: string;
  title: string;
  note?: string;
  viewport: { width: number; height: number };
  image: { format: 'png'; base64?: string; width: number; height: number } | null;
}

export interface BundleEdge {
  from: string;
  to: string;
  label: string;
  bbox: { x: number; y: number; w: number; h: number };
}

export interface Bundle {
  version: 1;
  startUrl: string;
  recordedAt: string;
  nodes: BundleNode[];
  edges: BundleEdge[];
}

export function validateBundle(raw: unknown): { bundle: Bundle | null; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (typeof raw !== 'object' || raw === null) {
    return { bundle: null, errors: ['bundle is not an object'], warnings };
  }
  const b = raw as Record<string, unknown>;
  if (b.version !== 1) errors.push(`unsupported bundle version: ${String(b.version)} (expected 1)`);
  if (!Array.isArray(b.nodes) || b.nodes.length === 0) errors.push('bundle has no nodes');
  if (errors.length > 0) return { bundle: null, errors, warnings };

  const nodes = b.nodes as BundleNode[];
  const ids = new Set(nodes.map((n) => n.id));
  const rawEdges = Array.isArray(b.edges) ? (b.edges as BundleEdge[]) : [];
  const edges = rawEdges.filter((e) => {
    const ok = ids.has(e.from) && ids.has(e.to);
    if (!ok) warnings.push(`dropped edge ${e.from} -> ${e.to}: unknown node id`);
    return ok;
  });

  return {
    bundle: {
      version: 1,
      startUrl: String(b.startUrl ?? ''),
      recordedAt: String(b.recordedAt ?? ''),
      nodes,
      edges,
    },
    errors,
    warnings,
  };
}
