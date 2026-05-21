import { execFile } from "node:child_process";

let environmentPromise: Promise<void> | null = null;

// Packaged Electron apps inherit a minimal environment that often lacks shell
// profile PATH entries. Hydrate it asynchronously so cold launch can paint the
// first window before slow shell startup files run.
export function initializeExecutionEnvironment(): Promise<void> {
  if (process.platform === "win32") return Promise.resolve();

  if (environmentPromise) return environmentPromise;

  environmentPromise = new Promise((resolve) => {
    const shell = process.env.SHELL || "/bin/zsh";
    execFile(
      shell,
      ["-l", "-c", 'node -p "JSON.stringify(process.env)"'],
      { encoding: "utf8", timeout: 15_000 },
      (error, stdout) => {
        if (error) {
          console.error("Failed to load shell environment", error);
          resolve();
          return;
        }

        try {
          const env = JSON.parse(stdout.trim()) as Record<string, string>;
          process.env = { ...process.env, ...env };
        } catch (parseError) {
          console.error("Failed to parse shell environment", parseError);
        }

        resolve();
      },
    );
  });

  return environmentPromise;
}
