/**
 * The tour is available in local/dev builds for dogfooding. Production builds
 * opt in explicitly so a partially migrated tour cannot surprise users.
 */
export const USE_PRODUCT_TOUR =
  import.meta.env.DEV ||
  import.meta.env.MODE === "dogfood" ||
  import.meta.env.VITE_USE_PRODUCT_TOUR === "true" ||
  import.meta.env.VITE_ENABLE_PRODUCT_TOUR === "true";

export const PRODUCT_TOUR_ENABLED = USE_PRODUCT_TOUR;

export const PRODUCT_TOUR_AUTOSTART = import.meta.env.VITE_PRODUCT_TOUR_AUTOSTART === "true";
