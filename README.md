# flowrec

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

A Chromium window opens — browse normally. In the terminal:

- type text + Enter → attach a note to the current page
- `new` → treat the next visit of an already-seen URL as a separate page
- `done` (or Ctrl+C) → finish the session
- `--profile ~/.flowrec-profile` → keep logins between sessions

## Export

```bash
node packages/cli/dist/index.js export <session-dir> --out figma-import.json
```

## Import into Figma

1. Figma desktop → Plugins → Development → **Import plugin from manifest…**
2. Select `packages/figma-plugin/manifest.json`
3. Run **flowrec importer**, pick your `figma-import.json`

You get one frame per page (screenshot fill), a highlighted hotspot where
you clicked, arrows between pages, notes, and working prototype wiring.

## Limits (v1)

- Clicks and navigations only (no hover/scroll/input capture)
- First tab only; popups are ignored
- Same URL = same page unless you use `new`
- Screenshots over 4096px are downscaled (Figma limit)
