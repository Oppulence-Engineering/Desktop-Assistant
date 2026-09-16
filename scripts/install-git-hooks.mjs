#!/usr/bin/env node
// Installs the lefthook hooks, then keeps the push connection alive while they
// run.
//
// The pre-push hook runs three gauntlets and takes about twelve minutes. Git
// opens its connection to the remote *before* running the hook and sends the
// pack afterwards, so an idle SSH connection is dropped while the checks run.
// Git's write then raises SIGPIPE and `git push` exits 141 with every check
// passed, which reads as "the hook is broken" and pushes as `--no-verify`.
//
// Measured on the reproduction: without keepalive the push exits 141 after 59
// gauntlet stage lines; with it the push exits 0 after 129.
import { execFileSync } from "node:child_process";

const KEEPALIVE = "ssh -o ServerAliveInterval=15 -o ServerAliveCountMax=60";

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

execFileSync("lefthook", ["install"], { stdio: "inherit" });

let existing = "";
try {
  existing = git(["config", "--local", "--get", "core.sshCommand"]);
} catch {
  // No value set yet; git exits non-zero when the key is missing.
}

if (existing === "") {
  git(["config", "--local", "core.sshCommand", KEEPALIVE]);
  console.log("git hooks installed; push keepalive enabled for this clone");
} else if (existing.includes("ServerAliveInterval")) {
  console.log("git hooks installed; push keepalive already present");
} else {
  // Someone set their own transport. Leave it alone and say why it matters.
  console.log(
    `git hooks installed; core.sshCommand is already set to "${existing}".\n` +
      "Add -o ServerAliveInterval=15 -o ServerAliveCountMax=60 so a long pre-push hook\n" +
      "does not lose the connection and fail the push with exit 141.",
  );
}
