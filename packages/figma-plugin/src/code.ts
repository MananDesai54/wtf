import { validateBundle, type Bundle, type BundleDom } from './validate.js';
import { computeLayout, type Size } from './layout.js';
import { fontStyleForWeight, solidPaint } from './dom-render.js';

figma.showUI(__html__, { width: 340, height: 220 });

let pendingBundle: Bundle | null = null;
let pendingWarnings: string[] = [];
const images = new Map<string, Uint8Array>();
const domImages = new Map<string, Uint8Array>();

const status = (message: string) => figma.ui.postMessage({ type: 'status', message });
const fail = (message: string) => figma.ui.postMessage({ type: 'error', message });

figma.ui.onmessage = async (msg: { type: string; json?: string; nodeId?: string; imageId?: string; bytes?: Uint8Array }) => {
  if (msg.type === 'bundle' && msg.json) {
    const { bundle, errors, warnings } = validateBundle(JSON.parse(msg.json));
    if (!bundle) { fail(errors.join('; ')); return; }
    pendingBundle = bundle;
    pendingWarnings = warnings;
    images.clear();
    domImages.clear();
    status(`bundle ok: ${bundle.nodes.length} pages, ${bundle.edges.length} connections`);
  } else if (msg.type === 'image' && msg.nodeId && msg.bytes) {
    images.set(msg.nodeId, msg.bytes);
  } else if (msg.type === 'dom-image' && msg.nodeId && msg.imageId && msg.bytes) {
    domImages.set(`${msg.nodeId}/${msg.imageId}`, msg.bytes);
  } else if (msg.type === 'build') {
    if (!pendingBundle) { fail('no bundle loaded'); return; }
    try {
      await build(pendingBundle, pendingWarnings);
    } catch (err) {
      fail(String(err));
    }
  }
};

function makeArrow(from: { x: number; y: number }, to: { x: number; y: number }): LineNode {
  const line = figma.createLine();
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  line.resize(Math.max(Math.hypot(dx, dy), 1), 0);
  line.x = from.x;
  line.y = from.y;
  line.rotation = (-Math.atan2(dy, dx) * 180) / Math.PI;
  line.strokes = [{ type: 'SOLID', color: { r: 0.05, g: 0.45, b: 1 } }];
  line.strokeWeight = 2;
  line.strokeCap = 'ARROW_LINES';
  return line;
}

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
      if (!el.text) continue;
      const t = figma.createText();
      t.fontName = { family: 'Inter', style: fontStyleForWeight(el.fontWeight) };
      t.characters = el.text;
      t.fontSize = Math.max(el.fontSize, 1);
      t.fills = [solidPaint(el.color)];
      t.textAlignHorizontal = el.align === 'center' ? 'CENTER' : el.align === 'right' ? 'RIGHT' : 'LEFT';
      t.x = el.x;
      if (el.wrap) {
        // browser wrapped this text: keep the box width, let height grow
        t.textAutoResize = 'HEIGHT';
        t.y = el.y;
        t.resize(Math.max(el.w, 1), Math.max(el.h, 1));
      } else {
        // single line: never re-wrap (Inter is often wider than the source
        // font); center vertically inside the original box
        t.textAutoResize = 'WIDTH_AND_HEIGHT';
        t.y = el.y + Math.max(0, (el.h - t.height) / 2);
      }
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

