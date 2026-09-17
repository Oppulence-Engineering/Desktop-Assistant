import Link from "next/link";

import { Badge } from "@oppulence/ui/components/badge";

import { customerStorySlug, publishedCustomerStories } from "@/lib/content/editorial";

import { MarketingBreadcrumbs, MarketingCta } from "../marketing-primitives";
import { marketingMetadata } from "../metadata";

export const instant = false;

export const metadata = marketingMetadata({
  title: "Customers",
  description:
    "Published customer stories, when we have ones we can defend. The writing path is already in the repo. The wall of logos is not.",
  path: "/customers",
});

export default function CustomersIndexPage() {
  const stories = publishedCustomerStories();

  return (
    <div className="mk-article linear-subpage">
      <div className="linear-inset">
        <MarketingBreadcrumbs items={[{ label: "Home", href: "/" }, { label: "Customers" }]} />
        <header className="linear-subpage-hero">
          <div>
            <p className="linear-eyebrow">[customers]</p>
            <h1 className="linear-subpage-title mt-4">
              {stories.length > 0
                ? "Stories from operators using the register."
                : "Customer stories will live here. Not invented ones."}
            </h1>
          </div>
          <div className="linear-subpage-description">
            <p>
              The public site already knows how to render a story: company, role, approved quote,
              and MDX body via Fumadocs. A file is published only when <code>published</code> is
              true. Until then this index stays empty.
            </p>
          </div>
        </header>

        {stories.length === 0 ? (
          <section className="mk-customers-empty">
            <p>
              Add an approved write-up under <code>content/customers</code>. Do not invent a
              company, a logo, or a time-saved number to fill this page.
            </p>
          </section>
        ) : (
          <section className="mk-blog-list">
            {stories.map((story) => {
              const slug = customerStorySlug(story);
              return (
                <Link href={`/customers/${slug}`} key={slug}>
                  <Badge className="rounded-none" variant="outline">
                    {story.company}
                  </Badge>
                  <strong>{story.title}</strong>
                  <em>{story.description}</em>
                </Link>
              );
            })}
          </section>
        )}

        <MarketingCta
          title="Become one of the first operators we can write about honestly."
          body="Start with the free report. A story page waits until there is something concrete to show."
        />
      </div>
    </div>
  );
}
