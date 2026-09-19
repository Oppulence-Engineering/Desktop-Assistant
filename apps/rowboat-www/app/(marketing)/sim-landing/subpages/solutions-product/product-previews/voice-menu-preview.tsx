"use client";

import { Chip } from "@sim/emcn";
import { Mic, MicOff, Pause, Square } from "@sim/emcn/icons";

import { cn } from "@/lib/sim/cn";

import { MenuPreviewFrame } from "../../../shared/menu-preview-frame";

interface VoiceMenuPreviewProps {
  layout?: "menu" | "hero" | "stage";
}

const HOTKEYS = [
  { label: "Dictate", combo: "⌥ Space", active: true },
  { label: "Meeting mode", combo: "⌥ ⇧ M" },
  { label: "Translate paste", combo: "⌥ ⇧ T" },
] as const;

const WAVEFORM = [
  3, 8, 14, 22, 18, 26, 12, 20, 9, 16, 24, 11, 19, 7, 15, 21, 10, 17, 13, 23,
] as const;

/** Voice capture panel — waveform, hotkeys, and local-only badge. */
export function VoiceMenuPreview({ layout = "menu" }: VoiceMenuPreviewProps) {
  return (
    <MenuPreviewFrame kind="voice" layout={layout}>
      <div className="w-[420px] overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--bg)] text-[var(--text-body)] text-small shadow-xs">
        <div className="flex h-11 items-center gap-2 border-[var(--border)] border-b px-4">
          <Mic className="size-[14px] text-[var(--text-icon)]" />
          <span className="text-[var(--text-primary)]">Voice capture</span>
          <Chip className="ml-auto">Local option</Chip>
        </div>
        <div className="border-[var(--border)] border-b px-4 py-5">
          <div className="mb-3 flex items-center justify-between">
            <span className="font-medium text-[var(--text-primary)]">Listening…</span>
            <span className="text-[var(--text-muted)] tabular-nums">00:12</span>
          </div>
          <div aria-hidden className="flex h-10 items-end justify-center gap-[3px]">
            {WAVEFORM.map((height, index) => (
              <span
                className="w-[3px] rounded-full bg-[var(--accent)] motion-safe:animate-pulse"
                key={index}
                style={{
                  height: `${height}px`,
                  animationDelay: `${index * 45}ms`,
                  opacity: 0.35 + (height / 26) * 0.65,
                }}
              />
            ))}
          </div>
          <div className="mt-4 flex items-center justify-center gap-2">
            <button
              className="flex size-8 items-center justify-center rounded-full border border-[var(--border)]"
              type="button"
            >
              <Pause className="size-[14px]" />
            </button>
            <button
              className="flex size-9 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-fg)]"
              type="button"
            >
              <Square className="size-[14px]" />
            </button>
            <button
              className="flex size-8 items-center justify-center rounded-full border border-[var(--border)]"
              type="button"
            >
              <MicOff className="size-[14px]" />
            </button>
          </div>
        </div>
        <ul className="flex flex-col p-2">
          {HOTKEYS.map((item) => (
            <li
              className={cn(
                "flex items-center justify-between gap-3 rounded-md px-3 py-2.5",
                "active" in item && item.active && "bg-[var(--surface-3)]",
              )}
              key={item.label}
            >
              <span className="text-[var(--text-primary)]">{item.label}</span>
              <kbd className="rounded border border-[var(--border)] px-2 py-0.5 font-mono text-xs">
                {item.combo}
              </kbd>
            </li>
          ))}
        </ul>
      </div>
    </MenuPreviewFrame>
  );
}
