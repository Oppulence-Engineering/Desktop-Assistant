# Solomon AI Design Language

Solomon AI should feel like an ElevenLabs-style developer console for people who live in notes, agents, email, meetings, and files all day. The launch direction is quiet, fast, and prosumer: dense enough for repeated work, neutral enough for repeated use, and explicit about what the AI is doing.

## Principles

1. **Calm density**
   Keep the interface compact and scannable. Use tighter rows, restrained borders, and low-contrast panels so users can keep many contexts open without the app feeling heavy.

2. **Command first**
   Primary actions should feel like instant commands, not marketing CTAs. Side navigation, search, model selection, and composer controls use compact Lucide icon-led affordances with clear hover and selected states.

3. **Visible work state**
   AI actions, sync, saving, meeting capture, and background tasks need clear status surfaces. Prefer small persistent indicators over large banners.

4. **Notes as the canvas**
   The editor and conversation stay visually dominant. Chrome is supportive, not decorative. Avoid nested cards and oversized empty states in work surfaces.

5. **Neutral precision**
   The palette follows the ElevenLabs developer-console color system: white and graphite surfaces, black/white primary actions, neutral command tools, and reserved semantic colors for destructive and chart states.

## Tokens

- Radius: square corners throughout (`0`) — no rounded borders on panels, cards, buttons, inputs, dialogs, or tabs. The only exceptions are genuinely circular elements (avatars, status dots, spinners, and anything `rounded-full`).
- Backgrounds: white and very light neutral surfaces in light mode; graphite equivalents in dark mode.
- Borders: one-step darker than surfaces, quiet enough to separate panels without tinting them.
- Shadows: reserved for the composer, menus, dialogs, and active segmented controls.
- Type: system sans with tabular-feeling OpenType features enabled; no negative tracking.
- Accent use: primary and command affordances use the neutral developer palette. Extra hues are reserved for semantic states and charts.
- Icons: app UI icons come from **Heroicons** (`@heroicons/react`, 24/outline — the icon set by the Tailwind team, https://heroicons.com). Import from `@/lib/icons`, which wraps every Heroicon so it carries the `app-icon` class and the console conventions: a 24px default size (override with `size-*`/`w-*`/`h-*` or a numeric `size` prop), a 1.5 stroke, round caps, and `currentColor`. The icon polish (1.5 stroke, hover firm-up, press dip, selected-state weight) is enforced app-wide via `svg.app-icon { … }` in `App.css`. A few glyphs Heroicons lacks (`Circle`, `CircleDot`, `Quote`) are drawn inline in the same 24×24 / 1.5-stroke style inside `@/lib/icons`. **Providers and integrations use their authentic logomark** — a monochrome, single-path SVG filled with `currentColor` (official Simple Icons glyphs in `components/onboarding/provider-icons.tsx`) — never a whimsical icon stand-in (no cartoon robots, sparkles, or magnifying glasses for brands). Long-tail providers without an official mark fall back to a clean geometric Heroicon.

## Core Surfaces

- **Sidebar:** persistent workflow switcher with calm selected states. Quick-action icons use neutral ink from the dev palette.
- **Titlebar/tabs:** slim, scan-first navigation. Active tabs get a bottom signal line, not a bulky filled pill.
- **Composer:** the highest-emphasis control outside the active canvas. It is slightly raised, flat, bordered by the primary tone, and sharp enough to feel like an input terminal.
- **Messages:** user messages are compact structured blocks; assistant messages remain full-width and readable.
- **Status:** sync, saving, recording, and task activity stay small but always visible near the surface they affect.

## Launch Positioning

The visual story is: **Solomon AI is the personal AI workspace for people whose work already spans meetings, mail, notes, browser tasks, and agents.** It should feel closer to a focused desktop tool than a chat website.
