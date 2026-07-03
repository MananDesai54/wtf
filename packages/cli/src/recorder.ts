import { chromium, type BrowserContext, type Page } from 'playwright';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { SessionGraph, type Viewport } from './graph.js';
import { ClickTracker, type ClickEvent } from './attribution.js';
import { CAPTURE_SCRIPT } from './capture-script.js';

export interface RecordOptions {
  url: string;
  out: string;
  profile?: string;
  viewport: Viewport;
  headless?: boolean;
}

const SETTLE_MS = 500;

type CaptureEvent =
  | ({ type: 'click' } & ClickEvent)
  | { type: 'spa-nav'; url: string; timestamp: number };

export class Recorder {
  private graph!: SessionGraph;
  private tracker = new ClickTracker();
  private context!: BrowserContext;
  private _page!: Page;
  private currentNodeId: string | null = null;
  private shotSeq = 0;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private pending: { url: string; timestamp: number } | null = null;
  private stopped = false;

  onClose: (() => void) | null = null;

  constructor(private opts: RecordOptions) {}

  get page(): Page {
    return this._page;
  }

  async start(): Promise<void> {
    const { opts } = this;
    this.graph = new SessionGraph(opts.out, opts.url, new Date().toISOString());

    if (opts.profile) {
      this.context = await chromium.launchPersistentContext(opts.profile, {
        headless: opts.headless ?? false,
        viewport: opts.viewport,
      });
    } else {
      const browser = await chromium.launch({ headless: opts.headless ?? false });
      this.context = await browser.newContext({ viewport: opts.viewport });
    }

    await this.context.exposeBinding('__wtf', (_source, json: string) => {
      this.onEvent(JSON.parse(json) as CaptureEvent);
    });
    await this.context.addInitScript(CAPTURE_SCRIPT);

    this._page = this.context.pages()[0] ?? (await this.context.newPage());
    this._page.on('framenavigated', (frame) => {
      if (frame === this._page.mainFrame()) this.onNavigation(frame.url(), Date.now());
    });
    this.context.on('page', (p) => {
      if (p !== this._page) console.warn('wtf: new tab opened — not recorded (v1 records first tab only)');
    });
    this.context.on('close', () => {
      if (!this.stopped) {
        this.stopped = true;
        this.onClose?.();
      }
    });

    await this._page.goto(this.opts.url);
  }

  note(text: string): void {
    if (this.currentNodeId) this.graph.setNote(this.currentNodeId, text);
  }

  markNextDistinct(): void {
    this.graph.markNextDistinct();
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.graph.save();
    await this.context.close().catch(() => {});
  }

  private logEvent(e: unknown): void {
    appendFileSync(join(this.opts.out, 'events.jsonl'), JSON.stringify(e) + '\n');
  }

  private onEvent(e: CaptureEvent): void {
    this.logEvent(e);
    if (e.type === 'click') {
      const { type, ...click } = e;
      this.tracker.recordClick(click);
    } else if (e.type === 'spa-nav') {
      this.onNavigation(e.url, e.timestamp);
    }
  }

  private onNavigation(url: string, timestamp: number): void {
    if (this.stopped || url === 'about:blank') return;
    this.logEvent({ type: 'nav', url, timestamp });
    this.pending = { url, timestamp };
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      void this.commitPageState();
    }, SETTLE_MS);
  }

  private async commitPageState(): Promise<void> {
    const pending = this.pending;
    if (!pending || this.stopped) return;
    this.pending = null;

    let title = '';
    try {
      title = await this._page.title();
    } catch {
      return; // page/context gone
    }

    const { node, isNew } = this.graph.ensureNode(pending.url, title, this.opts.viewport, pending.timestamp);

    if (this.currentNodeId && node.id !== this.currentNodeId) {
      const click = this.tracker.consumeForNavigation(pending.timestamp);
      if (click) this.graph.addEdge(this.currentNodeId, node.id, click.label, click.bbox, pending.timestamp);
    }
    this.currentNodeId = node.id;

    if (isNew) {
      const shotFile = `shots/${String(++this.shotSeq).padStart(4, '0')}.png`;
      try {
        await this._page.screenshot({ path: join(this.opts.out, shotFile), fullPage: true });
        this.graph.setShot(node.id, shotFile);
      } catch (err) {
        console.warn(`wtf: screenshot failed for ${node.url}: ${String(err)}`);
      }
    }
  }
}
