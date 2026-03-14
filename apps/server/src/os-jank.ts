import * as FS from "node:fs";
import * as OS from "node:os";
import { Effect, Path } from "effect";
import { readEnvironmentFromLoginShell } from "@t3tools/shared/shell";

export function fixPath(): void {
  if (process.platform !== "darwin") return;

  try {
    const shell = process.env.SHELL ?? "/bin/zsh";
    const env = readEnvironmentFromLoginShell(shell, [
      "PATH",
      "NODE_EXTRA_CA_CERTS",
      "SSL_CERT_FILE",
    ]);
    if (env.PATH) {
      process.env.PATH = env.PATH;
    }
    if (env.NODE_EXTRA_CA_CERTS && !process.env.NODE_EXTRA_CA_CERTS) {
      process.env.NODE_EXTRA_CA_CERTS = env.NODE_EXTRA_CA_CERTS;
    }
    if (env.SSL_CERT_FILE && !process.env.SSL_CERT_FILE) {
      process.env.SSL_CERT_FILE = env.SSL_CERT_FILE;
    }
  } catch {
    // Silently ignore — keep default environment
  }

  // On macOS, if NODE_EXTRA_CA_CERTS is still unset, fall back to the
  // system certificate bundle so that HTTPS requests from child processes
  // (e.g. the Claude Agent SDK) can verify TLS chains.
  if (!process.env.NODE_EXTRA_CA_CERTS) {
    const systemCertBundle = "/etc/ssl/cert.pem";
    try {
      FS.accessSync(systemCertBundle, FS.constants.R_OK);
      process.env.NODE_EXTRA_CA_CERTS = systemCertBundle;
    } catch {
      // cert bundle not readable, skip
    }
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
