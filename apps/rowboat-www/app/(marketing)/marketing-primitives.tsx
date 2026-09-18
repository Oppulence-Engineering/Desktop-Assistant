import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { Badge } from "@oppulence/ui/components/badge";
import { Button, type buttonVariants } from "@oppulence/ui/components/button";
import { CardDescription } from "@oppulence/ui/components/card";
import type { VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";
import type { CatalogLink } from "./catalog";

/**
 * Inline marketing text wrapper. Badge renders a `<span>` so legacy CSS selectors
 * like `.sm-attio-home h2 > span` keep working, but shadcn defaults are reset so
 * copy flows like plain text (unlike Label, which is flex + text-sm for forms).
 */
export const marketingSpanClass =
  "inline h-auto min-h-0 w-auto max-w-none shrink overflow-visible " +
  "rounded-none border-0 bg-transparent p-0 m-0 " +
  "text-inherit [font-size:inherit] [font-weight:inherit] [line-height:inherit] [letter-spacing:inherit] " +
  "shadow-none whitespace-normal select-auto " +
  "hover:bg-transparent focus-visible:border-transparent focus-visible:ring-0";

export function MarketingSpan({
  className,
  variant = "ghost",
  ...props
}: ComponentProps<typeof Badge>) {
  return <Badge className={cn(marketingSpanClass, className)} variant={variant} {...props} />;
}

type MarketingButtonVariant = VariantProps<typeof buttonVariants>["variant"];

/** Marketing CTA link styled with shadcn Button. */
export function MarketingButtonLink({
  href,
  children,
  variant = "default",
  className,
}: {
  href: string;
  children: ReactNode;
  variant?: MarketingButtonVariant;
  className?: string;
}) {
  const isPrimary = variant === "default";

  return (
    <Button
      asChild
      className={cn("sm-attio-btn", isPrimary && "sm-attio-btn-primary", "h-11 px-5", className)}
      variant={variant}
    >
      <Link href={href}>{children}</Link>
    </Button>
  );
}

export function MarketingBreadcrumbs({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mk-breadcrumbs">
      <ol>
        {items.map((item, index) => (
          <li key={`${item.label}-${item.href ?? index}`}>
            {index > 0 ? <MarketingSpan aria-hidden="true">/</MarketingSpan> : null}
            {item.href && index < items.length - 1 ? (
              <Link href={item.href}>{item.label}</Link>
            ) : (
              <MarketingSpan aria-current={index === items.length - 1 ? "page" : undefined}>
                {item.label}
              </MarketingSpan>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function ProductFrame({
  alt,
  src,
  caption,
  priority = false,
}: {
  alt: string;
  src: string;
  caption?: string;
  priority?: boolean;
}) {
  return (
    <figure className="mk-product-frame">
      <div className="mk-product-frame-chrome" aria-hidden="true">
        <MarketingSpan />
        <MarketingSpan />
        <MarketingSpan />
      </div>
      <Image
        alt={alt}
        className="mk-product-frame-image"
        height={960}
        priority={priority}
        sizes="(max-width: 768px) 100vw, 1100px"
        src={src}
        width={1440}
      />
      {caption ? <figcaption>{caption}</figcaption> : null}
    </figure>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <header className="mk-section-heading">
      {eyebrow ? <p className="linear-eyebrow">{eyebrow}</p> : null}
      <h2>{title}</h2>
      {children ? <div className="mk-section-lede">{children}</div> : null}
    </header>
  );
}

export function RelatedPages({
  heading = "Keep going",
  items,
}: {
  heading?: string;
  items: CatalogLink[];
}) {
  if (items.length === 0) return null;

  return (
    <section className="mk-related">
      <h2>{heading}</h2>
      <div>
        {items.map((item) => (
          <Link href={item.href} key={item.href}>
            <strong>{item.label}</strong>
            {item.description ? <CardDescription>{item.description}</CardDescription> : null}
          </Link>
        ))}
      </div>
    </section>
  );
}

export function MarketingCta({
  title,
  body,
  primary = { href: "/sign-up", label: "Start for free" },
  secondary = { href: "/download", label: "Download desktop" },
}: {
  title: string;
  body?: string;
  primary?: { href: string; label: string };
  secondary?: { href: string; label: string };
}) {
  return (
    <section className="mk-cta">
      <h2>{title}</h2>
      {body ? <p>{body}</p> : null}
      <div className="flex flex-wrap gap-3">
        <MarketingButtonLink href={primary.href}>{primary.label}</MarketingButtonLink>
        <MarketingButtonLink href={secondary.href} variant="outline">
          {secondary.label}
        </MarketingButtonLink>
      </div>
    </section>
  );
}

export function CatalogIndex({
  eyebrow,
  title,
  description,
  items,
}: {
  eyebrow: string;
  title: string;
  description: string;
  items: { href: string; title: string; body: string }[];
}) {
  return (
    <div className="mk-index linear-subpage">
      <div className="linear-inset">
        <p className="linear-eyebrow">{eyebrow}</p>
        <h1 className="linear-subpage-title">{title}</h1>
        <p className="linear-body mt-5 max-w-2xl">{description}</p>
        <div className="mk-index-grid">
          {items.map((item) => (
            <Link className="mk-index-card" href={item.href} key={item.href}>
              <strong>{item.title}</strong>
              <CardDescription>{item.body}</CardDescription>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

export function JsonLd({ data }: { data: unknown }) {
  // Catalog JSON-LD only. Escape "<" so a string cannot close the script tag.
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return <script dangerouslySetInnerHTML={{ __html: json }} type="application/ld+json" />;
}
