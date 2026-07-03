# wtf --interactive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `wtf record --interactive` captures pages as serialized DOM (full page, nothing clipped) and the Figma plugin rebuilds them as editable layers; screenshot mode stays the default.

**Architecture:** A browser-side serializer script walks the DOM at capture time and emits flat paint-order primitives (rect/text/image) in page coordinates. The recorder stores them per node as `dom/NNNN.json` (image bytes fetched via the browser context, so auth works). The exporter bundles them as `version: 2` nodes carrying `dom` instead of `image`. The plugin renders dom nodes as Rectangle/Text/Image-fill children of the frame; hotspots/arrows/reactions are untouched because dom coordinates share the click-bbox coordinate space.

**Tech Stack:** existing monorepo (TypeScript strict, ESM, Playwright, vitest, esbuild, @figma/plugin-typings).

**Spec:** `docs/superpowers/specs/2026-07-03-interactive-capture-design.md`

## Global Constraints

- Bundle `version: 2`; plugin accepts version 1 AND 2.
- Exactly one of `image`/`dom` non-null per captured node (both null if capture failed).
- DOM nodes: no 4096px downscale, no bbox rescale. Screenshot nodes keep both.
- Element cap: 5000 per capture → `truncated: true` + warning.
- Font mapping: weight >= 600 → Inter Bold, else Inter Regular.
- Coordinates: page coords (`getBoundingClientRect` + `scrollX/Y`).
- dom files: `dom/0001.json` zero-padded 4, own counter (independent of shots).
- The CLI and plugin are separate packages — the `DomElement`/`RGBA` shapes are intentionally duplicated in `packages/cli/src/dom-types.ts` and `packages/figma-plugin/src/validate.ts`.
- Tests: `npx vitest run <path>` from repo root (`/Users/manan/asgard/wtf`).

---

### Task 1: Graph support for dom captures

**Files:**
- Modify: `packages/cli/src/graph.ts`
- Create: `packages/cli/src/dom-types.ts`
- Test: `packages/cli/test/graph.test.ts` (append)

**Interfaces:**
- Consumes: existing `SessionGraph`.
- Produces:
  - `PageNode.domFile: string | null` (new field, default null); `SessionGraph.setDom(nodeId: string, domFile: string): void`; constructor now also creates `<dir>/dom/`.
  - `packages/cli/src/dom-types.ts` exporting:
    ```ts
    export interface RGBA { r: number; g: number; b: number; a: number }
    export type DomElement =
      | { kind: 'rect'; x: number; y: number; w: number; h: number;
          bg?: RGBA; borderColor?: RGBA; borderWidth?: number; radius?: number }
      | { kind: 'text'; x: number; y: number; w: number; h: number;
          text: string; fontSize: number; fontWeight: number;
          color: RGBA; align: 'left' | 'center' | 'right' }
      | { kind: 'image'; x: number; y: number; w: number; h: number;
          imageId: string; radius?: number };
    export interface DomCapture {
      width: number; height: number; truncated?: boolean;
      elements: DomElement[]; images: Record<string, string>;
    }
    export interface StoredDomCapture extends DomCapture {
      imageData: Record<string, { mime: string; base64: string }>;
    }
    ```

- [ ] **Step 1: Write the failing test** — append to `packages/cli/test/graph.test.ts` inside the `describe('SessionGraph')` block:

```ts
  it('creates dom dir and records domFile via setDom', () => {
    const a = g.ensureNode('https://a.com/', 'Home', vp, 1);
    expect(existsSync(join(dir, 'dom'))).toBe(true);
    expect(a.node.domFile).toBeNull();
    g.setDom(a.node.id, 'dom/0001.json');
    expect(g.data.nodes[0].domFile).toBe('dom/0001.json');
    const saved = JSON.parse(readFileSync(join(dir, 'graph.json'), 'utf8'));
    expect(saved.nodes[0].domFile).toBe('dom/0001.json');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/cli/test/graph.test.ts`
Expected: FAIL — `domFile` undefined / `setDom` is not a function.

- [ ] **Step 3: Implement**

Create `packages/cli/src/dom-types.ts` with exactly the interfaces from the Produces block above.

In `packages/cli/src/graph.ts`:
- Add to `PageNode`: `domFile: string | null;` (after `shotFile`).
- In the constructor, after the shots mkdir: `mkdirSync(join(dir, 'dom'), { recursive: true });`
- In `ensureNode`, add `domFile: null,` to the node literal (after `shotFile: null,`).
- Add method (after `setShot`):

