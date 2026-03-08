import { readEnvFromLoginShell } from "@t3tools/shared/shell";

/**
 * On macOS, GUI apps (including Electron) do not inherit the user's
 * login-shell environment. Restore it by sourcing the shell profile
 * and capturing the full set of exported variables.
 */
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
    // Keep inherited environment if shell lookup fails.
  }
}
