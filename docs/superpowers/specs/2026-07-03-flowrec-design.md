# flowrec — Record web app flows, import into Figma

**Date:** 2026-07-03
**Status:** Approved

## Problem

Documenting a web app's user flows in Figma is manual: screenshot every page, place frames, draw arrows, remember what was clicked where. flowrec automates it: browse the app once while a recorder watches, then import the whole session into Figma as connected frames — arrows starting at the exact click locations.

## Overview

Two components:

1. **CLI recorder (`flowrec`)** — Node.js + TypeScript. Launches a headed Chromium via Playwright; the user browses normally. Captures clicks, navigations, per-page screenshots, and optional user-typed context notes. Produces a session directory, then exports a single self-contained JSON bundle.
2. **Figma plugin (`flowrec-importer`)** — local development plugin. UI accepts the exported JSON file; plugin code builds frames (screenshot fills), click hotspots, arrows, prototype reactions, and note annotations.

The Figma REST API cannot create canvas content, so the plugin is required. It is run via Figma's "Import plugin from manifest" — no publishing needed.

## CLI

```
flowrec record --url <start-url> [--out <dir>] [--profile <dir>] [--viewport 1440x900]
flowrec export <session-dir> [--out figma-import.json]
```

### `record`

- Launches headed Chromium (Playwright `chromium.launchPersistentContext` when `--profile` given, so logins persist across sessions; otherwise a fresh context).
- Injects a capture script into every page (`context.addInitScript`):
  - Click listener (capture phase) records: CSS selector of target, trimmed innerText (≤60 chars), bounding box in page coordinates, timestamp.
  - Hooks `history.pushState` / `replaceState` and listens to `popstate` + `hashchange` for SPA route changes.
  - Events are forwarded to Node via `page.exposeBinding`.
- Navigation handling: full loads via Playwright `framenavigated` (main frame only); SPA route changes via the hooks above. Both funnel into one "page-state changed" handler.
- On each new page state: wait for network-idle-ish settle (500 ms debounce), take **full-page** PNG screenshot, record `{ id, url, title, shotFile, viewport, timestamp }`.
- **Edge attribution:** the last click recorded before a page-state change (within a 5 s window) becomes the edge `from → to` with the click's bbox and label. Clicks that do not lead to navigation are stored but produce no edge (kept in raw event log for future use).
- **Dedup:** page states keyed by normalized URL (origin + path + search, hash included for hash routers). Revisiting a URL reuses the existing node; the edge points to it. Screenshot is not retaken on revisit.
- **Terminal UX during recording:** readline loop. Typing text + Enter attaches a note to the current page node. Commands: `done` (end session), `new` (force current URL to be treated as a distinct node next time — escape hatch for state-heavy pages). `Ctrl+C` also ends cleanly.
- Session is written incrementally (`graph.json` rewritten on every event) so a crash loses nothing.

### Session directory layout

```
<out>/
  graph.json        # nodes + edges + notes (see data model)
  events.jsonl      # raw event log (every click, every navigation)
  shots/0001.png …  # full-page screenshots
```

### `export`

Reads the session directory, inlines screenshots as base64, emits one `figma-import.json`:

```jsonc
{
  "version": 1,
  "startUrl": "https://app.example.com",
  "recordedAt": "2026-07-03T10:00:00Z",
  "nodes": [
    {
      "id": "p1",
      "url": "https://app.example.com/login",
      "title": "Login",
      "note": "login page — SSO only",
      "viewport": { "width": 1440, "height": 900 },
      "image": { "format": "png", "base64": "…", "width": 1440, "height": 2100 }
    }
  ],
  "edges": [
    {
      "from": "p1",
      "to": "p2",
      "label": "Sign in",
      "bbox": { "x": 620, "y": 480, "w": 200, "h": 44 }
    }
  ]
}
```

## Figma plugin

- `manifest.json` + `code.ts` (compiled to `code.js`) + `ui.html` (file input, progress text).
- UI reads the JSON file, posts it to plugin code in chunks if large.
- Build steps:
  1. **Layout:** BFS from the entry node; frames placed in columns by depth, 400 px gutters, rows within a column stacked with 200 px gaps.
  2. **Frames:** one frame per node, sized to screenshot dimensions, image fill via `figma.createImage(bytes)`. Frame name = `title — url path`.
  3. **Hotspots:** per outgoing edge, a rectangle at the recorded bbox inside the source frame — 2 px accent stroke, 10 % fill, named after the edge label.
  4. **Arrows:** vector line with arrowhead from each hotspot's right edge to the target frame's left edge, plus a small text label.
  5. **Prototype wiring:** `setReactionsAsync` on each hotspot — `ON_CLICK → NAVIGATE` to the target frame, so Present mode replays the recorded flow.
  6. **Notes:** yellow sticky-style text block above frames that have notes.
- Errors (missing target node, bad image) are logged to the UI and skipped; import continues.

## Error handling

- CLI: browser closed by user → treated as `done`, session finalized. Screenshot failure → node kept without image, warning printed. Click on element that disappears before bbox read → event dropped.
- Plugin: validates `version` field; unknown version → clear error. Oversized images (>4096 px Figma image limit per dimension) are downscaled by the CLI at export time, coordinates rescaled to match.

## Testing

- Unit: URL normalization/dedup, edge attribution (click→nav pairing window), BFS layout math, export bundling (bbox rescale on downscale).
- Integration: Playwright test that serves a tiny 3-page fixture site (one full-load link, one SPA pushState route), scripts clicks, asserts resulting `graph.json` nodes/edges.
- Plugin: pure functions (layout, validation) extracted and unit-tested with vitest; canvas calls exercised manually in Figma.

## Out of scope (v1)

- DOM → editable Figma layers reconstruction.
- New-node detection via DOM/screenshot diff without URL change (v1 escape hatch: `new` command).
- FigJam connector export.
- Multi-tab / popup windows (recorder follows the first page only; new tabs logged as warnings).
- Scroll/hover/input capture — clicks and navigations only.

## Stack

- CLI: Node 20+, TypeScript, Playwright, commander, no framework beyond that.
- Plugin: TypeScript, esbuild bundle, @figma/plugin-typings.
- Monorepo layout: `packages/cli`, `packages/figma-plugin`, npm workspaces.
