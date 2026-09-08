"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

export type PlatformRailItem = {
  id: string;
  nav: string;
  title: string;
  description: string;
  label: string;
  bullets: readonly string[];
  src: string;
  alt: string;
};

/**
 * Mirrors attio.com's platform section: a sticky left rail whose active item
 * tracks the row currently crossing the viewport middle, beside a stack of
 * hairline-separated rows. The rail collapses to a horizontal strip on narrow
 * screens, matching Attio's `max-lg` treatment.
 */
export function PlatformRail({ items }: { items: readonly PlatformRailItem[] }) {
  const [activeId, setActiveId] = useState(items[0]?.id ?? "");
  const rowRefs = useRef(new Map<string, HTMLElement>());

  useEffect(() => {
    const onScroll = () => {
      const middle = window.innerHeight / 2;
      let best: { id: string; distance: number } | null = null;

      for (const [id, node] of rowRefs.current) {
        const rect = node.getBoundingClientRect();
        // Prefer the row whose body straddles the viewport middle.
        const distance =
          rect.top <= middle && rect.bottom >= middle
            ? 0
            : Math.min(Math.abs(rect.top - middle), Math.abs(rect.bottom - middle));
        if (!best || distance < best.distance) {
          best = { id, distance };
        }
      }

      if (best) {
        setActiveId(best.id);
      }
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <div className="sm-attio-platform-grid">
      <nav aria-label="Platform capabilities" className="sm-attio-rail">
        {items.map((item) => (
          <a
            aria-current={item.id === activeId ? "true" : undefined}
            data-active={item.id === activeId ? "true" : "false"}
            href={`#${item.id}`}
            key={item.id}
          >
            {item.nav}
          </a>
        ))}
      </nav>

      <div className="sm-attio-rows">
        {items.map((item) => (
          <article
            className="sm-attio-row"
            id={item.id}
            key={item.id}
            ref={(node) => {
              if (node) {
                rowRefs.current.set(item.id, node);
              } else {
                rowRefs.current.delete(item.id);
              }
            }}
          >
            <div className="sm-attio-row-copy">
              <h3>
                <span>{item.title}</span>
                <span>{` ${item.description}`}</span>
              </h3>
              <ul>
                {item.bullets.map((bullet) => (
                  <li key={bullet}>{bullet}</li>
                ))}
              </ul>
            </div>
            <figure className="sm-attio-row-media">
              <Image alt={item.alt} height={1120} src={item.src} width={1680} />
            </figure>
          </article>
        ))}
      </div>
    </div>
  );
}