```ts
  setDom(nodeId: string, domFile: string): void {
    const n = this.nodes.find((n) => n.id === nodeId);
    if (n) { n.domFile = domFile; this.save(); }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/cli/test/graph.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(cli): graph stores dom capture files"
```

---

### Task 2: DOM serializer script

**Files:**
- Create: `packages/cli/src/dom-serializer.ts`
- Modify: `packages/cli/test/fixture.ts` (add `/rich.html`)
- Test: `packages/cli/test/dom-serializer.integration.test.ts`

**Interfaces:**
- Consumes: nothing from other modules (self-contained browser script).
- Produces: `SERIALIZE_SCRIPT: string` — a JS IIFE expression; `await page.evaluate(SERIALIZE_SCRIPT)` returns a `DomCapture` (Task 1 shape): full-page width/height, `elements` in DOM order, `images` mapping imageId → src URL, optional `truncated`.

- [ ] **Step 1: Add the rich fixture page** — in `packages/cli/test/fixture.ts`, add after the `TWO` constant:

```ts
// 1x1 red PNG
export const RED_PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const RICH = `<!doctype html><title>Rich</title>
<body style="margin:0">
<h1 id="hd" style="font-size:32px;font-weight:700;text-align:center">Heading Text</h1>
<p id="para">Paragraph content here</p>
<button id="btn" style="background:#2f7cf6;color:#fff;border-radius:6px;border:0;padding:10px 20px">Click Me</button>
<img id="pic" src="${RED_PIXEL}" width="50" height="50">
<svg id="vec" width="40" height="40"><circle cx="20" cy="20" r="15"/></svg>
<div id="hidden" style="display:none">Invisible text</div>
<div id="deep" style="position:absolute;top:2000px;left:10px">Below fold text</div>
</body>`;
```

and route it in the server handler (before the INDEX fallback): `if (req.url === '/rich.html') { res.end(RICH); return; }` — keep the existing `two.html`/`three` handling intact:

```ts
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    if (req.url === '/rich.html') res.end(RICH);
    else if (req.url === '/two.html' || req.url === '/three') res.end(TWO);
    else res.end(INDEX);
  });
```

- [ ] **Step 2: Write the failing test**

`packages/cli/test/dom-serializer.integration.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import { chromium, type Browser } from 'playwright';
import { startFixture } from './fixture.js';
import { SERIALIZE_SCRIPT } from '../src/dom-serializer.js';
import type { DomCapture } from '../src/dom-types.js';

let server: Server;
let baseUrl: string;
let browser: Browser;

beforeAll(async () => {
  ({ url: baseUrl, server } = await startFixture());
  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser.close();
  server.close();
});

describe('SERIALIZE_SCRIPT', () => {
  it('serializes the full page into paint-order primitives', async () => {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await page.goto(baseUrl + 'rich.html');
    const cap = (await page.evaluate(SERIALIZE_SCRIPT)) as DomCapture;

    expect(cap.height).toBeGreaterThanOrEqual(2000);   // full page, not viewport

    const texts = cap.elements.filter((e) => e.kind === 'text');
    const heading = texts.find((t) => t.kind === 'text' && t.text === 'Heading Text');
    expect(heading).toBeDefined();
    if (heading?.kind === 'text') {
      expect(heading.fontWeight).toBeGreaterThanOrEqual(700);
      expect(heading.fontSize).toBe(32);
      expect(heading.align).toBe('center');
    }
    const deep = texts.find((t) => t.kind === 'text' && t.text === 'Below fold text');
    expect(deep).toBeDefined();
    if (deep?.kind === 'text') expect(deep.y).toBeGreaterThanOrEqual(1900);

    // hidden text excluded
    expect(texts.some((t) => t.kind === 'text' && t.text === 'Invisible text')).toBe(false);

    // button background rect (#2f7cf6 -> r=47/255)
    const rects = cap.elements.filter((e) => e.kind === 'rect');
    expect(rects.some((r) => r.kind === 'rect' && r.bg && Math.abs(r.bg.r - 47 / 255) < 0.01)).toBe(true);

    // img -> image element with registered src
    const images = cap.elements.filter((e) => e.kind === 'image');
    expect(images).toHaveLength(1);
    if (images[0].kind === 'image') {
      expect(cap.images[images[0].imageId]).toMatch(/^data:image\/png/);
    }

    // svg becomes a placeholder rect (no crash, no descent)
    expect(cap.elements.some((e) => e.kind === 'rect' && e.w === 40 && e.h === 40)).toBe(true);

    await page.close();
  }, 30_000);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run packages/cli/test/dom-serializer.integration.test.ts`
