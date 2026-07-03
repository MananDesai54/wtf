// Browser-side DOM serializer. Evaluated as an expression at capture time;
// returns a DomCapture (see dom-types.ts). Kept as a plain string like
// capture-script.ts so it survives bundling untouched.
export const SERIALIZE_SCRIPT = `(() => {
  const MAX_ELEMENTS = 5000;
  const MAX_SVG_CHARS = 100000;
  const elements = [];
  const images = {};
  const svgs = {};
  const urlToId = new Map();
  let imageSeq = 0;
  let svgSeq = 0;
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

    if (tag === 'svg') {
      const markup = el.outerHTML;
      if (markup && markup.length <= MAX_SVG_CHARS) {
        const id = 'svg' + (++svgSeq);
        svgs[id] = markup;
        elements.push({ kind: 'svg', x: rect.x, y: rect.y, w: rect.w, h: rect.h, svgId: id });
      } else {
        elements.push({ kind: 'rect', x: rect.x, y: rect.y, w: rect.w, h: rect.h, bg: { r: 0.9, g: 0.9, b: 0.9, a: 1 } });
      }
      return; // do not descend
    }
    if (tag === 'canvas' || tag === 'video') {
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
        const fontSize = parseFloat(cs.fontSize) || 14;
        const lineHeight = parseFloat(cs.lineHeight) || fontSize * 1.2;
        const entry = {
          kind: 'text', x: rect.x, y: rect.y, w: rect.w, h: rect.h,
          text: direct.slice(0, 2000),
          fontSize: fontSize,
          fontWeight: parseInt(cs.fontWeight, 10) || 400,
          color: color, align: align,
        };
        // taller than ~1.5 lines = browser wrapped it; single-line text must
        // not re-wrap in Figma (Inter is often wider than the source font)
        if (rect.h >= lineHeight * 1.5) entry.wrap = true;
        elements.push(entry);
      }
    }

    for (const child of el.children) visit(child);
  };

  for (const child of document.body.children) visit(child);

  const doc = document.documentElement;
  const result = {
    svgs: svgs,
    width: Math.max(doc.scrollWidth, doc.clientWidth),
    height: Math.max(doc.scrollHeight, doc.clientHeight),
    elements: elements,
    images: images,
  };
  if (truncated) result.truncated = true;
  return result;
})()`;
