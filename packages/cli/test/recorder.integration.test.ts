import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { startFixture } from './fixture.js';
import { Recorder } from '../src/recorder.js';
import type { GraphData } from '../src/graph.js';

let server: Server;
let baseUrl: string;
let out: string;

beforeAll(async () => {
  ({ url: baseUrl, server } = await startFixture());
  out = mkdtempSync(join(tmpdir(), 'wtf-it-'));
});

afterAll(() => server.close());

describe('Recorder', () => {
  it('captures pages only on explicit Capture clicks, with click edges between captured pages', async () => {
    const rec = new Recorder({
      url: baseUrl,
      out,
      viewport: { width: 800, height: 600 },
      headless: true,
    });
    await rec.start();
    const page = rec.page;

    await page.waitForSelector('#__wtf_panel'); // control panel injected
    await page.click('#__wtf_capture_btn');     // capture entry page -> p1
    await page.waitForTimeout(500);
    rec.note('entry page');

    await page.click('#go');                    // full page load -> /two.html
    await page.waitForSelector('#__wtf_capture_btn');
    await page.click('#__wtf_capture_btn');     // capture -> p2, edge p1->p2
    await page.waitForTimeout(500);

    await page.click('#spa');                   // SPA pushState -> /three
    await page.waitForTimeout(300);
    await page.click('#__wtf_capture_btn');     // capture -> p3, edge p2->p3
    await page.waitForTimeout(500);

    await page.click('#spa2');                  // SPA pushState -> /four, NOT captured
    await page.waitForTimeout(300);

    await rec.stop();

    const graph: GraphData = JSON.parse(readFileSync(join(out, 'graph.json'), 'utf8'));
    // only explicitly captured pages become nodes — /four never captured
    expect(graph.nodes).toHaveLength(3);
    expect(graph.nodes.map((n) => new URL(n.url).pathname)).toEqual(['/', '/two.html', '/three']);
    expect(graph.nodes[0].note).toBe('entry page');

    expect(graph.edges).toHaveLength(2);
    expect(graph.edges[0]).toMatchObject({ from: 'p1', to: 'p2', label: 'Go to Two' });
    expect(graph.edges[1]).toMatchObject({ from: 'p2', to: 'p3', label: 'Open Three' });
    for (const e of graph.edges) {
      expect(e.bbox.w).toBeGreaterThan(0);
      expect(e.bbox.h).toBeGreaterThan(0);
    }

    for (const n of graph.nodes) {
      expect(n.shotFile).not.toBeNull();
      expect(existsSync(join(out, n.shotFile!))).toBe(true);
    }

    expect(existsSync(join(out, 'events.jsonl'))).toBe(true);
  }, 60_000);

  it('captures pages opened in new tabs, with the opening click as edge', async () => {
    const out3 = mkdtempSync(join(tmpdir(), 'wtf-it3-'));
    const rec = new Recorder({
      url: baseUrl,
      out: out3,
      viewport: { width: 800, height: 600 },
      headless: true,
    });
    await rec.start();
    const page = rec.page;

    await page.waitForSelector('#__wtf_capture_btn');
    await page.click('#__wtf_capture_btn');       // capture home -> p1
    await page.waitForTimeout(500);

    const [popup] = await Promise.all([
      page.context().waitForEvent('page'),
      page.click('#blank'),                        // target=_blank -> new tab
    ]);
    await popup.waitForSelector('#__wtf_capture_btn');
    await popup.click('#__wtf_capture_btn');       // capture in the NEW tab -> p2
    await popup.waitForTimeout(500);

    await rec.stop();

    const graph: GraphData = JSON.parse(readFileSync(join(out3, 'graph.json'), 'utf8'));
    expect(graph.nodes).toHaveLength(2);
    expect(graph.nodes.map((n) => new URL(n.url).pathname)).toEqual(['/', '/two.html']);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({ from: 'p1', to: 'p2', label: 'Open Two New Tab' });
    for (const n of graph.nodes) {
      expect(n.shotFile).not.toBeNull();
      expect(existsSync(join(out3, n.shotFile!))).toBe(true);
    }
  }, 60_000);

  it('captures multiple states of the same URL, connected by the state-changing click', async () => {
    const out4 = mkdtempSync(join(tmpdir(), 'wtf-it4-'));
    const rec = new Recorder({
      url: baseUrl,
      out: out4,
      viewport: { width: 800, height: 600 },
      headless: true,
    });
    await rec.start();
    const page = rec.page;

    await page.waitForSelector('#__wtf_capture_btn');
    await page.click('#__wtf_capture_btn');       // capture base state -> p1
    await page.waitForTimeout(500);

    await page.click('#modal');                    // DOM change, URL unchanged
    await page.waitForTimeout(200);
    await page.click('#__wtf_capture_btn');        // capture modal state -> p2 (same URL)
    await page.waitForTimeout(500);

    await rec.stop();

    const graph: GraphData = JSON.parse(readFileSync(join(out4, 'graph.json'), 'utf8'));
    expect(graph.nodes).toHaveLength(2);
    expect(graph.nodes.map((n) => new URL(n.url).pathname)).toEqual(['/', '/']);
    expect(graph.nodes[0].shotFile).not.toBe(graph.nodes[1].shotFile);

    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({ from: 'p1', to: 'p2', label: 'Open Modal' });

    await rec.stop();
  }, 60_000);

  it('does not create an edge between captures with no click in between', async () => {
    const out5 = mkdtempSync(join(tmpdir(), 'wtf-it5-'));
    const rec = new Recorder({
      url: baseUrl,
      out: out5,
      viewport: { width: 800, height: 600 },
      headless: true,
    });
    await rec.start();
    const page = rec.page;

    await page.waitForSelector('#__wtf_capture_btn');
    await page.click('#__wtf_capture_btn');       // p1
    await page.waitForTimeout(500);
    await page.click('#__wtf_capture_btn');       // p2 — no page click between
    await page.waitForTimeout(500);

    await rec.stop();

    const graph: GraphData = JSON.parse(readFileSync(join(out5, 'graph.json'), 'utf8'));
    expect(graph.nodes).toHaveLength(2);          // every Capture = its own snapshot
    expect(graph.edges).toHaveLength(0);
  }, 60_000);

  it('does not record panel clicks as page clicks and restores panel after screenshot', async () => {
    const out2 = mkdtempSync(join(tmpdir(), 'wtf-it2-'));
    const rec = new Recorder({
      url: baseUrl,
      out: out2,
      viewport: { width: 800, height: 600 },
      headless: true,
    });
    await rec.start();
    const page = rec.page;

    await page.waitForSelector('#__wtf_panel');
    await page.click('#__wtf_capture_btn');
    await page.waitForTimeout(500);

    // panel visible again after the screenshot hid it
    const display = await page.$eval('#__wtf_panel', (el) => (el as HTMLElement).style.display);
    expect(display).not.toBe('none');

    // capture-button click must not be logged as a page click event
    const events = readFileSync(join(out2, 'events.jsonl'), 'utf8')
      .trim().split('\n').map((l) => JSON.parse(l));
    expect(events.filter((e) => e.type === 'click')).toHaveLength(0);

    await rec.stop();
  }, 60_000);

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
});