Expected: FAIL — cannot resolve `../src/dom-serializer.js`.

- [ ] **Step 4: Implement**

`packages/cli/src/dom-serializer.ts`:
```ts
// Browser-side DOM serializer. Evaluated as an expression at capture time;
// returns a DomCapture (see dom-types.ts). Kept as a plain string like
// capture-script.ts so it survives bundling untouched.
export const SERIALIZE_SCRIPT = `(() => {
  const MAX_ELEMENTS = 5000;
  const elements = [];
  const images = {};
  const urlToId = new Map();
  let imageSeq = 0;
  let truncated = false;

  const parseColor = (str) => {
    const m = /rgba?\\(([^)]+)\\)/.exec(str || '');
    if (!m) return null;
    const parts = m[1].split(',').map((s) => parseFloat(s));
    const a = parts.length > 3 ? parts[3] : 1;
    if (a === 0) return null;
    return { r: parts[0] / 255, g: parts[1] / 255, b: parts[2] / 255, a };
  };

  const imageId = (url) => {
    if (!urlToId.has(url)) {
      const id = 'img' + (++imageSeq);
      urlToId.set(url, id);
      images[id] = url;
    }
    return urlToId.get(url);
  };

  const pageRect = (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + window.scrollX, y: r.y + window.scrollY, w: r.width, h: r.height };
  };

  const visit = (el) => {
    if (truncated || !(el instanceof Element)) return;
    if (elements.length >= MAX_ELEMENTS) { truncated = true; return; }
    const tag = el.tagName.toLowerCase();
    if (el.id === '__wtf_panel' || tag === 'script' || tag === 'style' || tag === 'noscript') return;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return;
    const rect = pageRect(el);
    if (rect.w <= 0 || rect.h <= 0) return;

    if (tag === 'svg' || tag === 'canvas' || tag === 'video') {
      elements.push({ kind: 'rect', x: rect.x, y: rect.y, w: rect.w, h: rect.h, bg: { r: 0.9, g: 0.9, b: 0.9, a: 1 } });
      return; // placeholder; do not descend
    }

    const radius = parseFloat(cs.borderTopLeftRadius) || 0;

    if (tag === 'img' && el.currentSrc) {
      const entry = { kind: 'image', x: rect.x, y: rect.y, w: rect.w, h: rect.h, imageId: imageId(el.currentSrc) };
      if (radius) entry.radius = radius;
      elements.push(entry);
    } else {
      const bgImg = /url\\(["']?([^"')]+)["']?\\)/.exec(cs.backgroundImage || '');
      if (bgImg) {
        const entry = { kind: 'image', x: rect.x, y: rect.y, w: rect.w, h: rect.h, imageId: imageId(bgImg[1]) };
        if (radius) entry.radius = radius;
        elements.push(entry);
      } else {
        const bg = parseColor(cs.backgroundColor);
        const borderWidth = parseFloat(cs.borderTopWidth) || 0;
        const borderColor = borderWidth > 0 ? parseColor(cs.borderTopColor) : null;
        if (bg || borderColor) {
          const entry = { kind: 'rect', x: rect.x, y: rect.y, w: rect.w, h: rect.h };
          if (bg) entry.bg = bg;
          if (borderColor) { entry.borderColor = borderColor; entry.borderWidth = borderWidth; }
          if (radius) entry.radius = radius;
          elements.push(entry);
        }
      }

      const direct = Array.from(el.childNodes)
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent)
        .join('').replace(/\\s+/g, ' ').trim();
      if (direct) {
        const color = parseColor(cs.color) || { r: 0, g: 0, b: 0, a: 1 };
        const align = cs.textAlign === 'center' ? 'center' : cs.textAlign === 'right' ? 'right' : 'left';
        elements.push({
          kind: 'text', x: rect.x, y: rect.y, w: rect.w, h: rect.h,
          text: direct.slice(0, 2000),
          fontSize: parseFloat(cs.fontSize) || 14,
          fontWeight: parseInt(cs.fontWeight, 10) || 400,
          color: color, align: align,
        });
      }
    }

    for (const child of el.children) visit(child);
  };

  for (const child of document.body.children) visit(child);

  const doc = document.documentElement;
  const result = {
    width: Math.max(doc.scrollWidth, doc.clientWidth),
    height: Math.max(doc.scrollHeight, doc.clientHeight),
    elements: elements,
    images: images,
  };
  if (truncated) result.truncated = true;
  return result;
})()`;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run packages/cli/test/dom-serializer.integration.test.ts`
Expected: 1 passed. If the button rect assertion fails, debug by printing `cap.elements` — the button must yield both a `rect` (blue bg, radius 6) and a `text` ("Click Me").

