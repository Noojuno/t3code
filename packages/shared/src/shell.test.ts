import { describe, expect, it, vi } from "vitest";

import {
  extractEnvFromShellOutput,
  extractPathFromShellOutput,
  readEnvFromLoginShell,
  readPathFromLoginShell,
} from "./shell";

describe("extractPathFromShellOutput", () => {
  it("extracts the path between capture markers", () => {
    expect(
      extractPathFromShellOutput("__T3CODE_PATH_START__\n/opt/homebrew/bin:/usr/bin\n__T3CODE_PATH_END__\n"),
    ).toBe("/opt/homebrew/bin:/usr/bin");
  });

  it("ignores shell startup noise around the capture markers", () => {
    expect(
      extractPathFromShellOutput(
        "Welcome to fish\n__T3CODE_PATH_START__\n/opt/homebrew/bin:/usr/bin\n__T3CODE_PATH_END__\nBye\n",
      ),
    ).toBe("/opt/homebrew/bin:/usr/bin");
  });

  it("returns null when the markers are missing", () => {
    expect(extractPathFromShellOutput("/opt/homebrew/bin /usr/bin")).toBeNull();
  });
});

describe("readPathFromLoginShell", () => {
  it("uses a shell-agnostic printenv PATH probe", () => {
    const execFile = vi.fn<
      (
        file: string,
        args: ReadonlyArray<string>,
        options: { encoding: "utf8"; timeout: number },
      ) => string
    >(() => "__T3CODE_PATH_START__\n/a:/b\n__T3CODE_PATH_END__\n");

    expect(readPathFromLoginShell("/opt/homebrew/bin/fish", execFile)).toBe("/a:/b");
    expect(execFile).toHaveBeenCalledTimes(1);

    const firstCall = execFile.mock.calls[0] as
      | [string, ReadonlyArray<string>, { encoding: "utf8"; timeout: number }]
      | undefined;
    expect(firstCall).toBeDefined();
    if (!firstCall) {
      throw new Error("Expected execFile to be called");
    }

    const [shell, args, options] = firstCall;
    expect(shell).toBe("/opt/homebrew/bin/fish");
    expect(args).toHaveLength(2);
    expect(args?.[0]).toBe("-ilc");
    expect(args?.[1]).toContain("printenv PATH");
    expect(args?.[1]).toContain("__T3CODE_PATH_START__");
    expect(args?.[1]).toContain("__T3CODE_PATH_END__");
    expect(options).toEqual({ encoding: "utf8", timeout: 5000 });
  });
});

describe("extractEnvFromShellOutput", () => {
  it("parses null-delimited env entries between markers", () => {
    const output =
      "__T3CODE_ENV_START__\nPATH=/usr/bin\0HOME=/home/user\0NODE_EXTRA_CA_CERTS=/etc/ssl/corp.pem\0\n__T3CODE_ENV_END__\n";
    const env = extractEnvFromShellOutput(output);
    expect(env).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/user",
      NODE_EXTRA_CA_CERTS: "/etc/ssl/corp.pem",
    });
  });

  it("handles values containing equals signs", () => {
    const output = "__T3CODE_ENV_START__\nFOO=bar=baz\0\n__T3CODE_ENV_END__\n";
    expect(extractEnvFromShellOutput(output)).toEqual({ FOO: "bar=baz" });
  });

  it("ignores shell startup noise around the capture markers", () => {
    const output =
      "Welcome to zsh\n__T3CODE_ENV_START__\nA=1\0\n__T3CODE_ENV_END__\nBye\n";
    expect(extractEnvFromShellOutput(output)).toEqual({ A: "1" });
  });

  it("returns null when the markers are missing", () => {
    expect(extractEnvFromShellOutput("PATH=/usr/bin")).toBeNull();
  });

  it("returns null when there are no valid entries", () => {
    expect(extractEnvFromShellOutput("__T3CODE_ENV_START__\n\n__T3CODE_ENV_END__\n")).toBeNull();
  });
});

describe("readEnvFromLoginShell", () => {
  it("uses a shell-agnostic env -0 probe", () => {
    const execFile = vi.fn<
      (
        file: string,
        args: ReadonlyArray<string>,
        options: { encoding: "utf8"; timeout: number },
      ) => string
    >(() => "__T3CODE_ENV_START__\nFOO=bar\0BAZ=qux\0\n__T3CODE_ENV_END__\n");

    const result = readEnvFromLoginShell("/bin/zsh", execFile);
    expect(result).toEqual({ FOO: "bar", BAZ: "qux" });
    expect(execFile).toHaveBeenCalledTimes(1);

    const firstCall = execFile.mock.calls[0] as
      | [string, ReadonlyArray<string>, { encoding: "utf8"; timeout: number }]
      | undefined;
    expect(firstCall).toBeDefined();
    if (!firstCall) {
      throw new Error("Expected execFile to be called");
    }

    const [shell, args, options] = firstCall;
    expect(shell).toBe("/bin/zsh");
    expect(args).toHaveLength(2);
    expect(args?.[0]).toBe("-ilc");
    expect(args?.[1]).toContain("env -0");
    expect(args?.[1]).toContain("__T3CODE_ENV_START__");
    expect(args?.[1]).toContain("__T3CODE_ENV_END__");
    expect(options).toEqual({ encoding: "utf8", timeout: 5000 });
  });

  it("returns undefined when shell output has no markers", () => {
    const execFile = vi.fn(() => "no markers here");
    expect(readEnvFromLoginShell("/bin/zsh", execFile)).toBeUndefined();
  });
});
