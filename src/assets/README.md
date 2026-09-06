# Image assets

App image assets live here. Everything in `src/assets/` is **optimized at
build** — Astro emits AVIF + WebP + a JPG fallback with responsive `srcset`, so
commit the **highest-quality original you have** (large, high-res). Do not
pre-compress.

Reference an image from a component by importing it, then passing it to
`<Picture>` / `<Image>` (see `src/pages/staff/login.astro` for the pattern).

## Contents

| Folder     | Subject                              | Used by                     |
| ---------- | ------------------------------------ | --------------------------- |
| `rooftop/` | Rooftop + city night ambience        | `/staff/login` split panel  |

## Naming

Lowercase, hyphenated, descriptive: `rooftop-city-night.jpg`. Keep the file
extension of the original (`.jpg`/`.png`); the build produces the modern formats
for you.