- [ ] **Step 6: Run existing recorder integration tests (fixture changed)**

Run: `npx vitest run packages/cli/test/recorder.integration.test.ts`
Expected: all pass (INDEX/TWO untouched).

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(cli): browser-side DOM serializer"
```

---

### Task 3: Recorder interactive mode + CLI flag

**Files:**
- Modify: `packages/cli/src/recorder.ts`
- Modify: `packages/cli/src/index.ts`
- Test: `packages/cli/test/recorder.integration.test.ts` (append)

**Interfaces:**
- Consumes: `SERIALIZE_SCRIPT` (Task 2), `DomCapture`/`StoredDomCapture` (Task 1), `SessionGraph.setDom` (Task 1).
- Produces: `RecordOptions.interactive?: boolean`. In interactive mode `capture()` writes `dom/NNNN.json` (a `StoredDomCapture`) and calls `setDom`; no screenshot. CLI flag `--interactive` on `record`.

- [ ] **Step 1: Write the failing test** — append to `packages/cli/test/recorder.integration.test.ts`:

```ts
  it('interactive mode captures serialized DOM instead of screenshots', async () => {
    const out6 = mkdtempSync(join(tmpdir(), 'wtf-it6-'));
    const rec = new Recorder({
      url: baseUrl + 'rich.html',
      out: out6,
      viewport: { width: 800, height: 600 },
      headless: true,
      interactive: true,
    });
    await rec.start();
    const page = rec.page;

    await page.waitForSelector('#__wtf_capture_btn');
    await page.click('#__wtf_capture_btn');
    await page.waitForTimeout(700);
    await rec.stop();

    const graph: GraphData = JSON.parse(readFileSync(join(out6, 'graph.json'), 'utf8'));
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0].shotFile).toBeNull();
    expect(graph.nodes[0].domFile).toBe('dom/0001.json');

    const dom = JSON.parse(readFileSync(join(out6, graph.nodes[0].domFile!), 'utf8'));
    expect(dom.height).toBeGreaterThanOrEqual(2000);
    expect(dom.elements.some((e: { kind: string; text?: string }) => e.kind === 'text' && e.text === 'Below fold text')).toBe(true);
    // data-URI image bytes captured without network
    const img = dom.elements.find((e: { kind: string }) => e.kind === 'image');
    expect(img).toBeDefined();
    expect(dom.imageData[img.imageId].base64.length).toBeGreaterThan(10);
    expect(dom.imageData[img.imageId].mime).toBe('image/png');
  }, 60_000);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/cli/test/recorder.integration.test.ts`
Expected: new test FAILS (interactive not an option / domFile null); others pass.

- [ ] **Step 3: Implement recorder changes**

In `packages/cli/src/recorder.ts`:

Add imports:
```ts
import { appendFileSync, writeFileSync } from 'node:fs';
import { SERIALIZE_SCRIPT } from './dom-serializer.js';
import type { DomCapture, StoredDomCapture } from './dom-types.js';
```
(replace the existing `appendFileSync` import line).

Add to `RecordOptions`: `interactive?: boolean;`

Add field after `shotSeq`: `private domSeq = 0;`

In `capture()`, replace the screenshot block (`const shotFile = ...` through the `finally` close) with:

```ts
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
```

Add methods (after `capture()`):

```ts
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
      if (src.startsWith('data:')) {
        const m = /^data:([^;,]+)?(;base64)?,(.*)$/.exec(src);
        if (!m) return null;
        const mime = m[1] || 'image/png';
        const base64 = m[2] ? m[3] : Buffer.from(decodeURIComponent(m[3])).toString('base64');
        return { mime, base64 };
      }
      const resp = await this.context.request.get(src);
      if (!resp.ok()) return null;
      const mime = resp.headers()['content-type']?.split(';')[0] || 'image/png';
      return { mime, base64: (await resp.body()).toString('base64') };
    } catch {
      return null;
    }
  }
```

Note: the serializer skips `#__wtf_panel` itself, so no panel hide/show in the dom path.

- [ ] **Step 4: Wire the CLI flag** — in `packages/cli/src/index.ts`:

Add after the `--viewport` option line:
```ts
  .option('--interactive', 'capture pages as editable Figma layers (DOM) instead of screenshots')
```
Update the action's opts type: `{ url: string; out?: string; profile?: string; viewport: string; interactive?: boolean }` and pass `interactive: opts.interactive,` in the `new Recorder({...})` options.

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run packages/cli && npx tsc --noEmit -p packages/cli/tsconfig.json`
Expected: all pass, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(cli): --interactive DOM capture mode"
```

