import type { Metadata } from "next";

import { HomePage } from "./marketing-components";

export const metadata: Metadata = {
  title: "Oppulence — The living work graph for agents",
  description:
    "Oppulence turns email, calendar, meetings, files, and tools into an owned graph that agents can inspect before they brief, draft, update, or act.",
};

export default function Page() {
  return <HomePage />;
}
