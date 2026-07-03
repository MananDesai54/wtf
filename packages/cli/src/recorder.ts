import { chromium, type BrowserContext, type Page } from 'playwright';
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SessionGraph, type Viewport } from './graph.js';
import { ClickTracker, type ClickEvent } from './attribution.js';
import { CAPTURE_SCRIPT } from './capture-script.js';
import { normalizeUrl } from './urls.js';
import { SERIALIZE_SCRIPT } from './dom-serializer.js';
import type { DomCapture, StoredDomCapture } from './dom-types.js';
import { parseDataUri } from './data-uri.js';

export interface RecordOptions {
  url: string;
  out: string;
  profile?: string;
  viewport: Viewport;
  headless?: boolean;
  interactive?: boolean;
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
  private lastCaptured: { id: string; url: string; at: number } | null = null;
  private pendingEdge: { from: string; click: ClickEvent } | null = null;
  private lastClick: ClickEvent | null = null;
  private shotSeq = 0;
  private domSeq = 0;
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
  // Every capture is its own node — the same URL captured twice is two
  // states (modal open/closed, dropdown, form step), so URL dedup is
  // bypassed.
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

    this.graph.markNextDistinct();
    const { node } = this.graph.ensureNode(url, title, this.opts.viewport, timestamp);

    // Edge preference: the click that navigated away from the last captured
    // page; otherwise the last click ON the last captured page (state change
    // without navigation — modal, tab, dropdown).
    let edge = this.pendingEdge;
    if (
      !edge &&
      this.lastCaptured &&
      this.lastClick &&
      this.lastClick.timestamp >= this.lastCaptured.at &&
      normalizeUrl(this.lastClick.pageUrl) === this.lastCaptured.url
    ) {
      edge = { from: this.lastCaptured.id, click: this.lastClick };
    }
    if (edge && edge.from !== node.id) {
      this.graph.addEdge(edge.from, node.id, edge.click.label, edge.click.bbox, timestamp);
    }
    this.pendingEdge = null;
    this.lastClick = null;

    if (this.opts.interactive) {
      await this.captureDom(page, node.id, node.url);
    } else {
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

    this.lastCaptured = { id: node.id, url: node.url, at: timestamp };
    this.currentNodeId = node.id;
    await this.updatePanel(page);
  }

  private async captureDom(page: Page, nodeId: string, nodeUrl: string): Promise<void> {
    try {
      const cap = (await page.evaluate(SERIALIZE_SCRIPT)) as DomCapture;
      if (cap.truncated) console.warn(`wtf: dom capture truncated at element cap for ${nodeUrl}`);
      const imageData: StoredDomCapture['imageData'] = {};
      for (const [id, src] of Object.entries(cap.images)) {
        const fetched = await this.fetchImage(src);
        if (fetched) imageData[id] = fetched;
        else console.warn(`wtf: image fetch failed: ${src.slice(0, 100)}`);
      }
      const stored: StoredDomCapture = { ...cap, imageData };
      const domFile = `dom/${String(++this.domSeq).padStart(4, '0')}.json`;
      writeFileSync(join(this.opts.out, domFile), JSON.stringify(stored));
      this.graph.setDom(nodeId, domFile);
    } catch (err) {
      console.warn(`wtf: dom capture failed for ${nodeUrl}: ${String(err)}`);
    }
  }

  private async fetchImage(src: string): Promise<{ mime: string; base64: string } | null> {
    try {
      if (src.startsWith('data:')) return parseDataUri(src);
      const resp = await this.context.request.get(src);
      if (!resp.ok()) return null;
      const mime = resp.headers()['content-type']?.split(';')[0] || 'image/png';
      return { mime, base64: (await resp.body()).toString('base64') };
    } catch {
      return null;
    }
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
      this.lastClick = click;
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
