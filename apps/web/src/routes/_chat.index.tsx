import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { isElectron } from "../env";
import { SidebarTrigger } from "../components/ui/sidebar";
import { useSplitViewStore } from "../splitViewStore";
import { useStore } from "../store";

function ChatIndexRouteView() {
  const navigate = useNavigate();
  const threadsHydrated = useStore((store) => store.threadsHydrated);
  const focusedWorkspaceThreadId = useSplitViewStore((store) => store.getFocusedThreadId());

  useEffect(() => {
    if (!threadsHydrated || !focusedWorkspaceThreadId) {
      return;
    }
    void navigate({
      to: "/$threadId",
      params: { threadId: focusedWorkspaceThreadId },
      replace: true,
    });
  }, [focusedWorkspaceThreadId, navigate, threadsHydrated]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-muted text-muted-foreground/40 dark:bg-background">
      {!isElectron && (
        <header className="border-b border-border px-3 py-2 md:hidden">
          <div className="flex items-center gap-2">
            <SidebarTrigger className="size-7 shrink-0" />
            <span className="text-sm font-medium text-foreground">Threads</span>
          </div>
        </header>
      )}

      {isElectron && (
        <div className="drag-region flex h-[52px] shrink-0 items-center border-b border-border px-5">
          <span className="text-xs text-muted-foreground/50">No active thread</span>
        </div>
      )}

      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <p className="text-sm">Select a thread or create a new one to get started.</p>
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/_chat/")({
  component: ChatIndexRouteView,
});
