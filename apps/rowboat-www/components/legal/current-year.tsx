"use client";

import { useEffect, useState } from "react";

/**
 * Cache Components forbids reading the clock during prerender (server or
 * client pass), so the year is deferred to an effect: the prerendered shell
 * renders it empty and hydration fills in the visitor's current year.
 */
export function CurrentYear() {
  const [year, setYear] = useState<number | null>(null);

  useEffect(() => {
    setYear(new Date().getFullYear());
  }, []);

  return <span>{year}</span>;
}
