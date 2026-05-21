import { exec } from "node:child_process";
import { promisify } from "node:util";
import { initializeExecutionEnvironment } from "./execution-environment.js";

const execAsync = promisify(exec);
let ensurePromise: Promise<void> | null = null;

export async function ensureAgentSlackAvailable(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      await initializeExecutionEnvironment();

      try {
        await execAsync("agent-slack --version", { timeout: 5_000 });
        return;
      } catch {
        console.log("agent-slack not found, installing...");
      }

      await execAsync("npm install -g agent-slack", { timeout: 60_000 });
      console.log("agent-slack installed successfully");
    })();
  }

  try {
    await ensurePromise;
  } catch (error) {
    ensurePromise = null;
    throw error;
  }
}