async function build(bundle: Bundle, warnings: string[]): Promise<void> {
  await Promise.all([
    figma.loadFontAsync({ family: 'Inter', style: 'Regular' }),
    figma.loadFontAsync({ family: 'Inter', style: 'Bold' }),
  ]);
  for (const w of warnings) status(`warning: ${w}`);

  const sizes = new Map<string, Size>();
  for (const n of bundle.nodes) {
    sizes.set(n.id, n.dom
      ? { width: n.dom.width, height: n.dom.height }
      : n.image
        ? { width: n.image.width, height: n.image.height }
        : { width: n.viewport.width, height: n.viewport.height });
  }
  const placements = computeLayout(bundle.nodes.map((n) => n.id), bundle.edges, sizes);

  const frames = new Map<string, FrameNode>();
  const created: SceneNode[] = [];

  try {
    for (const n of bundle.nodes) {
      const p = placements.get(n.id)!;
      const s = sizes.get(n.id)!;
      const frame = figma.createFrame();
      frame.name = `${n.title || 'untitled'} — ${n.url}`;
      frame.x = p.x;
      frame.y = p.y;
      frame.resize(Math.max(s.width, 1), Math.max(s.height, 1));
      const bytes = images.get(n.id);
      if (n.dom) {
        frame.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
        renderDom(frame, n.id, n.dom);
        if (n.dom.truncated) status(`warning: dom capture truncated for ${n.url}`);
      } else if (bytes) {
        let imageApplied = false;
        try {
          const image = figma.createImage(bytes);
          frame.fills = [{ type: 'IMAGE', imageHash: image.hash, scaleMode: 'FILL' }];
          imageApplied = true;
        } catch {
          status(`warning: bad image for ${n.url}, using placeholder`);
        }
        if (!imageApplied) {
          frame.fills = [{ type: 'SOLID', color: { r: 0.95, g: 0.95, b: 0.95 } }];
        }
      } else {
        status(`warning: no screenshot for ${n.url}`);
        frame.fills = [{ type: 'SOLID', color: { r: 0.95, g: 0.95, b: 0.95 } }];
      }
      frames.set(n.id, frame);
      created.push(frame);

      if (n.note) {
        const noteFrame = figma.createFrame();
        noteFrame.name = `note: ${n.title || n.url}`;
        noteFrame.fills = [{ type: 'SOLID', color: { r: 1, g: 0.92, b: 0.55 } }];
        noteFrame.x = p.x;
        noteFrame.y = p.y - 96;
        noteFrame.resize(Math.max(Math.min(s.width, 480), 100), 80);
        const text = figma.createText();
        text.characters = n.note;
        text.fontSize = 14;
        text.x = 12;
        text.y = 12;
        noteFrame.appendChild(text);
        created.push(noteFrame);
      }
    }

    for (const e of bundle.edges) {
      const src = frames.get(e.from)!;
      const dst = frames.get(e.to)!;
      const s2 = sizes.get(e.from)!;

      const hotspot = figma.createRectangle();
      hotspot.name = e.label ? `click: ${e.label}` : 'click';
      const hs = {
        x: Math.min(Math.max(e.bbox.x, 0), Math.max(s2.width - 4, 0)),
        y: Math.min(Math.max(e.bbox.y, 0), Math.max(s2.height - 4, 0)),
      };
      const hw = Math.max(Math.min(e.bbox.w, s2.width - hs.x), 4);
      const hh = Math.max(Math.min(e.bbox.h, s2.height - hs.y), 4);
      hotspot.x = hs.x;
      hotspot.y = hs.y;
      hotspot.resize(hw, hh);
      hotspot.fills = [{ type: 'SOLID', color: { r: 0.05, g: 0.45, b: 1 }, opacity: 0.1 }];
      hotspot.strokes = [{ type: 'SOLID', color: { r: 0.05, g: 0.45, b: 1 } }];
      hotspot.strokeWeight = 2;
      src.appendChild(hotspot);

      await hotspot.setReactionsAsync([{
        trigger: { type: 'ON_CLICK' },
        actions: [{ type: 'NODE', destinationId: dst.id, navigation: 'NAVIGATE', transition: null, preserveScrollPosition: false }],
      }]);

      const start = { x: src.x + hs.x + hw, y: src.y + hs.y + hh / 2 };
      const end = { x: dst.x, y: dst.y + 40 };
      const arrow = makeArrow(start, end);
      arrow.name = e.label ? `flow: ${e.label}` : 'flow';
      created.push(arrow);

      if (e.label) {
        const label = figma.createText();
        label.characters = e.label;
        label.fontSize = 12;
        label.x = (start.x + end.x) / 2 - 40;
        label.y = (start.y + end.y) / 2 - 20;
        created.push(label);
      }
    }
  } catch (err) {
    for (const n of created) n.remove();
    throw err;
  }

  figma.viewport.scrollAndZoomIntoView(created);
  figma.ui.postMessage({ type: 'done', message: `imported ${bundle.nodes.length} pages, ${bundle.edges.length} connections` });
}