---

### Task 4: Exporter bundle v2

**Files:**
- Modify: `packages/cli/src/exporter.ts`
- Test: `packages/cli/test/exporter.test.ts` (modify + append)

**Interfaces:**
- Consumes: `PageNode.domFile` (Task 1), `StoredDomCapture` (Task 1).
- Produces: bundle `version: 2`; node shape `{id,url,title,note?,viewport,image,dom}` where `dom = {width,height,truncated?,elements,images: Record<id,{mime,base64}>} | null`. Screenshot nodes unchanged (downscale + bbox rescale); dom nodes: no rescale of their outgoing edges.

- [ ] **Step 1: Update existing tests + add dom test** — in `packages/cli/test/exporter.test.ts`:

Change the existing assertion `expect(bundle.version).toBe(1);` → `expect(bundle.version).toBe(2);`.

The `GraphData` fixtures in this file gain `domFile: null` on every node literal (the type now requires it).

Append inside the `exportSession` describe:
```ts
  it('bundles dom captures verbatim without rescaling their edges', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wtf-exp4-'));
    mkdirSync(join(dir, 'shots'));
    mkdirSync(join(dir, 'dom'));
    const stored = {
      width: 900, height: 5000,
      elements: [
        { kind: 'text', x: 10, y: 20, w: 100, h: 30, text: 'Hi', fontSize: 16, fontWeight: 400, color: { r: 0, g: 0, b: 0, a: 1 }, align: 'left' },
      ],
      images: { img1: 'https://a.com/x.png' },
      imageData: { img1: { mime: 'image/png', base64: 'QUJD' } },
    };
    writeFileSync(join(dir, 'dom', '0001.json'), JSON.stringify(stored));
    const graph: GraphData = {
      startUrl: 'https://a.com/',
      recordedAt: '2026-07-03T00:00:00Z',
      nodes: [
        { id: 'p1', url: 'https://a.com/', title: 'Dom', shotFile: null, domFile: 'dom/0001.json', viewport: { width: 900, height: 600 }, timestamp: 1 },
        { id: 'p2', url: 'https://a.com/x', title: 'X', shotFile: null, domFile: null, viewport: { width: 900, height: 600 }, timestamp: 2 },
      ],
      edges: [
        { from: 'p1', to: 'p2', label: 'Go', bbox: { x: 700, y: 4500, w: 100, h: 40 }, timestamp: 3 },
      ],
    };
    writeFileSync(join(dir, 'graph.json'), JSON.stringify(graph));
    const out = join(dir, 'figma-import.json');
    await exportSession(dir, out);
    const bundle = JSON.parse(readFileSync(out, 'utf8'));
    expect(bundle.version).toBe(2);
    expect(bundle.nodes[0].image).toBeNull();
    expect(bundle.nodes[0].dom.height).toBe(5000);
    expect(bundle.nodes[0].dom.elements).toHaveLength(1);
    expect(bundle.nodes[0].dom.images.img1).toEqual({ mime: 'image/png', base64: 'QUJD' });
    // dom edges NOT rescaled even though height 5000 > 4096
    expect(bundle.edges[0].bbox).toEqual({ x: 700, y: 4500, w: 100, h: 40 });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/cli/test/exporter.test.ts`
Expected: new test FAILS (`dom` undefined / version 1); existing may fail on version assertion until implementation.

- [ ] **Step 3: Implement** — in `packages/cli/src/exporter.ts`:

Add import: `import type { StoredDomCapture } from './dom-types.js';`

In `exportSession`'s node loop, after the image block, add dom handling, and include `dom` in the pushed node:

```ts
    let dom: {
      width: number; height: number; truncated?: boolean;
      elements: StoredDomCapture['elements'];
      images: StoredDomCapture['imageData'];
    } | null = null;
    if (n.domFile) {
      try {
        const raw: StoredDomCapture = JSON.parse(readFileSync(join(sessionDir, n.domFile), 'utf8'));
        dom = {
          width: raw.width,
          height: raw.height,
          ...(raw.truncated ? { truncated: true } : {}),
          elements: raw.elements,
          images: raw.imageData ?? {},
        };
      } catch (err) {
        throw new Error(`failed to read dom capture for node ${n.id} (${n.domFile}): ${String(err)}`, { cause: err });
      }
    }
    nodes.push({
      id: n.id, url: n.url, title: n.title,
      ...(n.note ? { note: n.note } : {}),
      viewport: n.viewport, image, dom,
    });
```
(The existing `nodes.push` is replaced by this one — `image` logic above it unchanged. Nodes with `domFile` never enter the image branch because their `shotFile` is null, so `factors` has no entry and their edges keep factor 1 — exactly the no-rescale requirement.)

