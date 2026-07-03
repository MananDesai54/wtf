import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeUrl } from './urls.js';

export interface Viewport { width: number; height: number }
export interface BBox { x: number; y: number; w: number; h: number }

export interface PageNode {
  id: string;
  url: string;
  title: string;
  shotFile: string | null;
  viewport: Viewport;
  note?: string;
  timestamp: number;
}

export interface Edge { from: string; to: string; label: string; bbox: BBox; timestamp: number }

export interface GraphData {
  startUrl: string;
  recordedAt: string;
  nodes: PageNode[];
  edges: Edge[];
}

export class SessionGraph {
  private nodes: PageNode[] = [];
  private edges: Edge[] = [];
  private byUrl = new Map<string, PageNode>();
  private forceNext = false;
  private seq = 0;

  constructor(
    private dir: string,
    private startUrl: string,
    private recordedAt: string,
  ) {
    mkdirSync(join(dir, 'shots'), { recursive: true });
  }

  markNextDistinct(): void {
    this.forceNext = true;
  }

  ensureNode(url: string, title: string, viewport: Viewport, timestamp: number): { node: PageNode; isNew: boolean } {
    const key = normalizeUrl(url);
    const existing = this.byUrl.get(key);
    if (existing && !this.forceNext) return { node: existing, isNew: false };
    this.forceNext = false;
    const node: PageNode = { id: `p${++this.seq}`, url: key, title, shotFile: null, viewport, timestamp };
    this.nodes.push(node);
    this.byUrl.set(key, node);
    this.save();
    return { node, isNew: true };
  }

  setShot(nodeId: string, shotFile: string): void {
    const n = this.nodes.find((n) => n.id === nodeId);
    if (n) { n.shotFile = shotFile; this.save(); }
  }

  addEdge(from: string, to: string, label: string, bbox: BBox, timestamp: number): void {
    this.edges.push({ from, to, label, bbox, timestamp });
    this.save();
  }

  setNote(nodeId: string, note: string): void {
    const n = this.nodes.find((n) => n.id === nodeId);
    if (n) { n.note = note; this.save(); }
  }

  get data(): GraphData {
    return { startUrl: this.startUrl, recordedAt: this.recordedAt, nodes: this.nodes, edges: this.edges };
  }

  save(): void {
    writeFileSync(join(this.dir, 'graph.json'), JSON.stringify(this.data, null, 2));
  }
}
