"use client";

import "client-only";

import { MarketingSpan } from "./marketing-primitives";
import { cn } from "@/lib/utils";

export type MarketingFaqItem = {
  question: string;
  answer: string;
};

/**
 * Accessible disclosure list. Native details/summary keeps this a small client
 * island: no accordion library, keyboard support for free, and the answers
 * remain in the HTML for no-JS visitors.
 */
export function MarketingFaq({
  items,
  className,
  heading = "Questions people actually ask",
  lede,
}: {
  items: MarketingFaqItem[];
  className?: string;
  heading?: string;
  lede?: string;
}) {
  return (
    <section className={cn("linear-faq mk-faq", className)}>
      <header>
        <h2>{heading}</h2>
        {lede ? <p>{lede}</p> : null}
      </header>
      <div>
        {items.map((item, index) => (
          <details key={item.question}>
            <summary>
              {String(index + 1).padStart(2, "0")} {item.question}
              <MarketingSpan aria-hidden="true">+</MarketingSpan>
            </summary>
            <p>{item.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
