# Rollout and rollback playbook

## Promotion order

1. `synthetic`: deterministic fixtures only; all external action capabilities disabled.
2. `internal_read_only`: employee sources and Mission Control; no provider writes.
3. `internal_governed_action`: one employee workspace and one action channel at a time.
4. `design_partner_read_only`: real data, corrections, identity review, and attention; no writes during the observation window.
5. `design_partner_governed_action`: the release register and runtime release-owner signoff must both pass; enable one workspace and one channel.
6. `beta`: promote only after cohort evidence and signed drills meet the release gates.

At every stage, compare activation, freshness, identity, evidence coverage, correction, uncertainty, duplicate, drift, latency, and cost guardrails with the prior cohort. Promotion is a reversible workspace control change, not a deploy-time assumption.

## Capability order

Enable `beta_entitlement`, navigation, one source, projection/read paths, one detector, desktop publication if needed, then one action channel. Enable outcome ranking only after outcome explanations are sampled. Enable real-time updates last; polling remains the fallback.

`release_gate_approval` is special: it may be enabled only at governed design-partner or beta stage with reason `release_owner_signoff`. Execution also requires the provider to be live with the exact write scope (`gmail.compose`, `gmail.send`, `calendar.events`, `chat:write`, `notes.write`, or `tasks.write`).

## Rollback

1. Disable the narrowest faulty source, detector, extractor, action channel, ranking lift, desktop publication, or real-time capability.
2. For any external-action trust breach, also disable `release_gate_approval` and all action channels for the cohort.
3. Do not delete observations, decisions, approvals, outcomes, lineage, or prior state versions.
4. Roll projector or detector code back, then use versioned replay/shadow state. Never edit published history.
5. For a connector rollback, stop new consumption, preserve the cursor internally, show degraded/rebuilding state, deploy the prior version, then resume.
6. For an executor rollback, leave requested/ambiguous operations frozen until read-only reconciliation proves their outcome.
7. Re-run the relevant fault suite and attach incident plus recovery evidence before re-enabling.

## Required drills

- revoke each credential and confirm reconnect-required plus blocked action;
- disconnect during backfill and confirm delayed events cannot revive the source;
- dead-letter a projection and recover through the operator command;
- race two identity decisions and preserve one immutable winner;
- inject provider timeout before and after acceptance and prove no duplicate write;
- delete during backfill, projection, reconciliation, and local/offline publication;
- disable a bad detector/extractor/projector and restore the prior version without history mutation.
