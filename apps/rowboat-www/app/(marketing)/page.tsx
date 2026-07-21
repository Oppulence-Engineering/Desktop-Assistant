import type { Metadata } from "next";

import { HomePage } from "./marketing-components";

export const metadata: Metadata = {
  title: "Oppulence — Turn forgotten relationships into revenue",
  description:
    "Oppulence remembers every commercial relationship, identifies who needs attention and why, then safely prepares the next revenue action for approval.",
};

export default function Page() {
  return <HomePage />;
}
