/**
 * Restaurant identity for the white-label ordering app. Edit these values to
 * re-skin the whole app for a different restaurant — nothing brand-specific is
 * hard-coded in components. Everything here is public (it shows in the UI); no
 * secrets belong in this file.
 */
export const brand = {
  name: "Your Restaurant",
  tagline: "Fresh, made to order",
  /** One hex. Drives --accent and its hover/soft derivations across the app. */
  accent: "#C2410C",
  /** Corner roundness for the whole UI. */
  radius: "medium" as "sharp" | "medium" | "soft",
  /** Currency label; formatINR handling lives in lib/money. */
  currency: "INR",
  /** IANA zone the restaurant trades in. Serverless functions run in UTC, so
   *  every "today" in the app is resolved against this, not the server clock. */
  timezone: "Asia/Kolkata",
  contact: {
    phoneDisplay: "+91 78801 56565",
    phoneHref: "tel:+917880156565",
    whatsappHref: "https://wa.me/917880156565",
    mapsHref:
      "https://www.google.com/maps/search/?api=1&query=High+Street+Apollo+Vijay+Nagar+Indore",
    address: {
      line1: "Level 06, High Street Apollo",
      line2: "Vijay Nagar, Indore",
      line3: "Madhya Pradesh 452010",
      /** The same address in parts, for schema.org. Kept beside the display
       *  lines rather than parsed out of them: "Vijay Nagar, Indore" splits
       *  cleanly today and would not for the next restaurant. */
      locality: "Indore",
      region: "Madhya Pradesh",
      postalCode: "452010",
      /** ISO 3166-1 alpha-2. */
      country: "IN",
    },
    hours: "12:00 PM – 11:30 PM · Everyday",
    /** The same hours in schema.org's opening-hours grammar. Search engines
     *  cannot read the display string, and emitting an unparseable value is
     *  worse than emitting none. */
    hoursSchema: "Mo-Su 12:00-23:30",
  },
} as const;
