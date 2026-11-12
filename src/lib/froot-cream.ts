// PWA-1 (2026-11-11) — Froot's cream page background, --color-background
// oklch(97% .02 65) in src/app/globals.css, as the literal hex it resolves to.
// The web app manifest and the theme-color meta cannot read CSS variables.
//
// Used by: src/app/manifest.ts (background_color, theme_color),
// src/app/layout.tsx (viewport.themeColor), and baked into the icon tiles
// (src/app/apple-icon.png, public/icons/*.png). If the token changes, change
// this and regenerate the icons.
export const FROOT_CREAM = "#fff3e8"
