import { App } from "./app";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { USE_AUTH } from "./lib/feature_flags";

export default async function Home() {
  // Request-time only: USE_AUTH comes from the runtime env, so prerendering
  // this route would bake the build machine's (unset) flag into the page.
  await connection();
  if (!USE_AUTH) {
    redirect("/projects");
  }
  return <App />;
}
