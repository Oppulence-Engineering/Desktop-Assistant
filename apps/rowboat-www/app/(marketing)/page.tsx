import type { Metadata } from "next";

import { HomePage } from "./marketing-components";

export const metadata: Metadata = {
  title: "Oppulence — Turn silence back into revenue",
  description:
    "Oppulence watches your inbox, calendar, and billing. It finds the deals, invoices, and clients that go quiet. It writes the chase in your voice. You approve every send.",
};

export default function Page() {
  return <HomePage />;
}
