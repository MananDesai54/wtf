import type { BBox } from './graph.js';

export interface ClickEvent {
  selector: string;
  label: string;
  bbox: BBox;
  pageUrl: string;
  timestamp: number;
}

const WINDOW_MS = 5000;

export class ClickTracker {
  private last: ClickEvent | null = null;

  recordClick(e: ClickEvent): void {
    this.last = e;
  }

  consumeForNavigation(navTimestamp: number): ClickEvent | null {
    const c = this.last;
    if (!c) return null;
    const delta = navTimestamp - c.timestamp;
    if (delta < 0 || delta > WINDOW_MS) return null;
    this.last = null;
    return c;
  }
}
