import { chromium, type BrowserContext, type Page } from 'playwright';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { SessionGraph, type Viewport } from './graph.js';
import { ClickTracker, type ClickEvent } from './attribution.js';
import { CAPTURE_SCRIPT } from './capture-script.js';
import { normalizeUrl } from './urls.js';

export interface RecordOptions {
  url: string;
  out: string;
  profile?: string;
  viewport: Viewport;
  headless?: boolean;
}

type CaptureEvent =
  | ({ type: 'click' } & ClickEvent)
  | { type: 'spa-nav'; url: string; timestamp: number }
  | { type: 'capture'; timestamp: number }
  | { type: 'done'; timestamp: number }
  | { type: 'panel-ready'; timestamp: number };

export class Recorder {
  private graph!: SessionGraph;
  private tracker = new ClickTracker();
  private context!: BrowserContext;
  private _page!: Page;
  private currentNodeId: string | null = null;
  private lastCaptured: { id: string; url: string } | null = null;
  private pendingEdge: { from: string; click: ClickEvent } | null = null;
  private shotSeq = 0;
  private stopped = false;

  onClose: (() => void) | null = null;
  onDoneRequest: (() => void) | null = null;

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

    await this.context.exposeBinding('__wtf', (source, json: string) => {
      this.onEvent(JSON.parse(json) as CaptureEvent, source.page);
    });
    await this.context.addInitScript(CAPTURE_SCRIPT);

    this._page = this.context.pages()[0] ?? (await this.context.newPage());
    this.attachPage(this._page);
    this.context.on('page', (p) => {
      if (p !== this._page) {
        console.log('wtf: new tab joined the recording');
        this.attachPage(p);
      }
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
    this.graph.save();
    await this.context.close().catch(() => {});
  }

  private attachPage(p: Page): void {
    p.on('framenavigated', (frame) => {
      if (frame === p.mainFrame()) this.onNavigation(frame.url(), Date.now());
    });
  }

  // Snapshot a page into the graph. Called from the injected control
  // panel's Capture button in whichever tab it was clicked (or in tests).
  async capture(page: Page = this._page): Promise<void> {
    if (this.stopped || !page) return;
    const timestamp = Date.now();
    const url = page.url();

    let title = '';
    try {
      title = await page.title();
    } catch {
      return; // page/context gone
    }

    const { node, isNew } = this.graph.ensureNode(url, title, this.opts.viewport, timestamp);

    if (this.pendingEdge && this.pendingEdge.from !== node.id) {
      const { from, click } = this.pendingEdge;
      this.graph.addEdge(from, node.id, click.label, click.bbox, timestamp);
    }
    this.pendingEdge = null;

    if (isNew) {
      const shotFile = `shots/${String(++this.shotSeq).padStart(4, '0')}.png`;
      try {
        await this.setPanelVisible(page, false);
        await page.screenshot({ path: join(this.opts.out, shotFile), fullPage: true });
        this.graph.setShot(node.id, shotFile);
      } catch (err) {
        console.warn(`wtf: screenshot failed for ${node.url}: ${String(err)}`);
      } finally {
        await this.setPanelVisible(page, true);
      }
    }

    this.lastCaptured = { id: node.id, url: node.url };
    this.currentNodeId = node.id;
    await this.updatePanel(page);
  }

  private async setPanelVisible(page: Page, visible: boolean): Promise<void> {
    if (!page) return;
    await page
      .evaluate((v) => {
        const p = document.getElementById('__wtf_panel');
        if (p) p.style.display = v ? 'flex' : 'none';
      }, visible)
      .catch(() => {});
  }

  private async updatePanel(page: Page | undefined = this._page): Promise<void> {
    if (!page) return;
    const count = this.graph.data.nodes.length;
    await page
      .evaluate((c) => {
        (window as unknown as { __wtfPanelState?: (n: number) => void }).__wtfPanelState?.(c);
      }, count)
      .catch(() => {});
  }

  private logEvent(e: unknown): void {
    appendFileSync(join(this.opts.out, 'events.jsonl'), JSON.stringify(e) + '\n');
  }

  private onEvent(e: CaptureEvent, page: Page): void {
    this.logEvent(e);
    if (e.type === 'click') {
      const { type, ...click } = e;
      this.tracker.recordClick(click);
    } else if (e.type === 'spa-nav') {
      this.onNavigation(e.url, e.timestamp);
    } else if (e.type === 'capture') {
      void this.capture(page);
    } else if (e.type === 'done') {
      this.onDoneRequest?.();
    } else if (e.type === 'panel-ready') {
      // A new document mounted the panel. New tabs commit their first
      // navigation before our framenavigated listener attaches, so this is
      // also the navigation signal for them (duplicates are harmless —
      // pendingEdge is only set once).
      try {
        this.onNavigation(page.url(), e.timestamp);
      } catch {
        // page gone
      }
      void this.updatePanel(page);
    }
  }

  // Navigations no longer create nodes — they only remember the click that
  // led away from the last captured page (matched by the URL the click
  // happened on, so new tabs work too), and the next explicit capture draws
  // the edge.
  private onNavigation(url: string, timestamp: number): void {
    if (this.stopped || url === 'about:blank') return;
    this.logEvent({ type: 'nav', url, timestamp });
    if (this.lastCaptured && !this.pendingEdge) {
      const click = this.tracker.consumeForNavigation(timestamp);
      if (click && normalizeUrl(click.pageUrl) === this.lastCaptured.url) {
        this.pendingEdge = { from: this.lastCaptured.id, click };
      }
    }
  }
}
