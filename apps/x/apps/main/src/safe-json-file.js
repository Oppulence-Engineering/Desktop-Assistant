// Kept as JavaScript because Node's direct --experimental-strip-types tests resolve
// the .js specifier literally. apps/main/tsconfig.json enables allowJs so the same
// implementation is copied into dist for the esbuild production bundle.
import fs from "node:fs/promises";

export async function readValidatedJson(filePath, schema) {
  const source = await fs.readFile(filePath, "utf8");
  return schema.parse(JSON.parse(source));
}
