import Image from "next/image";
import Link from "next/link";

import { cn } from "@/lib/utils";

type RelationshipView = "observe" | "model" | "prioritize" | "act";
type ProductSurface = "desktop" | "web";

const relationshipPillars = [
  {
    title: "Observe",
    body: "Email, meetings, Slack, CRM, and revenue systems emit evidence.",
    icon: "/marketing/relationship-system/observe.png",
  },
  {
    title: "Model",
    body: "Oppulence maintains one living state for each relationship.",
    icon: "/marketing/relationship-system/model.png",
  },
  {
    title: "Prioritize",
    body: "Changes, risks, and open loops become a ranked Monday queue.",
    icon: "/marketing/relationship-system/prioritize.png",
  },
  {
    title: "Act",
    body: "Every next move shows its evidence and waits for approval.",
    icon: "/marketing/relationship-system/act.png",
  },
];

const relationshipDeepDives: {
  body: string;
  bullets: string[];
  eyebrow: string;
  screenshot: string;
  surface: ProductSurface;
  title: string;
}[] = [
  {
    eyebrow: "Observe",
    title: "Bring every signal into one relationship timeline.",
    body: "The desktop app watches the work already happening and resolves it into evidence: a promise in email, an objection in a meeting, a decision in Slack, or a stage change in CRM.",
    bullets: [
      "One chronological view across every connected source",
      "Source identity and sync health stay visible",
      "Raw activity remains separate from inferred state",
    ],
    screenshot: "/marketing/relationship-desktop.png",
    surface: "desktop",
  },
  {
    eyebrow: "Model",
    title: "Maintain a living model, not another activity log.",
    body: "Oppulence continuously updates identity, lifecycle, engagement, sentiment, commitments, and risk. Every assertion keeps the evidence and confidence that produced it.",
    bullets: [
      "State changes as the relationship changes",
      "Corrections become durable relationship memory",
      "Web and desktop read from the same model",
    ],
    screenshot: "/marketing/relationship-web-list.png",
    surface: "web",
  },
  {
    eyebrow: "Prioritize",
    title: "Know which relationship needs action now.",
    body: "The queue ranks accounts by what changed, what is at stake, and whether a real commitment is becoming overdue—not by a generic engagement score.",
    bullets: [
      "Attention is ranked with a human-readable reason",
      "Money, timing, and relationship context stay together",
      "Every recommendation can be traced to evidence",
    ],
    screenshot: "/marketing/relationship-desktop.png",
    surface: "desktop",
  },
  {
    eyebrow: "Act",
    title: "Move with evidence—and keep the human in control.",
    body: "Oppulence drafts the next move from the actual relationship history, runs policy checks, and waits. Nothing sends, updates, or touches money until a person approves it.",
    bullets: [
      "Drafts cite the signals that make them timely",
      "Blocked contacts and risky actions fail closed",
      "Outcomes flow back into relationship state",
    ],
    screenshot: "/marketing/relationship-web-detail.png",
    surface: "web",
  },
];

const productCaptures: Record<ProductSurface, Partial<Record<RelationshipView, string>>> = {
  desktop: {
    observe: "/marketing/relationship-desktop.png",
    prioritize: "/marketing/relationship-desktop.png",
  },
  web: {
    act: "/marketing/relationship-web-detail.png",
    model: "/marketing/relationship-web-list.png",
  },
};

export function RelationshipProductWindow({
  className,
  surface = "desktop",
  view = "prioritize",
}: {
  className?: string;
  surface?: ProductSurface;
  view?: RelationshipView;
}) {
  const src =
    productCaptures[surface][view] ??
    (surface === "desktop"
      ? "/marketing/relationship-desktop.png"
      : "/marketing/relationship-web-list.png");

  return (
    <figure className={cn("relationship-product-window is-capture", className)}>
      <Image
        alt={`Actual Oppulence ${surface} app showing the ${view} relationship workflow`}
        height={960}
        priority={view === "prioritize"}
        sizes="(max-width: 640px) 92vw, (max-width: 1100px) 90vw, 1180px"
        src={src}
        width={1440}
      />
    </figure>
  );
}

export function RelationshipSystemSection() {
  return (
    <section className="relationship-system">
      <div className="relationship-system-overview linear-inset">
        <header className="relationship-system-intro">
          <p className="linear-eyebrow">[the relationship system]</p>
          <h2>One living model. Four jobs.</h2>
          <p>
            Integrations are observers. The relationship is the product. Oppulence turns scattered
            evidence into shared state, a ranked queue, and a governed next move.
          </p>
        </header>

        <div className="relationship-pillar-grid">
          {relationshipPillars.map((pillar, index) => (
            <article className="relationship-pillar" key={pillar.title}>
              <span className="relationship-pillar-index">0{index + 1}</span>
              <Image
                alt=""
                aria-hidden="true"
                height={1254}
                sizes="(max-width: 640px) 72vw, (max-width: 1024px) 38vw, 260px"
                src={pillar.icon}
                width={1254}
              />
              <h3>{pillar.title}</h3>
              <p>{pillar.body}</p>
            </article>
          ))}
        </div>
      </div>

      <div className="relationship-system-deep-dives linear-inset">
        {relationshipDeepDives.map((section, index) => (
          <article
            className={cn("relationship-deep-dive", index % 2 === 1 && "is-reversed")}
            key={section.eyebrow}
          >
            <div className="relationship-deep-dive-media">
              <figure className="relationship-product-window is-capture">
                <Image
                  alt={`Actual Oppulence ${section.surface} app showing the ${section.eyebrow.toLowerCase()} relationship workflow`}
                  height={960}
                  loading="eager"
                  sizes="(max-width: 860px) 110vw, 820px"
                  src={section.screenshot}
                  width={1440}
                />
              </figure>
            </div>
            <div className="relationship-deep-dive-copy">
              <span className="relationship-deep-dive-number">0{index + 1}</span>
              <p className="linear-eyebrow">[{section.eyebrow.toLowerCase()}]</p>
              <h3>{section.title}</h3>
              <p>{section.body}</p>
              <ul>
                {section.bullets.map((bullet) => (
                  <li key={bullet}>{bullet}</li>
                ))}
              </ul>
              <Link href="/product">
                See how {section.eyebrow.toLowerCase()} works <span aria-hidden="true">→</span>
              </Link>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
