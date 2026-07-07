import { exec, execSync } from "child_process";
import { promisify } from "util";
import { getSecurityAllowList, SECURITY_CONFIG_PATH } from "../../config/security.js";
import { getExecutionShell } from "../assistant/runtime-context.js";

const execPromise = promisify(exec);
const ENV_ASSIGNMENT_REGEX = /^[A-Za-z_][A-Za-z0-9_]*=.*/;
const WRAPPER_COMMANDS = new Set(["sudo", "env", "time", "command"]);
const EXECUTION_SHELL = getExecutionShell();
type Quote = "'" | "\"" | null;

function isAmpersandSeparator(command: string, index: number): boolean {
  const previous = command[index - 1];
  const next = command[index + 1];
  return previous !== "<" && previous !== ">" && next !== ">" && next !== "&";
}

function isCommandGroupStart(command: string, index: number): boolean {
  const before = command.slice(0, index).trimEnd();
  if (!before) return true;

  const previous = before[before.length - 1];
  return previous === ";" || previous === "|" || previous === "&" || previous === "(" || previous === "\n";
}

function splitCommandSegments(command: string): string[] {
  const segments: string[] = [];
  const quoteStack: Quote[] = [];
  let current = "";
  let quote: Quote = null;
  let escaped = false;
  let parenDepth = 0;
  let inBacktick = false;
  let backtickOuterQuote: Quote = null;

  const push = () => {
    if (current.trim()) {
      segments.push(current);
    }
    current = "";
  };

  for (let index = 0; index < command.length; index++) {
    const char = command[index];
    const next = command[index + 1];

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\" && quote !== "'") {
      current += char;
      escaped = true;
      continue;
    }

    if (char === "'" && quote !== "\"") {
      quote = quote === "'" ? null : "'";
      current += char;
      continue;
    }

    if (char === "\"" && quote !== "'") {
      quote = quote === "\"" ? null : "\"";
      current += char;
      continue;
    }

    if (quote !== "'" && char === "$" && next === "(") {
      push();
      quoteStack.push(quote);
      quote = null;
      parenDepth++;
      index++;
      continue;
    }

    if (quote !== "'" && char === "`") {
      push();
      if (inBacktick) {
        quote = backtickOuterQuote;
        backtickOuterQuote = null;
        inBacktick = false;
      } else {
        backtickOuterQuote = quote;
        quote = null;
        inBacktick = true;
      }
      continue;
    }

    if (quote === null) {
      if (char === "&" && next === "&") {
        push();
        index++;
        continue;
      }
      if (char === "|" && next === "|") {
        push();
        index++;
        continue;
      }
      if (char === ";" || char === "|" || char === "\n") {
        push();
        continue;
      }
      if (char === "&" && isAmpersandSeparator(command, index)) {
        push();
        continue;
      }
      if (char === "(" && isCommandGroupStart(command, index)) {
        push();
        quoteStack.push(null);
        parenDepth++;
        continue;
      }
      if (char === ")" && parenDepth > 0) {
        push();
        parenDepth--;
        quote = quoteStack.pop() ?? null;
        continue;
      }
    }

    current += char;
  }

  push();
  return segments;
}

function sanitizeToken(token: string): string {
  return token.trim().replace(/^['"]+|['"]+$/g, "");
}

function extractCommandNames(command: string): string[] {
  const discovered = new Set<string>();
  const segments = splitCommandSegments(command);

  for (const segment of segments) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;

    let index = 0;
    while (index < tokens.length && ENV_ASSIGNMENT_REGEX.test(tokens[index])) {
      index++;
    }

    if (index >= tokens.length) continue;

    const primary = sanitizeToken(tokens[index]).toLowerCase();
    if (!primary) continue;

    discovered.add(primary);

    if (WRAPPER_COMMANDS.has(primary) && index + 1 < tokens.length) {
      const wrapped = sanitizeToken(tokens[index + 1]).toLowerCase();
      if (wrapped) {
        discovered.add(wrapped);
      }
    }
  }

  return Array.from(discovered);
}

function findBlockedCommands(command: string): string[] {
  const invoked = extractCommandNames(command);
  if (!invoked.length) return [];

  const allowList = getSecurityAllowList();
  if (!allowList.length) return invoked;

  const allowSet = new Set(allowList);
  if (allowSet.has("*")) return [];

  return invoked.filter((cmd) => !allowSet.has(cmd));
}

// export const BlockedResult = {
//   stdout: '',
//   stderr: `Command blocked by security policy. Update ${SECURITY_CONFIG_PATH} to allow them before retrying.`,
//   exitCode: 126,
// };

export function isBlocked(command: string): boolean {
  const blocked = findBlockedCommands(command);
  return blocked.length > 0;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Executes an arbitrary shell command
 * @param command - The command to execute (e.g., "cat abc.txt | grep 'abc@gmail.com'")
 * @param options - Optional execution options
 * @returns Promise with stdout, stderr, and exit code
 */
export async function executeCommand(
  command: string,
  options?: {
    cwd?: string;
    timeout?: number; // timeout in milliseconds
    maxBuffer?: number; // max buffer size in bytes
  },
): Promise<CommandResult> {
  try {
    const { stdout, stderr } = await execPromise(command, {
      cwd: options?.cwd,
      timeout: options?.timeout,
      maxBuffer: options?.maxBuffer || 1024 * 1024, // default 1MB
      shell: EXECUTION_SHELL,
    });

    return {
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      exitCode: 0,
    };
  } catch (error: any) {
    // exec throws an error if the command fails or times out
    return {
      stdout: error.stdout?.trim() || "",
      stderr: error.stderr?.trim() || error.message,
      exitCode: error.code || 1,
    };
  }
}

/**
 * Executes a command synchronously (blocking)
 * Use with caution - prefer executeCommand for async execution
 */
export function executeCommandSync(
  command: string,
  options?: {
    cwd?: string;
    timeout?: number;
  },
): CommandResult {
  try {
    const stdout = execSync(command, {
      cwd: options?.cwd,
      timeout: options?.timeout,
      encoding: "utf-8",
      shell: EXECUTION_SHELL,
    });

    return {
      stdout: stdout.trim(),
      stderr: "",
      exitCode: 0,
    };
  } catch (error: any) {
    return {
      stdout: error.stdout?.toString().trim() || "",
      stderr: error.stderr?.toString().trim() || error.message,
      exitCode: error.status || 1,
    };
  }
}
