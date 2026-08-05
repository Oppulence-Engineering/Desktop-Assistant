import App from "./app";
import { connection } from "next/server";
import { requireActiveBillingSubscription } from "@/app/lib/billing";

export default async function Page() {
  // Request-time only: the subscription gate is per-session and must not be
  // skipped by a build-time prerender (where billing flags are unset).
  await connection();
  await requireActiveBillingSubscription();
  return <App />;
}
