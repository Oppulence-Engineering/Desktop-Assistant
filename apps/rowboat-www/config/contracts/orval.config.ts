import path from "node:path";

import { defineConfig } from "orval";

const appRoot = path.resolve(import.meta.dirname, "../..");
const input = path.resolve(appRoot, "../rowboat-api/api/openapi.json");
const outputRoot = path.resolve(appRoot, process.env.ORVAL_OUTPUT_ROOT ?? "lib/api/generated");

export default defineConfig({
  api: {
    input,
    output: {
      target: `${outputRoot}/client/endpoints.ts`,
      schemas: `${outputRoot}/client/model`,
      client: "fetch",
      mode: "tags-split",
      clean: true,
      mock: true,
      formatter: "prettier",
    },
  },
  schemas: {
    input,
    output: {
      target: `${outputRoot}/zod/endpoints.ts`,
      client: "zod",
      mode: "tags-split",
      clean: true,
      formatter: "prettier",
      override: {
        zod: {
          strict: { body: true, response: true },
          generate: { body: true, response: true, query: true, param: true, header: true },
          generateEachHttpStatus: true,
          version: 4,
          coerce: { query: ["boolean", "number"], param: ["boolean", "number"] },
        },
      },
    },
  },
});
