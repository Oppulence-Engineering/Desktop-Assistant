import { cacheLife } from "next/cache";

import { SimAnswersPage } from "../sim-landing/subpages/sim-answers-page";
import { marketingMetadata } from "../metadata";
import { seoAlternativeList, seoLanderList } from "../seo-theme";

const TITLE = "Answers";
const DESCRIPTION =
  "Definitions for leftover search URLs. Help-center queries stay answered; the product they describe is a commitment ledger, not a /help host.";

export const metadata = marketingMetadata({
  title: TITLE,
  description: DESCRIPTION,
  path: "/answers",
});

const itemList = {
  "@context": "https://schema.org",
  "@type": "ItemList",
  name: "Oppulence answers",
  itemListElement: seoLanderList.map((lander, index) => ({
    "@type": "ListItem",
    position: index + 1,
    name: lander.query,
    url: `https://oppulence.io/${lander.path}`,
  })),
};

export default async function AnswersPage() {
  "use cache";
  cacheLife("days");

  return (
    <SimAnswersPage
      alternativeItems={seoAlternativeList.map((page) => ({
        href: `/blog/${page.slug}`,
        title: `${page.competitor} alternatives`,
        body: page.description,
      }))}
      answerItems={seoLanderList.map((lander) => ({
        href: `/${lander.path}`,
        title: lander.query,
        body: lander.description,
      }))}
      description={DESCRIPTION}
      itemListJsonLd={itemList}
    />
  );
}
