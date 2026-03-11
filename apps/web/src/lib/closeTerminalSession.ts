import type { ThreadId } from "@t3tools/contracts";

import { readNativeApi } from "../nativeApi";

interface CloseTerminalSessionInput {
  threadId: ThreadId;
  terminalId: string;
  isFinalTerminal: boolean;
}

export async function closeTerminalSession(input: CloseTerminalSessionInput): Promise<void> {
  const api = readNativeApi();
  if (!api) return;

  if (input.isFinalTerminal) {
    await api.terminal
      .clear({ threadId: input.threadId, terminalId: input.terminalId })
      .catch(() => undefined);
  }

  await api.terminal.close({
    threadId: input.threadId,
    terminalId: input.terminalId,
    deleteHistory: true,
  });
}
