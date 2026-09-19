import { cacheLife } from "next/cache";

import { customerStorySlug, publishedCustomerStories } from "@/lib/content/editorial";

import { SimCustomersIndexPage } from "../sim-landing/subpages/sim-customers-index-page";
import { marketingMetadata } from "../metadata";

export const metadata = marketingMetadata({
  title: "Customers",
  description:
    "Published customer stories, when we have ones we can defend. The writing path is already in the repo. The wall of logos is not.",
  path: "/customers",
});

export default async function CustomersIndexPage() {
  "use cache";
  cacheLife("days");
  const stories = publishedCustomerStories();

  return (
    <SimCustomersIndexPage
      stories={stories.map((story) => {
        const slug = customerStorySlug(story);
        return {
          slug,
          href: `/customers/${slug}`,
          title: story.title,
          description: story.description,
          company: story.company,
        };
      })}
    />
  );
}
