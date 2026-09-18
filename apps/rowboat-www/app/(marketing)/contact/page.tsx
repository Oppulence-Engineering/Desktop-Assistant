import Link from "next/link";

import { CardDescription } from "@oppulence/ui/components/card";

import { MarketingBreadcrumbs, MarketingCta } from "../marketing-primitives";
import { marketingMetadata } from "../metadata";

export const metadata = marketingMetadata({
  title: "Contact",
  description:
    "How to reach Oppulence: the in-page support widget, Discord, and the existing product email.",
  path: "/contact",
});

export default function ContactPage() {
  return (
    <article className="mk-capability linear-subpage">
      <div className="linear-inset">
        <MarketingBreadcrumbs items={[{ label: "Home", href: "/" }, { label: "Contact" }]} />
        <header className="linear-subpage-hero">
          <div>
            <p className="linear-eyebrow">[contact]</p>
            <h1 className="linear-subpage-title mt-4">
              A human answers. Start where you already are.
            </h1>
          </div>
          <div className="linear-subpage-description">
            <p>
              The dark support widget on this site is the fastest path. Discord is public. The
              product email is the same one the dashboard already uses.
            </p>
          </div>
        </header>

        <section className="mk-index-grid">
          <article className="mk-index-card">
            <strong>In-page support</strong>
            <CardDescription>
              The chat control in the corner is the Plain widget used across the public site. Use
              that if you are already here.
            </CardDescription>
          </article>
          <a
            className="mk-index-card"
            href="https://discord.gg/wajrgmJQ6b"
            rel="noopener noreferrer"
            target="_blank"
          >
            <strong>Discord</strong>
            <CardDescription>
              The public server linked from the rest of the product.
            </CardDescription>
          </a>
          <article className="mk-index-card">
            <strong>Email</strong>
            <CardDescription>
              hello@oppulence.io — the address the signed-in app already points at. Prefer the
              widget if you want a thread next to the page you are on.
            </CardDescription>
          </article>
          <Link className="mk-index-card" href="/responsible-disclosure">
            <strong>Security reports</strong>
            <CardDescription>
              Use the responsible disclosure page, not a public channel.
            </CardDescription>
          </Link>
        </section>

        <MarketingCta
          body="Most evaluation starts with the free report, not a conversation."
          secondary={{ href: "/resources", label: "Browse resources" }}
          title="Or just start the product."
        />
      </div>
    </article>
  );
}