Change `version: 1` → `version: 2` in the bundle literal.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/cli/test/exporter.test.ts`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(cli): bundle v2 with dom captures"
```

---

### Task 5: Plugin validation for v2

**Files:**
- Modify: `packages/figma-plugin/src/validate.ts`
- Test: `packages/figma-plugin/test/validate.test.ts` (append)

**Interfaces:**
- Consumes: existing `validateBundle`.
- Produces: accepts `version` 1 or 2. `BundleNode.dom?: BundleDom | null` where:
  ```ts
  export interface DomRGBA { r: number; g: number; b: number; a: number }
  export type BundleDomElement =
    | { kind: 'rect'; x: number; y: number; w: number; h: number; bg?: DomRGBA; borderColor?: DomRGBA; borderWidth?: number; radius?: number }
    | { kind: 'text'; x: number; y: number; w: number; h: number; text: string; fontSize: number; fontWeight: number; color: DomRGBA; align: 'left' | 'center' | 'right' }
    | { kind: 'image'; x: number; y: number; w: number; h: number; imageId: string; radius?: number };
  export interface BundleDom {
    width: number; height: number; truncated?: boolean;
    elements: BundleDomElement[];
    images: Record<string, { mime: string; base64?: string }>;
  }
  ```
  Node validity: previous checks AND `dom` (when present and non-null) has numeric width/height and array elements — else fatal `node at index ${i} has malformed dom`.

- [ ] **Step 1: Write the failing tests** — append to `packages/figma-plugin/test/validate.test.ts`:

```ts
  it('accepts version 2 bundles with dom nodes', () => {
    const r = validateBundle({
      ...good,
      version: 2,
      nodes: [
        { ...good.nodes[0], dom: { width: 900, height: 5000, elements: [], images: {} }, image: null },
        good.nodes[1],
      ],
    });
    expect(r.errors).toEqual([]);
    expect(r.bundle?.nodes[0].dom?.height).toBe(5000);
  });

  it('still accepts version 1 bundles', () => {
    expect(validateBundle(good).bundle).not.toBeNull();
  });

  it('rejects malformed dom', () => {
    const r = validateBundle({
      ...good,
      version: 2,
      nodes: [{ ...good.nodes[0], dom: { width: 'wide', elements: null } }, good.nodes[1]],
    });
    expect(r.bundle).toBeNull();
    expect(r.errors[0]).toMatch(/malformed dom/);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/figma-plugin/test/validate.test.ts`
Expected: v2 test FAILS on version error.

- [ ] **Step 3: Implement** — in `packages/figma-plugin/src/validate.ts`:

Add the `DomRGBA`/`BundleDomElement`/`BundleDom` exports from the Produces block. Add `dom?: BundleDom | null;` to `BundleNode`. Change `Bundle.version` type to `1 | 2`.

Version check: `if (b.version !== 1 && b.version !== 2) errors.push(...)` (message: `unsupported bundle version: ${String(b.version)} (expected 1 or 2)`).

In the per-node validation loop, add after the existing node checks:

```ts
    const dom = (node as { dom?: unknown }).dom;
    if (dom !== undefined && dom !== null) {
      const d = dom as Record<string, unknown>;
      if (typeof d.width !== 'number' || typeof d.height !== 'number' || !Array.isArray(d.elements)) {
        errors.push(`node at index ${i} has malformed dom`);
      }
    }
```

Bundle construction keeps `version: b.version as 1 | 2`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/figma-plugin/test/validate.test.ts`
Expected: 10 passed.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(plugin): validate bundle v2 dom nodes"
```

---

### Task 6: Plugin rendering of dom nodes

**Files:**
- Create: `packages/figma-plugin/src/dom-render.ts`
- Modify: `packages/figma-plugin/src/code.ts`
- Modify: `packages/figma-plugin/src/ui.html`
- Test: `packages/figma-plugin/test/dom-render.test.ts`

**Interfaces:**
- Consumes: `BundleDom`, `BundleDomElement`, `DomRGBA` (Task 5).
- Produces: `packages/figma-plugin/src/dom-render.ts`:
  ```ts
  export function fontStyleForWeight(weight: number): 'Regular' | 'Bold';
  export function solidPaint(c: DomRGBA): { type: 'SOLID'; color: { r: number; g: number; b: number }; opacity: number };
  ```
  UI→main message added: `{type:'dom-image', nodeId, imageId, bytes: Uint8Array}`.

