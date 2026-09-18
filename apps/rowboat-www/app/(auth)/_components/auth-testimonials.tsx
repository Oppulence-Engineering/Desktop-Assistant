"use client";

import { useEffect, useState } from "react";

import { Badge } from "@oppulence/ui/components/badge";

export type Testimonial = {
  quote: string;
  name: string;
  title: string;
  avatar: string;
};

const ROTATE_MS = 3000;

/**
 * Rotating showcase quote. Cycles every 3s with a short cross-fade, pauses on
 * hover/focus so a reader is never cut off mid-sentence, and stays static for
 * users who prefer reduced motion (they still see the first quote).
 */
export function AuthTestimonials({ items }: { items: Testimonial[] }) {
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (items.length < 2 || paused) return;
    // matchMedia is missing in some embedded webviews and in jsdom, and a
    // throw here would take down the whole sign-in page. Treat it as "no
    // preference expressed" and still rotate.
    if (typeof window.matchMedia === "function") {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    }

    // Fade out just before swapping, so the text never pops between quotes.
    const fade = window.setTimeout(() => setVisible(false), ROTATE_MS - 260);
    const swap = window.setTimeout(() => {
      setIndex((current) => (current + 1) % items.length);
      setVisible(true);
    }, ROTATE_MS);

    return () => {
      window.clearTimeout(fade);
      window.clearTimeout(swap);
    };
  }, [index, items.length, paused]);

  const active = items[index];

  return (
    <figure
      aria-live="polite"
      className="sm-auth-quote"
      data-visible={visible ? "true" : "false"}
      onBlur={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="sm-auth-quote-body">
        <blockquote>{active.quote}</blockquote>
        <figcaption>
          <img alt="" src={active.avatar} />
          <Badge
            className="grid rounded-none border-0 bg-transparent p-0 font-normal shadow-none"
            variant="ghost"
          >
            <strong>{active.name}</strong>
            {active.title}
          </Badge>
        </figcaption>
      </div>

      {items.length > 1 ? (
        <div aria-hidden className="sm-auth-dots">
          {items.map((item, i) => (
            <Badge
              aria-hidden="true"
              className="block h-[3px] w-[18px] rounded-none border-0 bg-[var(--sm-line)] p-0 shadow-none data-[active=true]:bg-[var(--sm-blue)]"
              data-active={i === index ? "true" : "false"}
              key={item.quote}
              variant="ghost"
            />
          ))}
        </div>
      ) : null}
    </figure>
  );
}
