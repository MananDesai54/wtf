# wtf --interactive: DOM capture → editable Figma layers

**Date:** 2026-07-03
**Status:** Approved

## Problem

Screenshot capture produces flat images: nothing in Figma is editable, and content clipped at capture time (inside scroll containers, below dynamic viewports) is cut off. Designers want to tweak copy and move elements after import.

## Overview

New CLI flag: `wtf record --url <u> --interactive`. In interactive mode the Capture button serializes the rendered DOM instead of screenshotting. The Figma plugin rebuilds each captured state as real layers — text, rectangles, images — positioned exactly where they rendered. Screenshot mode remains the default and is untouched.

Hotspots, arrows, prototype reactions, notes, layout: all unchanged. DOM element coordinates and click bboxes share the same page-coordinate space.

## Component 1: DOM serializer (`packages/cli/src/dom-serializer.ts`)

A browser-side script (plain-JS template literal, same pattern as `capture-script.ts`) exposed as `SERIALIZE_SCRIPT`. The recorder evaluates it in the page at capture time; it returns a JSON-serializable `DomCapture`:

```ts
interface DomCapture {
  width: number;   // max(document width, scrollWidth)
  height: number;  // full scrollHeight of the document
  elements: DomElement[];   // paint order = DOM order
  images: Record<string, string>; // imageId -> src URL (bytes fetched by recorder)
}

type DomElement =
  | { kind: 'rect'; x: number; y: number; w: number; h: number;
      bg?: RGBA; borderColor?: RGBA; borderWidth?: number; radius?: number }
  | { kind: 'text'; x: number; y: number; w: number; h: number;
      text: string; fontSize: number; fontWeight: number;
      color: RGBA; align: 'left' | 'center' | 'right' }
  | { kind: 'image'; x: number; y: number; w: number; h: number;
      imageId: string; radius?: number };

interface RGBA { r: number; g: number; b: number; a: number } // 0..1
```

Serialization rules:

- Walk `document.body` depth-first in DOM order.
- Skip: `#__wtf_panel`, `script`/`style`/`noscript`/`head`, elements with `display:none`, `visibility:hidden`, `opacity:0`, or zero-area rects.
- Coordinates: `getBoundingClientRect()` + `window.scrollX/Y` (page coords). Clipped/overflowed elements keep their layout position — this is what recovers content that screenshots cut off. Full page height captured regardless of viewport.
- `rect` emitted for an element when it has a non-transparent background color or a visible border. Radius from `border-top-left-radius` (px, uniform approximation).
- `text` emitted per element whose direct child text nodes have non-whitespace content; `text` = concatenated direct text, styles from computed style of the element. Gradient/`background-clip:text` colors fall back to computed `color`.
- `image` emitted for `<img>` (uses `currentSrc`) and for elements with a `background-image: url(...)` (first url). Each unique URL gets one `imageId`.
- Inline `<svg>`, `<canvas>`, `<video>`: emitted as `rect` with light-gray bg (placeholder, v1).
- Element cap: 5000 per capture; beyond that, stop and set `truncated: true` on the capture (recorder prints a warning).
- Colors parsed from computed `rgb()/rgba()` strings; `transparent`/`rgba(…,0)` treated as no fill.

## Component 2: Recorder changes (`packages/cli/src/recorder.ts`)

- `RecordOptions.interactive?: boolean`.
- In `capture()`, when interactive: instead of screenshot →
  1. `page.evaluate(SERIALIZE_SCRIPT)` → `DomCapture` (panel skipped by serializer, no hide/show needed).
  2. Fetch each image URL once via `this.context.request.get(url)` (shares cookies/auth); store base64 + detected content type. Failures → warning, image dropped (its `image` elements degrade to placeholder rects in the plugin).
  3. Write `dom/0001.json` (zero-padded seq, same numbering scheme as shots): `{ ...DomCapture, imageData: Record<imageId, {base64, mime}> }`.
  4. `graph.setDom(node.id, domFile)`.
- Screenshot path untouched when flag absent.

## Component 3: Graph (`packages/cli/src/graph.ts`)

- `PageNode.domFile: string | null` added (alongside `shotFile`). `setDom(nodeId, domFile)` mirrors `setShot`. Constructor also creates `<dir>/dom/`.

## Component 4: Bundle v2 (`packages/cli/src/exporter.ts`)

- `version: 2`.
- Node shape: `{ id, url, title, note?, viewport, image: {...}|null, dom: BundleDom|null }` — exactly one of `image`/`dom` is non-null for captured nodes (both null if capture failed).
- `BundleDom = { width, height, truncated?: boolean, elements: DomElement[], images: Record<imageId, {mime: string, base64: string}> }` — copied through from the session's dom JSON.
- Screenshot nodes keep the 4096px downscale + bbox rescale. DOM nodes are not downscaled and their edges' bboxes are not rescaled (no raster limit).

## Component 5: Plugin (`packages/figma-plugin`)

- `validate.ts`: accept `version` 1 or 2. v1 nodes get `dom: null` implicitly. New checks: `dom`, when present, must have numeric width/height and an `elements` array; malformed → fatal, same policy as malformed nodes.
- `ui.html`: for dom nodes, decode each `images[id].base64` → bytes, post `{type:'dom-image', nodeId, imageId, bytes}` after the node's message; existing screenshot path unchanged.
- `code.ts` (`build()`):
  - Frame size for dom nodes = `dom.width × dom.height`; white background.
  - Children appended in `elements` order:
    - `rect` → `RectangleNode` with solid fill/stroke/radius.
    - `text` → `TextNode`: `characters`, `fontSize`, `fills=[color]`, `textAlignHorizontal`, resized to `w×h` with `textAutoResize='NONE'`. Fonts: Inter Regular (<600), Inter Bold (≥600) — both loaded up front.
    - `image` → `RectangleNode` with image fill when bytes arrived, gray placeholder otherwise.
  - `truncated` → status warning.
  - Hotspots/arrows/reactions/notes/layout code untouched (sizes map already falls back per node: image dims → dom dims → viewport).

## Error handling

- Serializer runs in a try/catch inside `capture()`; failure → warning + node kept without capture (same as screenshot-failure policy).
- Image fetch failures degrade to placeholders, never abort a capture.
- Plugin: unknown font load failure → fail build with clear message (Inter is always available in Figma).

## Testing

- Integration (`recorder.integration.test.ts`): fixture page grows a styled section — heading, paragraph, colored button, data-URI `<img>`, and a `div` placed at y=2000 (below the 600px viewport). Record with `interactive: true`, capture, assert `dom/0001.json`: contains text elements incl. the below-fold one (y > viewport height), the image with data captured, a rect with the button's background color, and page `height ≥ 2000`.
- Unit: exporter v2 bundling (dom passthrough, no rescale on dom edges, screenshot nodes still rescaled); plugin `validateBundle` v1+v2 cases; font-weight→style mapping.

## Out of scope (v1 of interactive)

- Shadows, gradients (solid fallback), transforms, z-index reordering, iframes.
- Web font matching (everything is Inter).
- Auto-layout reconstruction — absolute positions only.
- Editable vectors for inline SVG.

## Migration

None needed: plugin accepts v1 bundles; old sessions re-export as v2 screenshot nodes.
