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

    // inline svg captured as markup, not descended into
    const svgs = cap.elements.filter((e) => e.kind === 'svg');
    expect(svgs).toHaveLength(1);
    if (svgs[0].kind === 'svg') {
      expect(svgs[0].w).toBe(40);
      expect(cap.svgs[svgs[0].svgId]).toContain('<circle');
    }

    // single-line text carries no wrap flag; multi-line text is marked wrap
    if (heading?.kind === 'text') expect(heading.wrap).toBeUndefined();
    const wrapped = texts.find((t) => t.kind === 'text' && t.text.startsWith('This is a longer sentence'));
    expect(wrapped).toBeDefined();
    if (wrapped?.kind === 'text') expect(wrapped.wrap).toBe(true);

    await page.close();
  }, 30_000);
});
