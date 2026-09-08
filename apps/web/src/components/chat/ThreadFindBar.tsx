import { useEffect, useRef, type KeyboardEvent } from "react";
import { ChevronDownIcon, ChevronUpIcon, XIcon } from "lucide-react";
import { Button } from "../ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { cn } from "~/lib/utils";
import { formatThreadFindCount } from "./threadFind";

interface ThreadFindBarProps {
  readonly open: boolean;
  readonly query: string;
  readonly matchCount: number;
  readonly historyState: "loading" | "incomplete" | null;
  readonly onRetryHistory: () => void;
  readonly activeIndex: number;
  readonly focusRequestId: number;
  readonly onQueryChange: (query: string) => void;
  readonly onNext: () => void;
  readonly onPrevious: () => void;
  readonly onClose: () => void;
}

export function ThreadFindBar(props: ThreadFindBarProps) {
  const { onClose, open } = props;
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!props.open) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [props.focusRequestId, props.open]);

  useEffect(() => {
    if (!open) return;

    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing || event.keyCode === 229) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open]);

  if (!props.open) return null;

  const hasQuery = props.query.trim().length > 0;
  const noResults = hasQuery && !props.historyState && props.matchCount === 0;
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) props.onPrevious();
      else props.onNext();
    }
  };

  return (
    <InputGroup
      variant="popover"
      role="search"
      aria-label="Find in thread"
      aria-busy={props.historyState === "loading"}
      className="absolute top-[calc(100%+0.5rem)] right-0 z-40 h-9 w-[min(24rem,calc(100vw-1.5rem))] [-webkit-app-region:no-drag]"
    >
      <InputGroupInput
        ref={inputRef}
        type="search"
        size="sm"
        value={props.query}
        aria-label="Find in thread"
        placeholder="Find in thread"
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => props.onQueryChange(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      <InputGroupAddon align="inline-end" className="gap-0.5">
        <span
          aria-live="polite"
          className={cn(
            "min-w-10 text-center text-xs tabular-nums",
            noResults ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {props.historyState === "loading" ? (
            "Searching…"
          ) : props.historyState === "incomplete" ? (
            <Button size="xs" variant="ghost" onClick={props.onRetryHistory}>
              Search older
            </Button>
          ) : hasQuery ? (
            formatThreadFindCount(props.activeIndex, props.matchCount)
          ) : (
            ""
          )}
        </span>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Previous match"
          disabled={props.matchCount === 0}
          onClick={props.onPrevious}
        >
          <ChevronUpIcon />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Next match"
          disabled={props.matchCount === 0}
          onClick={props.onNext}
        >
          <ChevronDownIcon />
        </Button>
        <Button size="icon-xs" variant="ghost" aria-label="Close find" onClick={props.onClose}>
          <XIcon />
        </Button>
      </InputGroupAddon>
    </InputGroup>
  );
}
