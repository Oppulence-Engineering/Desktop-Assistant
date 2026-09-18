/**
 * Pre-encoded B&W NYC illustration footer artwork for the Sim-style closing CTA.
 *
 * Source: user-provided CleanShot NYC skyline illustration (Brooklyn Bridge / Manhattan),
 * tone-mapped to Sim SF footer plates. Masters: `nyc-skyline-*.webp`.
 */
export const FOOTER_ARTWORK = {
  light: {
    avifSrcSet:
      "/marketing/footer-artwork/light-1200-11e25757ffea.avif 1200w, /marketing/footer-artwork/light-1920-27cb246817a0.avif 1920w, /marketing/footer-artwork/light-3840-9617ec18b206.avif 3840w",
    webpSrcSet:
      "/marketing/footer-artwork/light-1200-b2ac4d91a39c.webp 1200w, /marketing/footer-artwork/light-1920-85774b46fb53.webp 1920w, /marketing/footer-artwork/light-3840-966620ea8f5b.webp 3840w",
    src: "/marketing/footer-artwork/light-3840-966620ea8f5b.webp",
    blurDataURL:
      "data:image/webp;base64,UklGRjoAAABXRUJQVlA4IC4AAACQAQCdASoIAAUAAkA4JaQAAuYzJ4AA/vvCtc2pJHHA1T70QS8f7tr+fWj8AAAA",
  },
  dark: {
    avifSrcSet:
      "/marketing/footer-artwork/dark-1200-d500238945e3.avif 1200w, /marketing/footer-artwork/dark-1920-d4df67beccf9.avif 1920w, /marketing/footer-artwork/dark-3840-a37c18721d7c.avif 3840w",
    webpSrcSet:
      "/marketing/footer-artwork/dark-1200-a64ee9bd0d74.webp 1200w, /marketing/footer-artwork/dark-1920-7e569d612b0f.webp 1920w, /marketing/footer-artwork/dark-3840-cd04d9f5d982.webp 3840w",
    src: "/marketing/footer-artwork/dark-3840-cd04d9f5d982.webp",
    blurDataURL:
      "data:image/webp;base64,UklGRjQAAABXRUJQVlA4ICgAAACQAQCdASoIAAUAAkA4JaQAAudZtgAA/vbLs0csu3OClm1yhtpeoAAA",
  },
} as const;

export const FOOTER_ARTWORK_SIZES = "(max-width: 639px) 112vw, 100vw";
