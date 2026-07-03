# wtf

Record a browsing session on any web app, then import it into Figma as
connected frames — arrows start at the exact elements you clicked, and
prototype mode replays the flow.

## Setup

```bash
npm install
npx playwright install chromium
npm run build --workspaces
```

## Record

```bash
node packages/cli/dist/index.js record --url https://your-app.com
```

A Chromium window opens — browse normally. Capturing is **manual**: a small
control panel sits in the top-right of every page.

- **Capture** → snapshot the current page state. Only captured states end up
  in Figma. The panel itself never appears in screenshots.
- Every Capture is its own snapshot — same URL captured twice is two frames.
  Open a modal, switch a tab, expand a dropdown → Capture again.
- **Done** → finish the session (same as typing `done` in the terminal)
- Arrows: the click that led from one captured state to the next — a
  navigation click, or the state-changing click on the same page (e.g. the
  button that opened the modal). Pages you pass through without capturing
  are skipped.

In the terminal:

- type text + Enter → attach a note to the last captured state
- `done` (or Ctrl+C) → finish the session

Launch flag: `--profile ~/.wtf-profile` → keep logins between sessions.

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

## Export

```bash
node packages/cli/dist/index.js export <session-dir> --out figma-import.json
```

## Import into Figma

1. Figma desktop → Plugins → Development → **Import plugin from manifest…**
2. Select `packages/figma-plugin/manifest.json`
3. Run **wtf importer**, pick your `figma-import.json`

You get one frame per page (screenshot fill), a highlighted hotspot where
you clicked, arrows between pages, notes, and working prototype wiring.

## Limits (v1)

- Clicks and navigations only (no hover/scroll/input capture)
- New tabs/popups join the recording; capture works in whichever tab you click
- Screenshots over 4096px are downscaled (Figma limit)
