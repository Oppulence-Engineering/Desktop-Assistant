import { describe, expect, it } from "vitest";

import { extractCommandNames } from "./command-executor.js";

describe("extractCommandNames", () => {
  it("does not treat ampersand redirections as command separators", () => {
    expect(extractCommandNames("echo ok 2>&1")).toEqual(["echo"]);
    expect(extractCommandNames("echo ok >&2")).toEqual(["echo"]);
    expect(extractCommandNames("cat <&0")).toEqual(["cat"]);
    expect(extractCommandNames("echo ok &>out.log")).toEqual(["echo"]);
    expect(extractCommandNames("echo ok &>>out.log")).toEqual(["echo"]);
    expect(extractCommandNames("echo ok 2>&1 | cat")).toEqual(["echo", "cat"]);
  });

  it("still splits background commands and command substitution", () => {
    expect(extractCommandNames("echo ok & rm -rf /tmp/nope")).toEqual(["echo", "rm"]);
    expect(extractCommandNames("echo $(rm -rf /tmp/nope)")).toEqual(["echo", "rm"]);
    expect(extractCommandNames('echo "$(rm -rf /tmp/nope)"')).toEqual(["echo", "rm"]);
    expect(extractCommandNames("echo `rm -rf /tmp/nope`")).toEqual(["echo", "rm"]);
    expect(extractCommandNames("(rm -rf /tmp/nope)")).toEqual(["rm"]);
  });

  it("splits process substitution commands", () => {
    expect(extractCommandNames("cat <(rm -rf /tmp/nope)")).toEqual(["cat", "rm"]);
    expect(extractCommandNames("diff <(echo left) >(sed s/left/right/)")).toEqual([
      "diff",
      "echo",
      "sed",
    ]);
  });

  it("does not treat quoted or word-local parentheses as command separators", () => {
    expect(extractCommandNames('echo "hello (world)"')).toEqual(["echo"]);
    expect(extractCommandNames("printf '%s (value)'")).toEqual(["printf"]);
    expect(extractCommandNames("printf '<(literal)'")).toEqual(["printf"]);
    expect(extractCommandNames("echo foo(bar)")).toEqual(["echo"]);
  });
});
