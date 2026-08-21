**Source Visual Truth**

- Structural reference: `/var/folders/bp/77ytmsh11xzd9bjr8kyh60680000gn/T/codex-clipboard-uyIJpE.png`
- Oppulence product-language reference: `/Users/dyomba/go/src/github.com/Oppulence-Engineering/rowboat/apps/rowboat-www/public/marketing/relationship-desktop.png`
- User-rejected first pass: `/var/folders/bp/77ytmsh11xzd9bjr8kyh60680000gn/T/codex-clipboard-eD3AFS.png`

**Implementation Evidence**

- Final desktop screenshot: `/tmp/oppulence-design-qa/desktop-download-open-full-width.png`
- Final mobile screenshots:
  - `/tmp/oppulence-design-qa/desktop-download-mobile-closed.png`
  - `/tmp/oppulence-design-qa/desktop-download-mobile-open.png`
- Viewport: 1440 x 960 CSS px for desktop; 390 x 844 CSS px for mobile
- Source pixels: 1916 x 657 for the structural reference and 1440 x 960 for the Oppulence reference
- Implementation pixels: 1440 x 960 for desktop
- Density normalization: desktop implementation and Oppulence product reference were compared at the same 1440 x 960 pixel size and 1x CSS viewport scale; the structural reference was used for hierarchy rather than pixel matching
- State: desktop hero, download chooser expanded, macOS selected, Apple silicon recommended
- Measured layout: chooser width 1280px, parent width 1280px, width delta 0px, expanded height approximately 258px
- Full-view comparison: `/tmp/oppulence-design-qa/desktop-download-comparison.png`
- Focused comparison: `/tmp/oppulence-design-qa/desktop-download-focused-comparison.png`

**Findings**

- No actionable P0, P1, or P2 differences remain.
- Fonts and typography: the chooser uses the existing Oppulence sans and monospace stacks, compact 10–14px UI sizing, restrained weight, and short line lengths consistent with the product screenshots.
- Spacing and layout rhythm: the expanded chooser fills its parent exactly, uses a flat tab-and-row structure, 2px radii, hairline dividers, and compact vertical spacing without the oversized empty columns in the first pass.
- Colors and visual tokens: the implementation uses the existing neutral page, foreground, muted, and border tokens. No blue or green cast was introduced.
- Image quality and asset fidelity: the chooser does not require raster imagery. Existing Material UI icons remain sharp at native size and no source imagery was replaced with an approximation.
- Copy and content: platform names, architectures, formats, recommendation state, and continuity with the web app are explicit and concise.
- Responsive behavior: the mobile layout measures 390px viewport width and 390px document scroll width, with no horizontal overflow. Platform tabs and installer rows remain usable.
- Interaction states: collapse/expand, macOS/Windows/Linux selection, recommended Apple silicon state, and all explicit installer links were tested.
- Console errors checked: none.

**Open Questions**

- None blocking.

**Comparison History**

- Iteration 1 — P1: the first implementation used three permanently visible equal-width platform columns, large text, 10–16px radii, and excessive empty vertical space.
  - Fix: replaced the columns with compact platform tabs and one active installer list; reduced type, spacing, and radii; matched Oppulence neutral tokens.
  - Post-fix evidence: `/tmp/oppulence-design-qa/desktop-download-open-v5.png`
- Iteration 2 — P2: the compact chooser was constrained to 880px, making it look detached and undersized inside the 1280px hero parent.
  - Fix: changed `.desktop-download-collapse` to `width: 100%`.
  - Post-fix evidence: `/tmp/oppulence-design-qa/desktop-download-open-full-width.png`, measured at 1280px inside a 1280px parent.

**Implementation Checklist**

- [x] Preserve the existing hero CTA and account mission-control link.
- [x] Make the desktop download chooser collapsible.
- [x] Present only the selected operating system's installers.
- [x] Mark the detected/recommended installer.
- [x] Connect every installer row to the existing download API.
- [x] Match Oppulence typography, spacing, colors, radii, and icon treatment.
- [x] Fill the hero parent width.
- [x] Verify desktop and mobile layouts, interactions, links, and console.

**Follow-up Polish**

- None required for this handoff.

final result: passed
