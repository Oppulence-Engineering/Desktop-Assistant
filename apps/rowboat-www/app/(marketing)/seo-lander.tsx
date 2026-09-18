import { MarketingFaq } from "./marketing-faq";
import { JsonLd, RelatedPages, SectionHeading } from "./marketing-primitives";
import { breadcrumbJsonLd, definedTermJsonLd, faqJsonLd } from "./metadata";
import type { SeoAlternative, SeoLander } from "./seo-theme";

/**
 * Ferndesk lander body: definition, three blurred terms, for / not-for, FAQ
 * schema. Shared by leftover FeatureMirror routes and the answer hub.
 */
export function SeoLanderSections({ lander }: { lander: SeoLander }) {
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Answers", path: "/answers" },
          { name: lander.query, path: `/${lander.path}` },
        ])}
      />
      <JsonLd data={definedTermJsonLd(lander.query, lander.definition)} />
      <JsonLd data={faqJsonLd(lander.faqs)} />

      <section className="mk-seo-definition">
        <SectionHeading eyebrow="[definition]" title={lander.definitionTitle} />
        <p>{lander.definition}</p>
      </section>

      <section className="mk-capability-grid">
        <SectionHeading
          eyebrow="[terms people blur]"
          title="Three jobs that are not the same."
        />
        <div>
          {lander.distinctions.map((item) => (
            <article key={item.title}>
              <p className="mk-seo-chip">{item.chip}</p>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mk-seo-audience">
        <div>
          <SectionHeading eyebrow="[for]" title="This page is for you if" />
          <ul>
            {lander.for.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div>
          <SectionHeading eyebrow="[not for]" title="This is the wrong page if" />
          <ul>
            {lander.notFor.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </section>

      <MarketingFaq
        heading="Questions this URL actually answers"
        items={lander.faqs}
        lede="The leftover slug is a search path. The answers stay honest about the product."
      />

      <RelatedPages
        items={lander.cluster.map((item) => ({
          label: item.label,
          href: item.href,
          description: item.description,
        }))}
      />
    </>
  );
}

export function SeoLanderChips({ chips }: { chips: string[] }) {
  return (
    <p className="mk-seo-chips">
      {chips.map((chip) => (
        <span key={chip}>{chip}</span>
      ))}
    </p>
  );
}

export function SeoAlternativeSections({ alternative }: { alternative: SeoAlternative }) {
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Answers", path: "/answers" },
          { name: alternative.competitor, path: `/blog/${alternative.slug}` },
        ])}
      />
      <JsonLd data={faqJsonLd(alternative.faqs)} />

      <section className="mk-seo-audience">
        <div>
          <SectionHeading eyebrow="[what they are]" title={`${alternative.competitor} is ${alternative.category} software.`} />
          <p>{alternative.whatTheyAre}</p>
        </div>
        <div>
          <SectionHeading eyebrow="[what we are]" title="Oppulence is a commitment ledger." />
          <p>{alternative.whatWeAre}</p>
        </div>
      </section>

      <section className="mk-seo-audience">
        <div>
          <SectionHeading eyebrow="[keep them]" title="Stay in that category when" />
          <ul>
            {alternative.keepThemWhen.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div>
          <SectionHeading eyebrow="[choose us]" title="Sit the register next to them when" />
          <ul>
            {alternative.chooseUsWhen.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </section>

      <MarketingFaq
        heading="The honest comparison"
        items={alternative.faqs}
        lede="We will not publish a fake ranked list of help-center vendors."
      />
    </>
  );
}
