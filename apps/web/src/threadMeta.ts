import { type ThreadId } from "@t3tools/contracts";
import { newCommandId } from "./lib/utils";
import { readNativeApi } from "./nativeApi";

export async function renameThreadTitle(threadId: ThreadId, title: string): Promise<void> {
  const api = readNativeApi();
  if (!api) {
    return;
  }

  await api.orchestration.dispatchCommand({
    type: "thread.meta.update",
    commandId: newCommandId(),
    threadId,
    title,
  });
}
