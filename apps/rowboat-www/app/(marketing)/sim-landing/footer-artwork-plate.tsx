import Image from "next/image";

import { cn } from "@/lib/sim/cn";

import { FOOTER_ARTWORK, FOOTER_ARTWORK_SIZES } from "./footer-artwork";

/**
 * Theme-aware NYC skyline plate.
 *
 * One source list in {@link FOOTER_ARTWORK} so the homepage close and the auth
 * pane crop the same painting. Theme classes pick the plate without client state.
 */
export function FooterArtworkPlate({
  className,
  sizes = FOOTER_ARTWORK_SIZES,
  preload = false,
}: {
  className?: string;
  sizes?: string;
  preload?: boolean;
}) {
  return (
    <>
      {(
        Object.entries(FOOTER_ARTWORK) as Array<
          [keyof typeof FOOTER_ARTWORK, (typeof FOOTER_ARTWORK)[keyof typeof FOOTER_ARTWORK]]
        >
      ).map(([theme, artwork]) => (
        <picture
          className={cn(
            "absolute inset-0",
            theme === "light" ? "block dark:hidden" : "hidden dark:block",
          )}
          key={theme}
        >
          <source sizes={sizes} srcSet={artwork.avifSrcSet} type="image/avif" />
          <source sizes={sizes} srcSet={artwork.webpSrcSet} type="image/webp" />
          <Image
            alt=""
            blurDataURL={artwork.blurDataURL}
            className={className}
            fill
            placeholder="blur"
            preload={preload}
            sizes={sizes}
            src={artwork.src}
            unoptimized
          />
        </picture>
      ))}
    </>
  );
}
