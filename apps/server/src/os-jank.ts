import * as OS from "node:os";
import { Effect, Path } from "effect";
import { readEnvFromLoginShell } from "@t3tools/shared/shell";

export function fixPath(): void {
  if (process.platform !== "darwin") return;

  try {
    const shell = process.env.SHELL ?? "/bin/zsh";
    const env = readEnvFromLoginShell(shell);
    if (env) {
      for (const [key, value] of Object.entries(env)) {
        process.env[key] = value;
      }
    }
  } catch {
    // Silently ignore — keep default environment
  }
}

export const expandHomePath = Effect.fn(function* (input: string) {
  const { join } = yield* Path.Path;
  if (input === "~") {
    return OS.homedir();
  }
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return join(OS.homedir(), input.slice(2));
  }
  return input;
});

export const resolveStateDir = Effect.fn(function* (raw: string | undefined) {
  const { join, resolve } = yield* Path.Path;
  if (!raw || raw.trim().length === 0) {
    return join(OS.homedir(), ".t3", "userdata");
  }
  return resolve(yield* expandHomePath(raw.trim()));
});
