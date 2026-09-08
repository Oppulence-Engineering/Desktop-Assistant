# Workflow builder design QA

## Visual truth

- Source: `../artifacts/workflow-design-qa/attio-workflow-editor-reference.png`
- Implementation: `../artifacts/workflow-design-qa/local-workflow-editor.png`
- Full comparison: `../artifacts/workflow-design-qa/editor-full-comparison.png`
- Focused comparison: `../artifacts/workflow-design-qa/editor-focused-comparison.png`
- Source and implementation viewport: 1280 × 720 CSS pixels at 1× density.
- Focused comparison removes each app's sidebar; the narrower Oppulence content area is padded, not scaled.
- Compared state: Attio empty draft editor versus an Oppulence saved draft with its trigger, action graph, and trigger inspector visible.

## Findings and fixes

| Severity | Finding                                                               | Resolution                                                                               |
| -------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| P2       | A managed `0 8 * * *` cadence had no human-readable inspector option. | Added “Every day at 8:00 AM” and verified it in the disabled managed-workflow inspector. |

No P0, P1, or unresolved P2 findings remain. Product-specific content differs from the empty Attio draft by design; hierarchy, density, square geometry, dotted canvas, compact tabs, live control, connected nodes, and progressive inspector match the reference direction.

## Interaction and runtime checks

- Created and saved an inactive “At-risk commitment recovery” draft through the web API.
- Reloaded the workflow library and confirmed the persisted trigger plus three actions.
- Changed an action to “Create CRM task” and verified its owner/due-date configuration.
- Verified Editor, Runs, and Settings views and the managed schedule summary.
- Verified the browser console contains no warnings or errors.
- Kept the draft inactive; live activation and manual execution were not invoked during visual QA.
- Focused component tests: 3 passed. Typecheck, formatting, lint, and production Next.js build passed.

## Result

passed
