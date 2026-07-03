export interface DomRGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

export type BundleDomElement =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; bg?: DomRGBA; borderColor?: DomRGBA; borderWidth?: number; radius?: number }
  | { kind: 'text'; x: number; y: number; w: number; h: number; text: string; fontSize: number; fontWeight: number; color: DomRGBA; align: 'left' | 'center' | 'right' }
  | { kind: 'image'; x: number; y: number; w: number; h: number; imageId: string; radius?: number };

export interface BundleDom {
  width: number;
  height: number;
  truncated?: boolean;
  elements: BundleDomElement[];
  images: Record<string, { mime: string; base64?: string }>;
}

export interface BundleNode {
  id: string;
  url: string;
  title: string;
  note?: string;
  viewport: { width: number; height: number };
  image: { format: 'png'; base64?: string; width: number; height: number } | null;
  dom?: BundleDom | null;
}

export interface BundleEdge {
  from: string;
  to: string;
  label: string;
  bbox: { x: number; y: number; w: number; h: number };
}

export interface Bundle {
  version: 1 | 2;
  startUrl: string;
  recordedAt: string;
  nodes: BundleNode[];
  edges: BundleEdge[];
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isValidViewport(v: unknown): v is { width: number; height: number } {
  return isObject(v) && typeof v.width === 'number' && typeof v.height === 'number';
}

function isValidImage(v: unknown): boolean {
  return v === null || (isObject(v) && typeof v.width === 'number' && typeof v.height === 'number');
}

function isValidNode(v: unknown): v is BundleNode {
  if (!isObject(v)) return false;
  return (
    typeof v.id === 'string' &&
    typeof v.url === 'string' &&
    typeof v.title === 'string' &&
    isValidViewport(v.viewport) &&
    isValidImage(v.image)
  );
}

function isValidBBox(v: unknown): v is { x: number; y: number; w: number; h: number } {
  return isObject(v) && typeof v.x === 'number' && typeof v.y === 'number' && typeof v.w === 'number' && typeof v.h === 'number';
}

function isValidEdge(v: unknown): v is BundleEdge {
  if (!isObject(v)) return false;
  return (
    typeof v.from === 'string' &&
    typeof v.to === 'string' &&
    typeof v.label === 'string' &&
    isValidBBox(v.bbox)
  );
}

export function validateBundle(raw: unknown): { bundle: Bundle | null; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (typeof raw !== 'object' || raw === null) {
    return { bundle: null, errors: ['bundle is not an object'], warnings };
  }
  const b = raw as Record<string, unknown>;
  if (b.version !== 1 && b.version !== 2) errors.push(`unsupported bundle version: ${String(b.version)} (expected 1 or 2)`);
  if (!Array.isArray(b.nodes) || b.nodes.length === 0) errors.push('bundle has no nodes');
  if (errors.length > 0) return { bundle: null, errors, warnings };

  const rawNodes = b.nodes as unknown[];
  for (let i = 0; i < rawNodes.length; i++) {
    if (!isValidNode(rawNodes[i])) {
      errors.push(`node at index ${i} is malformed`);
      return { bundle: null, errors, warnings };
    }
    const dom = (rawNodes[i] as { dom?: unknown }).dom;
    if (dom !== undefined && dom !== null) {
      const d = dom as Record<string, unknown>;
      const malformedImages = d.images !== undefined && (typeof d.images !== 'object' || d.images === null || Array.isArray(d.images));
      if (typeof d.width !== 'number' || typeof d.height !== 'number' || !Array.isArray(d.elements) || malformedImages) {
        errors.push(`node at index ${i} has malformed dom`);
        return { bundle: null, errors, warnings };
      }
      d.images = d.images ?? {};
    }
  }
  const nodes = rawNodes as BundleNode[];
  const ids = new Set(nodes.map((n) => n.id));
  const rawEdges = Array.isArray(b.edges) ? (b.edges as unknown[]) : [];
  const edges = rawEdges.filter((rawEdge): rawEdge is BundleEdge => {
    if (!isValidEdge(rawEdge)) {
      warnings.push('dropped malformed edge');
      return false;
    }
    const e = rawEdge;
    const ok = ids.has(e.from) && ids.has(e.to);
    if (!ok) warnings.push(`dropped edge ${e.from} -> ${e.to}: unknown node id`);
    return ok;
  });

  return {
    bundle: {
      version: b.version as 1 | 2,
      startUrl: String(b.startUrl ?? ''),
      recordedAt: String(b.recordedAt ?? ''),
      nodes,
      edges,
    },
    errors,
    warnings,
  };
}
