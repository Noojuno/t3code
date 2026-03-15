import { useCallback, useEffect, useRef, useState } from "react";
import { TerminalSquare, XIcon } from "lucide-react";
import type { SplitTerminalPane } from "../splitViewStore";
import { useSplitViewStore } from "../splitViewStore";
import { TerminalViewport } from "./ThreadTerminalDrawer";
import { closeTerminalSession } from "../lib/closeTerminalSession";
import { isMacPlatform } from "../lib/utils";
import { Button } from "./ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import type { ThreadId } from "@t3tools/contracts";

/**
 * A synthetic thread ID used for terminal pane sessions.
 * Terminal panes reuse the native terminal API which requires a threadId,
 * so we scope all pane terminals under a shared namespace.
 */
const TERMINAL_PANE_THREAD_ID = "__terminal_pane__" as ThreadId;

export function TerminalPane({ pane }: { pane: SplitTerminalPane }) {
  const closePane = useSplitViewStore((s) => s.closePane);
  const [exited, setExited] = useState(false);
  const closedRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleCloseRef = useRef<() => void>(null);
  handleCloseRef.current = () => {
    if (closedRef.current) return;
    closedRef.current = true;
    void closeTerminalSession({
      threadId: TERMINAL_PANE_THREAD_ID,
      terminalId: pane.terminalId,
      isFinalTerminal: true,
    });
    closePane(pane.id);
  };

  const handleClose = useCallback(() => {
    handleCloseRef.current?.();
  }, []);

  const handleSessionExited = useCallback(() => {
    setExited(true);
  }, []);

  // Handle Cmd/Ctrl+W to close this pane (matching thread pane behavior).
  // Uses a stable ref so the listener never re-registers.
  useEffect(() => {
    const container = containerRef.current;
    const onKeyDown = (event: KeyboardEvent) => {
      const isMod = isMacPlatform(navigator.platform) ? event.metaKey : event.ctrlKey;
      if (isMod && event.key.toLowerCase() === "w" && !event.shiftKey && !event.altKey) {
        if (container?.contains(document.activeElement)) {
          event.preventDefault();
          event.stopPropagation();
          handleCloseRef.current?.();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  // Cleanup terminal session on unmount
  useEffect(() => {
    return () => {
      if (closedRef.current) return;
      closedRef.current = true;
      void closeTerminalSession({
        threadId: TERMINAL_PANE_THREAD_ID,
        terminalId: pane.terminalId,
        isFinalTerminal: true,
      });
    };
  }, [pane.terminalId]);

  return (
    <div
      ref={containerRef}
      className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-background text-foreground"
    >
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border/50 px-3">
        <TerminalSquare className="size-3.5 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={pane.cwd}>
          {pane.cwd}
        </span>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                className="shrink-0"
                onClick={handleClose}
                aria-label="Close split pane"
                variant="outline"
                size="xs"
              >
                <XIcon className="size-3" />
              </Button>
            }
          />
          <TooltipPopup side="bottom">Close split pane</TooltipPopup>
        </Tooltip>
      </div>
      <div className="min-h-0 flex-1 p-1">
        {exited ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            Terminal session ended.{" "}
            <button
              type="button"
              className="ml-1 underline hover:text-foreground"
              onClick={handleClose}
            >
              Close
            </button>
          </div>
        ) : (
          <TerminalViewport
            threadId={TERMINAL_PANE_THREAD_ID}
            terminalId={pane.terminalId}
            cwd={pane.cwd}
            onSessionExited={handleSessionExited}
            focusRequestId={0}
            autoFocus
            resizeEpoch={0}
            drawerHeight={0}
          />
        )}
      </div>
    </div>
  );
}
