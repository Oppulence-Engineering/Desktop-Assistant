/** A body block inside a legal section. */
export type LegalBlock = string | string[] | { term: string; text: string }[] | { callout: string };

export type LegalSection = {
  heading: string;
  summary?: string;
  body: LegalBlock[];
};

export type LegalRelatedLink = {
  label: string;
  href: string;
};