- [ ] **Step 1: Write the failing test**

`packages/figma-plugin/test/dom-render.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { fontStyleForWeight, solidPaint } from '../src/dom-render.js';

describe('fontStyleForWeight', () => {
  it('maps <600 to Regular, >=600 to Bold', () => {
    expect(fontStyleForWeight(400)).toBe('Regular');
    expect(fontStyleForWeight(599)).toBe('Regular');
    expect(fontStyleForWeight(600)).toBe('Bold');
    expect(fontStyleForWeight(900)).toBe('Bold');
  });
});

describe('solidPaint', () => {
  it('splits alpha into opacity', () => {
    expect(solidPaint({ r: 0.1, g: 0.2, b: 0.3, a: 0.5 })).toEqual({
      type: 'SOLID', color: { r: 0.1, g: 0.2, b: 0.3 }, opacity: 0.5,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/figma-plugin/test/dom-render.test.ts`
Expected: FAIL — cannot resolve `../src/dom-render.js`.

- [ ] **Step 3: Implement helpers**

`packages/figma-plugin/src/dom-render.ts`:
```ts
import type { DomRGBA } from './validate.js';

export function fontStyleForWeight(weight: number): 'Regular' | 'Bold' {
  return weight >= 600 ? 'Bold' : 'Regular';
}

export function solidPaint(c: DomRGBA): { type: 'SOLID'; color: { r: number; g: number; b: number }; opacity: number } {
  return { type: 'SOLID', color: { r: c.r, g: c.g, b: c.b }, opacity: c.a };
}
```

Run: `npx vitest run packages/figma-plugin/test/dom-render.test.ts` — 2 passed.

- [ ] **Step 4: Wire main thread** — in `packages/figma-plugin/src/code.ts`:

Add imports: `import { fontStyleForWeight, solidPaint } from './dom-render.js';` and extend the validate import with `type BundleDom`.

Add beside `images`: `const domImages = new Map<string, Uint8Array>();` and clear it wherever `images.clear()` runs.

Extend `figma.ui.onmessage` msg type with `imageId?: string` and add branch:
```ts
  } else if (msg.type === 'dom-image' && msg.nodeId && msg.imageId && msg.bytes) {
    domImages.set(`${msg.nodeId}/${msg.imageId}`, msg.bytes);
```

In `build()`:
- Font loading becomes: `await Promise.all([figma.loadFontAsync({ family: 'Inter', style: 'Regular' }), figma.loadFontAsync({ family: 'Inter', style: 'Bold' })]);`
- Sizes: dom first — `n.dom ? { width: n.dom.width, height: n.dom.height } : n.image ? {…image dims…} : {…viewport…}`.
- In the frame loop, before the existing image-fill logic, branch on dom:

```ts
    if (n.dom) {
      frame.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
      renderDom(frame, n.id, n.dom);
      if (n.dom.truncated) status(`warning: dom capture truncated for ${n.url}`);
    } else if (bytes) {
      // existing image fill branch unchanged
    } else {
      // existing gray placeholder branch unchanged
    }
```

Add function (top level in code.ts):
```ts
function renderDom(frame: FrameNode, nodeId: string, dom: BundleDom): void {
  for (const el of dom.elements) {
    if (el.kind === 'rect') {
      const r = figma.createRectangle();
      r.x = el.x; r.y = el.y;
      r.resize(Math.max(el.w, 1), Math.max(el.h, 1));
      r.fills = el.bg ? [solidPaint(el.bg)] : [];
      if (el.borderColor) {
        r.strokes = [solidPaint(el.borderColor)];
        r.strokeWeight = el.borderWidth ?? 1;
      }
      if (el.radius) r.cornerRadius = el.radius;
      frame.appendChild(r);
    } else if (el.kind === 'text') {
      const t = figma.createText();
      t.fontName = { family: 'Inter', style: fontStyleForWeight(el.fontWeight) };
      t.characters = el.text;
      t.fontSize = Math.max(el.fontSize, 1);
      t.fills = [solidPaint(el.color)];
      t.textAlignHorizontal = el.align === 'center' ? 'CENTER' : el.align === 'right' ? 'RIGHT' : 'LEFT';
      t.textAutoResize = 'NONE';
      t.x = el.x; t.y = el.y;
      t.resize(Math.max(el.w, 1), Math.max(el.h, 1));
      frame.appendChild(t);
    } else {
      const r = figma.createRectangle();
      r.x = el.x; r.y = el.y;
      r.resize(Math.max(el.w, 1), Math.max(el.h, 1));
      const bytes = domImages.get(`${nodeId}/${el.imageId}`);
      let filled = false;
      if (bytes) {
        try {
          r.fills = [{ type: 'IMAGE', imageHash: figma.createImage(bytes).hash, scaleMode: 'FILL' }];
          filled = true;
        } catch { /* fall through to placeholder */ }
      }
      if (!filled) r.fills = [{ type: 'SOLID', color: { r: 0.85, g: 0.85, b: 0.85 } }];
      if (el.radius) r.cornerRadius = el.radius;
      frame.appendChild(r);
    }
  }
}
```

