"use client";

import { useId, useState } from "react";
import { motion } from "motion/react";

import { CaretDown } from "@/lib/icons";
import { cn } from "@/lib/sim/cn";

export interface SimLandingFaqItem {
  question: string;
  answer: string;
}

/**
 * Accordion FAQ for landing pages. Answers stay mounted (collapsed via
 * animated height) so crawlers see the full Q&A text and FAQPage JSON-LD
 * always matches visible content — ported from sim.ai `LandingFAQ`.
 */
export function SimLandingFaq({ faqs }: { faqs: SimLandingFaqItem[] }) {
  const baseId = useId();
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  return (
    <div>
      {faqs.map(({ question, answer }, index) => {
        const isOpen = openIndex === index;
        const showDivider = index > 0 && hoveredIndex !== index && hoveredIndex !== index - 1;
        const panelId = `${baseId}-faq-panel-${index}`;

        return (
          <div key={question}>
            <div
              className={cn(
                "h-px w-full bg-[var(--border)]",
                index === 0 || !showDivider ? "invisible" : "visible",
              )}
            />
            <h3>
              <button
                aria-controls={panelId}
                aria-expanded={isOpen}
                className="flex w-full items-center justify-between gap-4 py-4 text-left transition-colors hover:bg-[var(--surface-hover)]"
                onClick={() => setOpenIndex(isOpen ? null : index)}
                onMouseEnter={() => setHoveredIndex(index)}
                onMouseLeave={() => setHoveredIndex(null)}
                type="button"
              >
                <span
                  className={cn(
                    "text-[15px] leading-snug tracking-[-0.02em] transition-colors",
                    isOpen
                      ? "text-[var(--text-primary)]"
                      : "text-[var(--text-body)] hover:text-[var(--text-primary)]",
                  )}
                >
                  {question}
                </span>
                <CaretDown
                  aria-hidden="true"
                  className={cn(
                    "size-3 shrink-0 text-[var(--text-muted)] transition-transform duration-200",
                    isOpen ? "rotate-180" : "rotate-0",
                  )}
                />
              </button>
            </h3>

            <motion.div
              animate={{ height: isOpen ? "auto" : 0, opacity: isOpen ? 1 : 0 }}
              aria-hidden={!isOpen}
              className="overflow-hidden"
              id={panelId}
              initial={false}
              transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
            >
              <div className="pt-2 pb-4">
                <p className="text-[14px] text-[var(--text-body)] leading-[1.75]">{answer}</p>
              </div>
            </motion.div>
          </div>
        );
      })}
    </div>
  );
}
