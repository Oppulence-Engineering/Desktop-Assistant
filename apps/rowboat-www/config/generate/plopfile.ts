import type { NodePlopAPI } from "plop";

/**
 * Plop registration surface for the growth-standard generators.
 *
 * The public door is `npm run gen`. This file exists so Plop remains the named
 * open-source template engine and so `npx plop --plopfile config/generate/plopfile.ts`
 * can list the kinds. Path policy, overwrite refusal, and Zod input validation
 * live in `scripts/generate.ts` so tests can exercise them without Plop's
 * interactive destination root.
 */
const kinds = [
  ["lit", "Living Interface Template beside a generated unit"],
  ["schema", "Zod-only validation module"],
  ["component", "Product or route-private component"],
  ["page", "Authenticated App Router skeleton"],
  ["lib", "Non-UI domain helper"],
  ["hook", "TanStack Query hook + fetcher + keys + prefetch"],
  ["mutation", "TanStack Query mutation + Orval write transport"],
  ["store", "Ephemeral Zustand store"],
  ["story", "Colocated Storybook CSF"],
  ["feature", "Composer: page + panel and optional hook/lib/store"],
] as const;

export default function registerGenerators(plop: NodePlopAPI): void {
  plop.setWelcomeMessage("Use npm run gen -- <kind>. See docs/growth-standard.md.");
  for (const [name, description] of kinds) {
    plop.setGenerator(name, {
      description,
      prompts: [],
      actions: [],
    });
  }
}
