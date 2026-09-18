"use client";

import { useId, useSyncExternalStore } from "react";
import { useTheme } from "next-themes";

import { Moon, Sun } from "@/lib/icons";
import { cn } from "@/lib/sim/cn";

const OPTIONS = [
  { value: "light", label: "Light theme", Icon: Sun },
  { value: "dark", label: "Dark theme", Icon: Moon },
] as const;

type ThemeOption = (typeof OPTIONS)[number]["value"];

const SEGMENT =
  "flex size-[22px] items-center justify-center rounded-full transition-colors duration-150 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-[var(--text-secondary)] peer-focus-visible:outline-offset-2";

const SEGMENT_TONE: Record<ThemeOption, string> = {
  light:
    "bg-[var(--surface-3)] text-[var(--text-primary)] dark:bg-transparent dark:text-[var(--text-secondary)] dark:hover:text-[var(--text-primary)]",
  dark: "text-[var(--text-secondary)] hover:text-[var(--text-primary)] dark:bg-[var(--surface-3)] dark:text-[var(--text-primary)]",
};

function useHydrated() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

/** Sim footer theme toggle using the app-wide next-themes provider. */
export function SimThemeToggle() {
  const groupName = useId();
  const { resolvedTheme, setTheme } = useTheme();
  const hydrated = useHydrated();

  return (
    <div
      aria-label="Color theme"
      className="inline-flex items-center gap-[2px] rounded-full border border-[var(--border)] p-[2px]"
      role="radiogroup"
    >
      {OPTIONS.map(({ value, label, Icon }) => (
        <label className="relative cursor-pointer" key={value}>
          <input
            aria-label={label}
            checked={hydrated && resolvedTheme === value}
            className="peer sr-only"
            name={groupName}
            onChange={() => setTheme(value)}
            type="radio"
            value={value}
          />
          <span className={cn(SEGMENT, SEGMENT_TONE[value])}>
            <Icon aria-hidden="true" className="size-[13px]" weight="regular" />
          </span>
        </label>
      ))}
    </div>
  );
}
