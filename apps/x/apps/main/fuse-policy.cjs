const { FuseV1Options, FuseVersion } = require("@electron/fuses");

// Integrity/OnlyLoadAppFromAsar remain disabled because the app currently stages
// native ONNX bindings outside an asar. They must be enabled together with an
// explicit asar unpack policy in a dedicated packaging migration.
module.exports = {
  version: FuseVersion.V1,
  strictlyRequireAllFuses: true,
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableCookieEncryption]: true,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false,
  [FuseV1Options.OnlyLoadAppFromAsar]: false,
  // Electron's packaged runtime ships v8_context_snapshot.bin, not a custom
  // browser_v8_context_snapshot.bin. Enabling this fuse makes the app unbootable.
  [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
  [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
};
