import { requireBillingCustomer } from "../lib/billing";
import { BillingPage } from "./app";
import { getUsage } from "../lib/billing";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { USE_BILLING } from "../lib/feature_flags";

export default async function Page() {
  // Request-time only: USE_BILLING is a runtime env flag and the customer /
  // usage reads are per-session.
  await connection();
  if (!USE_BILLING) {
    redirect("/projects");
  }

  const customer = await requireBillingCustomer();
  const usage = await getUsage(customer.id);
  return <BillingPage customer={customer} usage={usage} />;
}
