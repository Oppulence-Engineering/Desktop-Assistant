import { redirect } from "next/navigation";
import { connection } from "next/server";
import App from "./app";
import { requireAuth } from "../lib/auth";
import { USE_AUTH } from "../lib/feature_flags";

export default async function Page() {
  // Request-time only: USE_AUTH is a runtime env flag and requireAuth reads
  // the session.
  await connection();
  if (!USE_AUTH) {
    redirect("/projects");
  }
  await requireAuth();
  return <App />;
}
