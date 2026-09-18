export type ProductDemoBeatId = "read" | "confirm" | "watch";

export const PRODUCT_DEMO_BEATS: Readonly<Record<ProductDemoBeatId, string>> = {
  read: "Read the closed deal.",
  confirm: "Confirm the rows.",
  watch: "Watch what goes stale.",
};

export const PRODUCT_DEMO_FRAMES: Readonly<
  Record<ProductDemoBeatId, { src: string; alt: string }>
> = {
  read: {
    src: "/marketing/relationship-web-list.png",
    alt: "Oppulence register listing commitments with sources",
  },
  confirm: {
    src: "/marketing/relationship-web-detail.png",
    alt: "Oppulence account view with confirmed commitments",
  },
  watch: {
    src: "/marketing/relationship-desktop.png",
    alt: "Oppulence attention queue highlighting stale promises",
  },
};

export const PRODUCT_DEMO_BEAT_ORDER: ProductDemoBeatId[] = ["read", "confirm", "watch"];

export const PRODUCT_DEMO_BEAT_MS = 4200;
