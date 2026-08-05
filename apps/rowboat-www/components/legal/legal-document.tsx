import Link from "next/link";

import { CurrentYear } from "./current-year";

/**
 * One legal section: a heading followed by body blocks. A string block is a
 * paragraph; a string[] block renders as a bullet list.
 */
export type LegalSection = {
  heading: string;
  body: (string | string[])[];
};

export function LegalDocument({
  title,
  lastUpdated,
  intro,
  sections,
  otherDoc,
}: {
  title: string;
  lastUpdated: string;
  intro: string;
  sections: LegalSection[];
  otherDoc: { label: string; href: string };
}) {
  return (
    <div className="app-shell min-h-svh bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-6">
          <Link className="flex items-center gap-2.5" href="/">
            <img alt="" className="size-5" src="/marketing/oppulence-icon.png" />
            <span className="font-display text-base">Oppulence</span>
          </Link>
          <Link
            className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            href="/"
          >
            Back to home
          </Link>
        </div>
      </header>

      <article className="mx-auto max-w-3xl px-6 py-14">
        <p className="font-mono text-xs text-oppulence-orange">[legal]</p>
        <h1 className="mt-2 font-display text-4xl">{title}</h1>
        <p className="mt-3 font-mono text-xs text-muted-foreground">Last updated: {lastUpdated}</p>
        <p className="mt-6 text-base leading-relaxed text-primary/80">{intro}</p>

        <div className="mt-10 space-y-10">
          {sections.map((section, index) => (
            <section key={section.heading}>
              <h2 className="text-lg font-medium text-foreground">
                <span className="mr-2 font-mono text-sm text-muted-foreground">
                  {String(index + 1).padStart(2, "0")}
                </span>
                {section.heading}
              </h2>
              <div className="mt-3 space-y-3">
                {section.body.map((block, i) =>
                  Array.isArray(block) ? (
                    <ul className="ml-1 space-y-2" key={i}>
                      {block.map((item) => (
                        <li
                          className="flex gap-2.5 text-sm leading-relaxed text-primary/70"
                          key={item}
                        >
                          <span className="mt-2 size-1 shrink-0 rounded-full bg-oppulence-orange" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm leading-relaxed text-primary/70" key={i}>
                      {block}
                    </p>
                  ),
                )}
              </div>
            </section>
          ))}
        </div>
      </article>

      <footer className="border-t">
        <div className="mx-auto flex max-w-3xl flex-col items-center justify-between gap-3 px-6 py-8 text-sm text-muted-foreground sm:flex-row">
          <span className="font-mono text-xs">
            © <CurrentYear /> Oppulence
          </span>
          <div className="flex items-center gap-5">
            <Link
              className="underline-offset-4 hover:text-foreground hover:underline"
              href={otherDoc.href}
            >
              {otherDoc.label}
            </Link>
            <Link className="underline-offset-4 hover:text-foreground hover:underline" href="/">
              Home
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
