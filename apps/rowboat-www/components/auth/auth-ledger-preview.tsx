import { FooterArtworkPlate } from "@/app/(marketing)/sim-landing/footer-artwork-plate";

import styles from "@/components/auth/auth-showcase.module.css";

/**
 * Auth pane uses the same NYC plate as the marketing close.
 *
 * Full-bleed crop, not a second illustration. object-position keeps the
 * buildings in the pane instead of a slice of sky.
 */
export function AuthLedgerPreview() {
  return (
    <div aria-hidden className={styles.stage}>
      <FooterArtworkPlate
        className={`${styles.plate} object-cover object-[center_72%]`}
        sizes="(max-width: 1023px) 100vw, 70vw"
      />
    </div>
  );
}
