# Image assets

App image assets live here. Everything in `src/assets/` is **optimized at
build** — Astro emits AVIF + WebP + a JPG fallback with responsive `srcset`, so
commit the **highest-quality original you have** (large, high-res). Do not
pre-compress.

Reference an image from a component by importing it, then passing it to
`<Picture>` / `<Image>` from `astro:assets`.

## Contents

This directory is currently empty — no page imports a build-time image asset
right now. `/staff/login`'s brand panel is a CSS gradient (see
`src/pages/staff/login.astro`), not a photo. Add a subfolder here (with its own
row in this table) the next time a page needs one.

## Naming

Lowercase, hyphenated, descriptive, e.g. `hero-dish-closeup.jpg`. Keep the file
extension of the original (`.jpg`/`.png`); the build produces the modern formats
for you.
