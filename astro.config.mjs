// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import vercel from '@astrojs/vercel';

// https://astro.build/config
export default defineConfig({
  // Server output so the ordering app renders per request as serverless
  // functions.
  output: 'server',
  adapter: vercel(),

  // The canonical origin, stated once. Canonical links, Open Graph URLs, the
  // sitemap and robots.txt all read it from here, so moving to the
  // restaurant's own domain is this one line.
  site: 'https://restaurant-ordering-system-gamma-teal.vercel.app',

  // The app's front door is the customer menu.
  redirects: {
    '/': '/menu',
  },

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
    // NO image optimization, deliberately.
    //
    // There is not one <img>, <Image> or getImage() in this app — dishes are
    // typography and colour, not photography. But the optimization endpoint is
    // routed whether or not anything uses it, and it decodes image bytes a
    // stranger chose. Astro 7.2.4 shipped a critical RCE in exactly that path
    // (GHSA-26w7-cxv4-gfx2, AVIF), which is what prompted this.
    //
    // The upgrade fixed that bug. Turning the service off means the next one in
    // an image decoder is not our problem: a door into a room we keep nothing
    // in is worth closing, not guarding.
    //
    // If this app ever does show dish photography, drop the `service` line and
    // put `responsiveStyles: true` back.
    service: { entrypoint: "astro/assets/services/noop" },
  },
});
