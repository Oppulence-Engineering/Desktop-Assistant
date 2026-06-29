import type { Metadata } from "next";

import { HomePage } from "./marketing-components";

export const metadata: Metadata = {
  title: "Oppulence - Local-first AI coworker and agent platform",
  description:
    "Oppulence turns email, calendar, meetings, and operational context into an owned knowledge graph that agents can reason over and act on.",
};

export default function Page() {
  return <HomePage />;
}
