import { afterAll, describe, it } from "vitest";
import { RuleTester } from "@typescript-eslint/rule-tester";
import parser from "@typescript-eslint/parser";
import { noContainerResolve } from "./no-container-resolve.js";
import { noDangerousElectronOptions } from "./no-dangerous-electron-options.js";
import { noDeepDistImports } from "./no-deep-dist-imports.js";
import { noElectronInCore } from "./no-electron-in-core.js";
import { noRawIpc } from "./no-raw-ipc.js";
import { noUnsafeFsWrite } from "./no-unsafe-fs-write.js";
import { typedRendererEvents } from "./typed-renderer-events.js";

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: {
    parser,
    parserOptions: { ecmaVersion: 2022, sourceType: "module" },
  },
});

tester.run("no-deep-dist-imports", noDeepDistImports, {
  valid: ['import { voice } from "@x/core/voice/voice";'],
  invalid: [
    {
      code: 'import { voice } from "@x/core/dist/voice/voice.js";',
      errors: [{ messageId: "forbidden" }],
    },
  ],
});

tester.run("no-electron-in-core", noElectronInCore, {
  valid: ['import { z } from "zod";'],
  invalid: [
    {
      code: 'import { BrowserWindow } from "electron";',
      errors: [{ messageId: "forbidden" }],
    },
  ],
});

tester.run("no-dangerous-electron-options", noDangerousElectronOptions, {
  valid: ["const prefs = { nodeIntegration: false, contextIsolation: true, sandbox: true };"],
  invalid: [
    {
      code: "const prefs = { nodeIntegration: true, contextIsolation: false, sandbox: false };",
      errors: [{ messageId: "forbidden" }, { messageId: "forbidden" }, { messageId: "forbidden" }],
    },
  ],
});

tester.run("no-raw-ipc", noRawIpc, {
  valid: ['window.ipc.invoke("safe", null);'],
  invalid: [
    {
      code: 'ipcMain.handle("unsafe", handler);',
      errors: [{ messageId: "forbidden" }],
    },
    {
      code: 'win.webContents.send("unsafe", payload);',
      errors: [{ messageId: "forbidden" }],
    },
  ],
});

tester.run("typed-renderer-events", typedRendererEvents, {
  valid: [
    'window.addEventListener("resize", handler);',
    'emitRendererEvent("models-config-changed", undefined);',
  ],
  invalid: [
    {
      code: 'window.dispatchEvent(new Event("models-config-changed"));',
      errors: [{ messageId: "forbidden" }],
    },
    {
      code: 'window.addEventListener("rowboat:open-note", handler);',
      errors: [{ messageId: "forbidden" }],
    },
  ],
});

tester.run("no-container-resolve baseline", noContainerResolve, {
  valid: [
    {
      filename: "/repo/packages/core/src/legacy.ts",
      code: 'container.resolve("old");',
      options: [{ baseline: { "packages/core/src/legacy.ts": 1 } }],
    },
  ],
  invalid: [
    {
      filename: "/repo/packages/core/src/legacy.ts",
      code: 'container.resolve("old"); container.resolve("new");',
      options: [{ baseline: { "packages/core/src/legacy.ts": 1 } }],
      errors: [{ messageId: "forbidden" }],
    },
  ],
});

tester.run("no-unsafe-fs-write baseline", noUnsafeFsWrite, {
  valid: [
    {
      filename: "/repo/packages/core/src/legacy.ts",
      code: 'fs.writeFile("old", value);',
      options: [{ baseline: { "packages/core/src/legacy.ts": 1 } }],
    },
  ],
  invalid: [
    {
      filename: "/repo/packages/core/src/new.ts",
      code: 'fsp.writeFile("new", value);',
      errors: [{ messageId: "forbidden" }],
    },
  ],
});
