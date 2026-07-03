import { validateBundle, type Bundle } from './validate.js';
import { computeLayout, type Size } from './layout.js';

figma.showUI(__html__, { width: 340, height: 220 });

let pendingBundle: Bundle | null = null;
let pendingWarnings: string[] = [];
const images = new Map<string, Uint8Array>();

const status = (message: string) => figma.ui.postMessage({ type: 'status', message });
const fail = (message: string) => figma.ui.postMessage({ type: 'error', message });

figma.ui.onmessage = async (msg: { type: string; json?: string; nodeId?: string; bytes?: Uint8Array }) => {
  if (msg.type === 'bundle' && msg.json) {
    const { bundle, errors, warnings } = validateBundle(JSON.parse(msg.json));
    if (!bundle) { fail(errors.join('; ')); return; }
    pendingBundle = bundle;
    pendingWarnings = warnings;
    images.clear();
    status(`bundle ok: ${bundle.nodes.length} pages, ${bundle.edges.length} connections`);
  } else if (msg.type === 'image' && msg.nodeId && msg.bytes) {
    images.set(msg.nodeId, msg.bytes);
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

async function build(bundle: Bundle, warnings: string[]): Promise<void> {
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  for (const w of warnings) status(`warning: ${w}`);

  const sizes = new Map<string, Size>();
  for (const n of bundle.nodes) {
    sizes.set(n.id, n.image
      ? { width: n.image.width, height: n.image.height }
      : { width: n.viewport.width, height: n.viewport.height });
  }
  const placements = computeLayout(bundle.nodes.map((n) => n.id), bundle.edges, sizes);

  const frames = new Map<string, FrameNode>();
  const created: SceneNode[] = [];

  for (const n of bundle.nodes) {
    const p = placements.get(n.id)!;
    const s = sizes.get(n.id)!;
    const frame = figma.createFrame();
    frame.name = `${n.title || 'untitled'} — ${n.url}`;
    frame.x = p.x;
    frame.y = p.y;
    frame.resize(Math.max(s.width, 1), Math.max(s.height, 1));
    const bytes = images.get(n.id);
    if (bytes) {
      const image = figma.createImage(bytes);
      frame.fills = [{ type: 'IMAGE', imageHash: image.hash, scaleMode: 'FILL' }];
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

    const hotspot = figma.createRectangle();
    hotspot.name = e.label ? `click: ${e.label}` : 'click';
    hotspot.x = e.bbox.x;
    hotspot.y = e.bbox.y;
    hotspot.resize(Math.max(e.bbox.w, 4), Math.max(e.bbox.h, 4));
    hotspot.fills = [{ type: 'SOLID', color: { r: 0.05, g: 0.45, b: 1 }, opacity: 0.1 }];
    hotspot.strokes = [{ type: 'SOLID', color: { r: 0.05, g: 0.45, b: 1 } }];
    hotspot.strokeWeight = 2;
    src.appendChild(hotspot);

    await hotspot.setReactionsAsync([{
      trigger: { type: 'ON_CLICK' },
      actions: [{ type: 'NODE', destinationId: dst.id, navigation: 'NAVIGATE', transition: null, preserveScrollPosition: false }],
    }]);

    const start = { x: src.x + e.bbox.x + Math.max(e.bbox.w, 4), y: src.y + e.bbox.y + Math.max(e.bbox.h, 4) / 2 };
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

  figma.viewport.scrollAndZoomIntoView(created);
  figma.ui.postMessage({ type: 'done', message: `imported ${bundle.nodes.length} pages, ${bundle.edges.length} connections` });
}
