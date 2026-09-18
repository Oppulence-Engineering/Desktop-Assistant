import Link from "next/link";

import { guidePages, indexCopy } from "../catalog";
import { CatalogIndex } from "../marketing-primitives";
import { marketingMetadata } from "../metadata";

export const metadata = marketingMetadata({
  title: "Resources",
  description: indexCopy.resources.description,
  path: "/resources",
});

const extra = [
  {
    href: "/changelog",
    title: "Changelog",
    body: "Desktop releases from GitHub. No invented version numbers.",
  },
  {
    href: "/security",
    title: "Security",
    body: "What stays on the machine, what syncs, what waits for approval.",
  },
  {
    href: "/integrations",
    title: "Integrations",
    body: "Gmail, Calendar, Slack, HubSpot, MCP.",
  },
  {
    href: "/blog",
    title: "Blog",
    body: "Editorial notes from the product. Categories: product, workflow, security, install.",
  },
  {
    href: "/customers",
    title: "Customers",
    body: "A published-story index. Empty until a real write-up is approved.",
  },
  {
    href: "/compare",
    title: "Compare",
    body: "CRM, inbox, meeting notes, and generic assistants — only the seams we can defend.",
  },
];

export default function ResourcesPage() {
  return (
    <div className="mk-index linear-subpage">
      <CatalogIndex
        description={indexCopy.resources.description}
        eyebrow="[resources]"
        items={[
          ...guidePages.map((page) => ({
            href: page.path,
            title: page.title,
            body: page.description,
          })),
          ...extra,
        ]}
        title={indexCopy.resources.title}
      />
      <p className="linear-inset mk-resources-note">
        Documentation for the API lives at{" "}
        <Link href="https://docs.oppulence.io">docs.oppulence.io</Link>. We are not building a
        second docs tree here.
      </p>
    </div>
  );
}
