Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/PWA-1.md and run it.

# PWA-1 — Froot as a home screen app on iPad

**TIER 2** — contained UI/config change. No schema, no permission change, no new API route, no new dependency. Declare the tier before writing anything. Work on `staging`. Commit only; never push.

## What this phase does (plain English)

When someone adds Froot to an iPad home screen (Safari → Share → Add to Home Screen) and launches it from that icon, Froot opens full screen with no Safari address bar, tabs or buttons. It gets the orange slice icon and Froot's colors, and it opens in Tablet mode the first time. Opening Froot in Safari or on a laptop behaves exactly as today.

## Read first

1. `/Users/garythomas/Claude_Projects/Froot/froot/CLAUDE.md`
2. The root layout (`/Users/garythomas/Claude_Projects/Froot/froot/src/app/layout.tsx`) and how it currently exports `metadata` / `viewport`.
3. The Tablet/Desktop switch from TAB-1: where the per-device choice is stored (key name, storage type), where it is read on load, and what it falls back to when nothing is saved.
4. Where a signed-in user lands from `/` (so `start_url` points somewhere that works for every role).
5. `/Users/garythomas/Claude_Projects/Froot/froot/public/logo.png` (500×500 orange slice on transparency) and the design system's background/brand color tokens.
6. `/Users/garythomas/Claude_Projects/Froot/froot/docs/ROADMAP.yaml` — read the file for the next free id conventions; never assume.

## Build

**1. Manifest** — `src/app/manifest.ts` (Next.js metadata convention):
- `name: "Froot"`, `short_name: "Froot"`, `id: "/"`, `start_url` per Read-first item 4, `scope: "/"`
- `display: "standalone"`
- `background_color` and `theme_color` = Froot's cream page background from the design tokens (use the literal hex the tokens resolve to; manifests can't read CSS vars)
- icons: 192×192 and 512×512 PNG, plus a 512×512 `purpose: "maskable"`

**2. Icons** — iOS turns transparent icons black, so every icon gets a solid cream (or brand orange — pick whichever the design system uses for the logo tile) square background with the slice centered and padded (~15% each side; maskable ~20%).
- Produce: `src/app/apple-icon.png` (180×180, Next file convention), `public/icons/icon-192.png`, `public/icons/icon-512.png`, `public/icons/icon-maskable-512.png`.
- Generate them with `sharp` only if it is already resolvable in `node_modules` (Next ships it); otherwise use `next/og` `ImageResponse` route files instead. Do not add a dependency. Any one-off generator script is not committed.

**3. Apple metadata** in the root layout:
- `appleWebApp: { capable: true, title: "Froot", statusBarStyle: "default" }`
- `viewport.themeColor` = the same cream hex
- Do **not** set `viewportFit: "cover"`. With `"default"` the status bar stays dark text on light, and iOS keeps content out of the status bar and home-indicator areas itself — no safe-area padding needed. (`black-translucent` would make the status bar text white on a cream app — unreadable.)

**4. Open in Tablet mode from the home screen icon** (draft ruling R1 below):
- Detect launch-from-icon on the client: `window.matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone === true`.
- Only when **no** Tablet/Desktop choice is saved on this device: default to Tablet instead of Desktop. If a choice is saved, it always wins — switching to Desktop inside the app sticks across relaunches.
- Safari and desktop browsers are untouched: still default Desktop, still never auto-switch.
- Read the detection in the same place the saved choice is read today; respect the repo's `react-hooks/set-state-in-effect` lint pattern used elsewhere. No flash of Desktop before Tablet if avoidable within the existing load pattern; if not avoidable, say so in the report rather than restructuring the shell.
- Users whose role can't use Tablet mode (if any such gate exists) get whatever they get today.

## Out of scope

Push notifications, offline/service worker, install prompts or banners, splash screens, App Store/Capacitor, any change to Clerk or Square OAuth flows. Classify any finding FIX NOW / RULING NOW / COMMENT / ROW.

## Verify before committing

- `npm run build` green (it runs `prisma generate` — note it, not a breach).
- `/manifest.webmanifest` serves the fields above; `/apple-icon.png` and the three `public/icons/` files return 200 with the right pixel sizes (state how you measured).
- The rendered `<head>` contains `apple-mobile-web-app-capable`, `apple-mobile-web-app-title`, `apple-mobile-web-app-status-bar-style`, `apple-touch-icon`, `theme-color`, and the manifest link.

## Commits

1. Work commit — code and icons only (stage files explicitly; no `git add -A`).
2. Docs commit — `docs/ROADMAP.yaml` row **PWA-1** (status `in_progress`; `open:` the iPad staging test; `deferred:` push notifications, offline, App Store wrapper) and the draft ruling below added to `docs/DECISIONS.md` marked **DRAFT — awaiting Gary's ratification at PRE-PUSH-CHECK**.

Report: tier, both SHAs, files touched, how the Tablet default was wired (file + line), the icon background chosen, any flash-of-Desktop note, prisma commands run.

## Draft ruling R1 (Gary ratifies in his own words at PRE-PUSH-CHECK)

> "When Froot is opened from the iPad home screen icon and nothing is saved on that device yet, it opens in Tablet mode. Once someone picks Tablet or Desktop on that device, their choice always wins. Opening Froot in Safari or on a computer stays Desktop by default and never switches on its own."

## Staging test plan (Gary, after push — iPad only)

1. In Safari on the iPad, open the staging URL → Share → Add to Home Screen. The icon is the orange slice on a solid tile (not black, not a page screenshot); the name reads "Froot".
2. Launch from the icon: no address bar, no tabs, no Safari buttons; time/battery strip readable.
3. Sign in (the icon app has its own login, separate from Safari). It opens in Tablet mode.
4. Switch to Desktop, close the app fully, relaunch from the icon → still Desktop. Switch back to Tablet.
5. Open the same URL in Safari → Desktop by default, as before.
