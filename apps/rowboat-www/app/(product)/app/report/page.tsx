import { ReportDashboardRoute } from "@/components/features/dashboard/dashboard-route-content/dashboard-route-content";

// The Open Promises report is the wedge (one-pager §11). Signup lands here:
// connect Gmail, scan six months, read the document. The sale and the activation
// are one motion, so this route asks for nothing else first — no model key, no
// workspace setup, no configuration.
export const metadata = {
  title: "Open promises - Oppulence",
  description: "The commitments your team made that have no evidence of fulfilment.",
};

export default function ReportPage() {
  return <ReportDashboardRoute />;
}
