import { execFileSync } from "node:child_process";

const PATH_CAPTURE_START = "__T3CODE_PATH_START__";
const PATH_CAPTURE_END = "__T3CODE_PATH_END__";
const PATH_CAPTURE_COMMAND = [
  `printf '%s\n' '${PATH_CAPTURE_START}'`,
  "printenv PATH",
  `printf '%s\n' '${PATH_CAPTURE_END}'`,
].join("; ");

const ENV_CAPTURE_START = "__T3CODE_ENV_START__";
const ENV_CAPTURE_END = "__T3CODE_ENV_END__";
const ENV_CAPTURE_COMMAND = [
  `printf '%s\n' '${ENV_CAPTURE_START}'`,
  "env -0",
  `printf '%s\n' '${ENV_CAPTURE_END}'`,
].join("; ");

type ExecFileSyncLike = (
  file: string,
  args: ReadonlyArray<string>,
  options: { encoding: "utf8"; timeout: number },
) => string;

export function extractPathFromShellOutput(output: string): string | null {
  const startIndex = output.indexOf(PATH_CAPTURE_START);
  if (startIndex === -1) return null;

  const valueStartIndex = startIndex + PATH_CAPTURE_START.length;
  const endIndex = output.indexOf(PATH_CAPTURE_END, valueStartIndex);
  if (endIndex === -1) return null;

  const pathValue = output.slice(valueStartIndex, endIndex).trim();
  return pathValue.length > 0 ? pathValue : null;
}

export function readPathFromLoginShell(
  shell: string,
  execFile: ExecFileSyncLike = execFileSync,
): string | undefined {
  const output = execFile(shell, ["-ilc", PATH_CAPTURE_COMMAND], {
    encoding: "utf8",
    timeout: 5000,
  });
  return extractPathFromShellOutput(output) ?? undefined;
}

export function extractEnvFromShellOutput(output: string): Record<string, string> | null {
  const startIndex = output.indexOf(ENV_CAPTURE_START);
  if (startIndex === -1) return null;

  const valueStartIndex = startIndex + ENV_CAPTURE_START.length + 1; // +1 for newline
  const endIndex = output.indexOf(ENV_CAPTURE_END, valueStartIndex);
  if (endIndex === -1) return null;

  const envBlock = output.slice(valueStartIndex, endIndex);
  const env: Record<string, string> = {};

  // `env -0` separates entries with null bytes
  for (const entry of envBlock.split("\0")) {
    const eqIndex = entry.indexOf("=");
    if (eqIndex === -1) continue;
    const key = entry.slice(0, eqIndex);
    const value = entry.slice(eqIndex + 1);
    if (key.length > 0) {
      env[key] = value;
    }
  }

  return Object.keys(env).length > 0 ? env : null;
}

export function readEnvFromLoginShell(
  shell: string,
  execFile: ExecFileSyncLike = execFileSync,
): Record<string, string> | undefined {
  const output = execFile(shell, ["-ilc", ENV_CAPTURE_COMMAND], {
    encoding: "utf8",
    timeout: 5000,
  });
  return extractEnvFromShellOutput(output) ?? undefined;
}
