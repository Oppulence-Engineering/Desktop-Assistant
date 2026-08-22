import { createRule } from "../create-rule.js";

export const lifecycleContract = createRule({
  name: "lifecycle-contract",
  meta: {
    type: "suggestion",
    docs: {
      description: "Require lifecycle services to expose cancellation-aware start/stop ownership.",
    },
    schema: [],
    messages: {
      forbidden:
        "XLIFE001: lifecycle start methods should accept an AbortSignal or be managed by LifecycleRegistry.",
    },
  },
  defaultOptions: [],
  create() {
    // The executable enforcement is in no-unbounded-poller. This companion rule
    // intentionally remains syntax-neutral so repositories can adopt either a
    // class or functional LifecycleService implementation.
    return {};
  },
});
