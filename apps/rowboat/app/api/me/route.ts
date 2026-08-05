import { NextRequest, NextResponse } from "next/server";
import { connection } from "next/server";
import { authCheck } from "@/app/actions/auth.actions";
import { USE_AUTH } from "@/app/lib/feature_flags";

export async function GET(_req: NextRequest) {
  // Request-time only: with USE_AUTH unset at build, prerendering would bake
  // the guest identity into a static response served to every caller.
  await connection();
  try {
    let user;
    if (USE_AUTH) {
      user = await authCheck();
    } else {
      user = { id: "guest_user" } as any;
    }
    return NextResponse.json({ id: user.id });
  } catch (error) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