- [ ] **Step 5: Wire UI** — in `packages/figma-plugin/src/ui.html`, in the file-change handler after the existing screenshot `imagePayloads` loop, add:

```js
    const domImagePayloads = [];
    for (const node of bundle.nodes || []) {
      if (node.dom && node.dom.images) {
        for (const [imageId, img] of Object.entries(node.dom.images)) {
          if (img.base64) {
            domImagePayloads.push({ nodeId: node.id, imageId, bytes: b64ToBytes(img.base64) });
            delete img.base64;
          }
        }
      }
    }
```
and after the existing image postMessage loop, before `build`:
```js
    for (const p of domImagePayloads) {
      parent.postMessage({ pluginMessage: { type: 'dom-image', nodeId: p.nodeId, imageId: p.imageId, bytes: p.bytes } }, '*');
    }
```

- [ ] **Step 6: Build + full suite**

Run: `npm run build --workspaces && npx vitest run && npx tsc --noEmit -p packages/figma-plugin/tsconfig.json`
Expected: build succeeds, all tests pass, tsc clean.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(plugin): render dom captures as editable layers"
```

---

### Task 7: E2E + README

**Files:**
- Modify: `README.md`
- Test: none new (manual + existing suite)

- [ ] **Step 1: End-to-end sanity via real CLI**

```bash
npm run build --workspaces
node packages/cli/dist/index.js record --help
```
Expected: `--interactive` listed.

Then drive the real built CLI end-to-end headlessly with a scratch script (outside the repo, e.g. in the session scratchpad — do not commit it):

```js
// e2e-interactive.mjs — run with: node e2e-interactive.mjs <scratch-dir>
import { Recorder } from '/Users/manan/asgard/wtf/packages/cli/dist/recorder.js';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const out = process.argv[2] + '/session';
const rec = new Recorder({ url: 'https://example.com/', out, viewport: { width: 1280, height: 800 }, headless: true, interactive: true });
await rec.start();
await rec.page.waitForSelector('#__wtf_capture_btn');
await rec.page.click('#__wtf_capture_btn');
await rec.page.waitForTimeout(800);
await rec.stop();

const bundleFile = process.argv[2] + '/wtf-int.json';
execFileSync('node', ['/Users/manan/asgard/wtf/packages/cli/dist/index.js', 'export', out, '--out', bundleFile], { stdio: 'inherit' });
const b = JSON.parse(readFileSync(bundleFile, 'utf8'));
console.log(b.version, b.nodes[0].dom ? 'dom:' + b.nodes[0].dom.elements.length + ' elements' : 'NO DOM');
```
Expected output: `2 dom:<n> elements` with n > 0. If example.com is unreachable from the sandbox, serve the test fixture's `/rich.html` locally (import `startFixture` from `packages/cli/test/fixture.ts` via tsx, or inline a tiny http server) and point `url` at it — same assertions.

- [ ] **Step 2: Import into Figma (manual, requires desktop)**

Figma → Plugins → Development → wtf importer → pick the exported v2 JSON. Expected: frame with real text layers (selectable/editable), colored rects, images; hotspots/arrows work as before. If Figma desktop unavailable, defer to user with instructions.

- [ ] **Step 3: Update README** — in `README.md`, after the Record section's launch-flag paragraph, add:

```markdown
### Interactive mode (editable layers)

```bash
node packages/cli/dist/index.js record --url https://your-app.com --interactive
```

Captures the page's DOM instead of a screenshot. In Figma you get real,
editable layers — text you can retype, rectangles you can restyle, images —
covering the whole page (content clipped in screenshots, like below-the-fold
or scroll containers, is included). Fidelity notes: all text renders as
Inter, gradients/shadows are approximated or dropped, and inline SVG/canvas/
video become gray placeholders. Arrows, hotspots, and prototype wiring work
the same as screenshot mode.
```

- [ ] **Step 4: Full suite + commit**

```bash
npx vitest run
git add -A && git commit -m "docs: interactive mode README + e2e verification"
```
