import { ipcSchemaRequired } from "./rules/ipc-schema-required.js";
import { ipcSenderValidation } from "./rules/ipc-sender-validation.js";
import { lifecycleContract } from "./rules/lifecycle-contract.js";
import { noContainerResolve } from "./rules/no-container-resolve.js";
import { noDangerousElectronOptions } from "./rules/no-dangerous-electron-options.js";
import { noDeepDistImports } from "./rules/no-deep-dist-imports.js";
import { noElectronInCore } from "./rules/no-electron-in-core.js";
import { noRawIpcRendererExposure } from "./rules/no-raw-ipc-renderer-exposure.js";
import { noRawIpc } from "./rules/no-raw-ipc.js";
import { noUnboundedPoller } from "./rules/no-unbounded-poller.js";
import { noUnsafeFsWrite } from "./rules/no-unsafe-fs-write.js";
import { noUntrustedOpenExternal } from "./rules/no-untrusted-open-external.js";
import { noUnvalidatedFsRead } from "./rules/no-unvalidated-fs-read.js";
import { typedRendererEvents } from "./rules/typed-renderer-events.js";
export const rules = {
    "ipc-schema-required": ipcSchemaRequired,
    "ipc-sender-validation": ipcSenderValidation,
    "lifecycle-contract": lifecycleContract,
    "no-container-resolve": noContainerResolve,
    "no-dangerous-electron-options": noDangerousElectronOptions,
    "no-deep-dist-imports": noDeepDistImports,
    "no-electron-in-core": noElectronInCore,
    "no-raw-ipc-renderer-exposure": noRawIpcRendererExposure,
    "no-raw-ipc": noRawIpc,
    "no-unbounded-poller": noUnboundedPoller,
    "no-unsafe-fs-write": noUnsafeFsWrite,
    "no-untrusted-open-external": noUntrustedOpenExternal,
    "no-unvalidated-fs-read": noUnvalidatedFsRead,
    "typed-renderer-events": typedRendererEvents,
};
const plugin = { meta: { name: "@x/eslint-plugin-x-architecture", version: "0.1.0" }, rules };
export default plugin;
