/**
 * Single source of site-wide facts: brand and public business details. These
 * are intentionally public (they appear in the app UI) — no secrets belong in
 * this file.
 */

export const brand = {
  name: "BERLIN",
  tagline: "HAUS DE GOURMET",
  description:
    "A rooftop gourmet house and bar where global flavours meet crafted cocktails and the city lights set the mood.",
} as const;

/** Public contact & location details (shown in the app — not secrets). */
export const contact = {
  phoneDisplay: "+91 78801 56565",
  phoneHref: "tel:+917880156565",
  whatsappHref: "https://wa.me/917880156565",
  // Public Google Maps search for the venue address.
  mapsHref:
    "https://www.google.com/maps/search/?api=1&query=High+Street+Apollo+Vijay+Nagar+Indore",
  address: {
    line1: "Level 06, High Street Apollo",
    line2: "Vijay Nagar, Indore",
    line3: "Madhya Pradesh 452010",
  },
  hours: "12:00 PM – 11:30 PM · Everyday",
} as const;
