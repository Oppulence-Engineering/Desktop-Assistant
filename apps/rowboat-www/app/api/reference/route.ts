import { NextResponse } from "next/server";

import { publicRowboatApiURL } from "@/lib/rowboat-public-api";

export async function GET(): Promise<NextResponse> {
  const docsURL = publicRowboatApiURL("/docs");
  return NextResponse.redirect(docsURL, 307);
}
