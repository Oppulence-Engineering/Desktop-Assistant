import Link from "next/link";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@oppulence/ui/components/table";
import { fullRouteCatalog } from "@/lib/dev/route-catalog";

export const metadata = {
  title: "Route catalog (dev)",
  robots: { index: false, follow: false },
};

export default function DevRoutesPage() {
  const routes = fullRouteCatalog();

  return (
    <main className="mx-auto max-w-4xl space-y-8">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-widest opacity-60">Development only</p>
        <h1 className="text-2xl font-semibold">Route catalog</h1>
        <p className="opacity-70 leading-relaxed">
          Product routes, BFF endpoints, client boundaries, and README pointers. Open the floating{" "}
          <strong>Dev</strong> toolkit for vitals, API log, MSW, and session tools.
        </p>
      </header>
      <Table className="w-full text-left text-xs">
        <TableHeader>
          <TableRow className="border-b border-foreground/15 hover:bg-transparent">
            <TableHead className="py-2 pr-4">Path</TableHead>
            <TableHead className="py-2 pr-4">Auth</TableHead>
            <TableHead className="py-2 pr-4">Client boundary</TableHead>
            <TableHead className="py-2">BFF</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {routes.map((route) => (
            <TableRow key={route.path} className="border-b border-foreground/8 align-top">
              <TableCell className="py-3 pr-4">
                <Link className="underline" href={route.path}>
                  {route.path}
                </Link>
                <div className="opacity-60">{route.label}</div>
                {route.readme ? <div className="mt-1 opacity-50">{route.readme}</div> : null}
              </TableCell>
              <TableCell className="py-3 pr-4">{route.auth}</TableCell>
              <TableCell className="py-3 pr-4 opacity-80">{route.clientBoundary}</TableCell>
              <TableCell className="py-3 opacity-80">
                {route.bffEndpoints.length === 0 ? (
                  "—"
                ) : (
                  <ul className="list-disc pl-4 space-y-1">
                    {route.bffEndpoints.map((endpoint) => (
                      <li key={endpoint}>{endpoint}</li>
                    ))}
                  </ul>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <section className="space-y-2 opacity-80">
        <h2 className="text-lg font-medium">Quick commands</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <code>npm run dev:stack</code> — validate env, check API, hot-reload www
          </li>
          <li>
            <code>npm run dev:contracts</code> — regenerate Orval clients from OpenAPI
          </li>
          <li>
            <code>npm run dev:doctor</code> — React Doctor static analysis
          </li>
          <li>
            <code>npm run test:e2e:ui</code> — Playwright UI mode
          </li>
        </ul>
      </section>
    </main>
  );
}
