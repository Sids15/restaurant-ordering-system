// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import vercel from '@astrojs/vercel';

// https://astro.build/config
export default defineConfig({
  // Server output so the ordering app renders per request as serverless
  // functions. Marketing pages opt back into static with `export const
  // prerender = true` (see src/pages/index.astro).
  output: 'server',
  adapter: vercel(),

  // CSRF: reject form POSTs whose Origin doesn't match the host. The staff
  // mutation endpoints are cookie-authenticated, so this (with SameSite=Lax
  // cookies) blocks cross-site form forgery. Pinned explicitly rather than
  // relying on the framework default.
  security: {
    checkOrigin: true,
  },

  // React is loaded only as islands, on the handful of components that
  // genuinely need client interactivity. Everything else ships as static HTML.
  integrations: [react()],

  image: {
    // AVIF + WebP with responsive srcset and lazy-loading (Section 26).
    responsiveStyles: true,
  },
});
