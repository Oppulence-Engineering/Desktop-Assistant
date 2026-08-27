// Workspace filesystem operations
export * as workspace from "./workspace/workspace.js";

// Workspace watcher
export * as watcher from "./workspace/watcher.js";

// Config initialization
export { initConfigs } from "./config/initConfigs.js";

// Knowledge version history
export * as versionHistory from "./knowledge/version_history.js";

// Stable local entity identity, reconciliation, and shared-spine synchronization.
export * as entities from "./knowledge/entity.js";

// Voice mode (config + TTS)
export * as voice from "./voice/voice.js";

// Provider-neutral mailbox foundation, rules engine, and reply tracking
export * as mailbox from "./mailbox/mailbox.js";

// Canonical relationship-intelligence API shared by the desktop mission control.
export * as relationships from "./relationships/client.js";
