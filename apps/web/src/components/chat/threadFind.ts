import type { TurnId } from "@t3tools/contracts";
import { findThreadSearchOccurrences } from "@t3tools/client-runtime/state/thread-search";
import type { TimelineEntry } from "../../session-logic";
import { proposedPlanTitle, stripDisplayedPlanMarkdown } from "../../proposedPlan";
import { deriveDisplayedUserMessageContent } from "~/lib/visibleMessageText";
import {
  formatInlineTerminalContextLabel,
  textContainsInlineTerminalContextLabels,
} from "./userMessageTerminalContexts";
import { markdownThreadFindText } from "./threadFindText";

/** One occurrence of the query inside a searchable timeline entry. */
export interface ThreadFindMatch {
  readonly entryId: string;
  /** The turn to expand when the matching entry is folded. */
  readonly turnId: TurnId | null;
  /** Zero-based occurrence within this timeline entry. */
  readonly occurrence: number;
}

// Message/plan records are immutable and survive timeline rebuilds during streaming.
// Weak keys reuse parsed text across keystrokes without retaining old messages.
const entryTextCache = new WeakMap<object, readonly string[] | null>();

function searchableThreadEntrySegments(entry: TimelineEntry): readonly string[] | null {
  const key =
    entry.kind === "message"
      ? entry.message
      : entry.kind === "proposed-plan"
        ? entry.proposedPlan
        : entry;
  if (entryTextCache.has(key)) return entryTextCache.get(key)!;
  const segments = deriveThreadEntrySegments(entry);
  entryTextCache.set(key, segments);
  return segments;
}

function deriveThreadEntrySegments(entry: TimelineEntry): readonly string[] | null {
  if (entry.kind === "proposed-plan") {
    const markdown = entry.proposedPlan.planMarkdown;
    return [
      proposedPlanTitle(markdown) ?? "Proposed plan",
      ...markdownThreadFindText(stripDisplayedPlanMarkdown(markdown)),
    ];
  }
  if (entry.kind !== "message") return null;
  if (entry.message.role === "user") {
    const { visibleText, terminalContexts } = deriveDisplayedUserMessageContent(entry.message.text);
    if (
      !terminalContexts.length ||
      !textContainsInlineTerminalContextLabels(visibleText, terminalContexts)
    ) {
      return markdownThreadFindText(visibleText, true);
    }
    const segments: string[] = [];
    let cursor = 0;
    for (const context of terminalContexts) {
      const label = formatInlineTerminalContextLabel(context.header);
      const index = visibleText.indexOf(label, cursor);
      segments.push(...markdownThreadFindText(visibleText.slice(cursor, index), true));
      cursor = index + label.length;
    }
    segments.push(...markdownThreadFindText(visibleText.slice(cursor), true));
    return segments;
  }
  if (entry.message.role !== "assistant") return null;
  return markdownThreadFindText(
    entry.message.text || (entry.message.streaming ? "" : "(empty response)"),
  );
}

/** Conversation text only: source-only Markdown and generated controls are excluded. */
export function searchableThreadEntryText(entry: TimelineEntry): string | null {
  return searchableThreadEntrySegments(entry)?.join("\n") ?? null;
}

function threadEntryTurnId(entry: TimelineEntry): TurnId | null {
  if (entry.kind === "message") return entry.message.turnId ?? null;
  if (entry.kind === "proposed-plan") return entry.proposedPlan.turnId;
  return null;
}

export function buildThreadFindMatches(
  entries: ReadonlyArray<TimelineEntry>,
  query: string,
): ThreadFindMatch[] {
  const normalizedQuery = query.trim();
  if (normalizedQuery.length === 0) return [];

  const matches: ThreadFindMatch[] = [];
  for (const entry of entries) {
    const segments = searchableThreadEntrySegments(entry);
    if (segments === null) continue;

    const total = segments.reduce(
      (count, text) => count + findThreadSearchOccurrences(text, normalizedQuery).length,
      0,
    );
    for (let occurrence = 0; occurrence < total; occurrence += 1) {
      matches.push({
        entryId: entry.id,
        turnId: threadEntryTurnId(entry),
        occurrence,
      });
    }
  }
  return matches;
}

export function clampThreadFindIndex(index: number, total: number): number {
  if (total <= 0 || !Number.isFinite(index) || index < 0) return 0;
  return Math.min(Math.trunc(index), total - 1);
}

export function stepThreadFindIndex(index: number, total: number, delta: number): number {
  if (total <= 0) return 0;
  const clamped = clampThreadFindIndex(index, total);
  return (((clamped + delta) % total) + total) % total;
}

export function formatThreadFindCount(index: number, total: number): string {
  return total <= 0 ? "0/0" : `${clampThreadFindIndex(index, total) + 1}/${total}`;
}
