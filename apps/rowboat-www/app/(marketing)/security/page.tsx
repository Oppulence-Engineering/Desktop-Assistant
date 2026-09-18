import { SimSecurityPage } from "../sim-landing/subpages/sim-security-page";
import { marketingMetadata } from "../metadata";

export const metadata = marketingMetadata({
  title: "Security and privacy",
  description:
    "What Oppulence can access, what stays on the device, what reaches the API or a model provider, and how you turn those pipes off.",
  path: "/security",
});

export default function SecurityPage() {
  return <SimSecurityPage />;
}
