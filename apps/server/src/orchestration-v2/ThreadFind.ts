import {
  OrchestrationV2TurnItemJson,
  type OrchestrationV2ProjectedTurnItem,
  type OrchestrationV2SearchThreadInput,
  type OrchestrationV2SearchThreadResult,
  type OrchestrationV2TurnItem,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import { searchableMessageSegments, searchablePlanSegments } from "@t3tools/shared/threadFindText";
import { countThreadSearchOccurrences } from "@t3tools/shared/threadSearch";
import * as Cache from "effect/Cache";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { ProjectionStoreReadError, type ProjectionStoreV2Error } from "./ProjectionStore.ts";

interface FindRow {
  readonly position: number;
  readonly visibility: OrchestrationV2ProjectedTurnItem["visibility"];
  readonly sourceThreadId: ThreadId;
  readonly sourceItemId: TurnItemId;
}
interface FindDocument extends FindRow {
  readonly entryId: string;
  readonly runId: OrchestrationV2TurnItem["runId"];
  readonly count: number;
}
class SearchKey extends Data.Class<{
  threadId: ThreadId;
  query: string;
  sequence: number;
  cwd: string | undefined;
}> {}

function countItem(item: OrchestrationV2TurnItem, query: string, cwd?: string): number {
  let segments: readonly string[] | null = null;
  if (item.type === "proposed_plan") segments = searchablePlanSegments(item.markdown, cwd);
  else if (item.type === "user_message" || item.type === "assistant_message")
    segments = searchableMessageSegments(
      {
        role: item.type === "user_message" ? "user" : "assistant",
        text: item.text,
        streaming: item.type === "assistant_message" && item.streaming,
        context: item.type === "user_message" ? item.context : undefined,
      },
      cwd,
    );
  return segments?.reduce((sum, text) => sum + countThreadSearchOccurrences(text, query), 0) ?? 0;
}

function selectMatch(documents: readonly FindDocument[], requestedIndex: number) {
  const totalMatches = documents.reduce((sum, doc) => sum + doc.count, 0);
  const activeIndex = Math.min(requestedIndex, Math.max(0, totalMatches - 1));
  let occurrence = activeIndex;
  for (const document of documents) {
    if (occurrence < document.count) return { totalMatches, activeIndex, document, occurrence };
    occurrence -= document.count;
  }
  return { totalMatches, activeIndex, document: null, occurrence: 0 };
}

/** The memory projection uses the same match ordering and bounded context as SQLite. */
export function findProjectedThreadItems(
  items: readonly OrchestrationV2ProjectedTurnItem[],
  input: OrchestrationV2SearchThreadInput,
  snapshotSequence: number,
  cwd?: string,
): OrchestrationV2SearchThreadResult {
  const foldedAnswers = new Set(
    items.flatMap(({ item }) =>
      item.type === "user_input_request" && item.questionAnswer
        ? [`async-answer:${item.questionAnswer.requestId}`]
        : [],
    ),
  );
  const rows = items.filter(
    ({ item }) =>
      ["user_message", "assistant_message", "proposed_plan"].includes(item.type) &&
      !(item.type === "user_message" && foldedAnswers.has(item.messageId)),
  );
  const docs: FindDocument[] = rows.map((row) => ({
    ...row,
    entryId:
      row.item.type === "user_message" || row.item.type === "assistant_message"
        ? row.item.messageId
        : row.item.id,
    runId: row.item.runId,
    count: countItem(row.item, input.query, cwd),
  }));
  const selected = selectMatch(docs, input.index ?? 0);
  const index = selected.document === null ? -1 : docs.indexOf(selected.document);
  return {
    snapshotSequence,
    totalMatches: selected.totalMatches,
    activeIndex: selected.activeIndex,
    match:
      selected.document === null
        ? null
        : {
            entryId: selected.document.entryId,
            runId: selected.document.runId,
            occurrence: selected.occurrence,
          },
    items: index < 0 ? [] : rows.slice(Math.max(0, index - 2), index + 3),
  };
}

/** Read the canonical index once per scan, including inherited fork rows, without tool bodies. */
export const makeThreadFind = Effect.fn("makeThreadFind")(function* (
  readIndex: (threadId: ThreadId) => Effect.Effect<
    readonly (Omit<FindRow, "position"> & {
      readonly item: Pick<OrchestrationV2TurnItem, "type">;
    })[],
    ProjectionStoreV2Error
  >,
) {
  const sql = yield* SqlClient.SqlClient;
  const encodeSources = Schema.encodeEffect(
    Schema.fromJsonString(Schema.Array(Schema.Struct({ threadId: ThreadId, id: TurnItemId }))),
  );
  const decodeItem = Schema.decodeUnknownEffect(Schema.fromJsonString(OrchestrationV2TurnItemJson));
  const revision = (threadId: ThreadId) =>
    sql<{ sequence: number }>`
    SELECT COALESCE(MAX(sequence), 0) AS sequence FROM orchestration_events
  `.pipe(
      Effect.map((rows) => rows[0]?.sequence ?? 0),
      Effect.mapError((cause) => new ProjectionStoreReadError({ threadId, cause })),
    );
  const changed = (threadId: ThreadId) => new ProjectionStoreReadError({ threadId });
  const load = Effect.fn("ThreadFind.load")(function* (
    threadId: ThreadId,
    rows: readonly FindRow[],
  ) {
    if (rows.length === 0) return [];
    const sources = yield* encodeSources(
      rows.map((row) => ({ threadId: row.sourceThreadId, id: row.sourceItemId })),
    ).pipe(Effect.mapError((cause) => new ProjectionStoreReadError({ threadId, cause })));
    const payloads = yield* sql<{ thread_id: string; turn_item_id: string; payload_json: string }>`
      SELECT item.thread_id, item.turn_item_id, item.payload_json
      FROM orchestration_v2_projection_turn_items AS item
      JOIN json_each(${sources}) AS wanted
        ON item.thread_id = json_extract(wanted.value, '$.threadId')
          AND item.turn_item_id = json_extract(wanted.value, '$.id')
    `.pipe(Effect.mapError((cause) => new ProjectionStoreReadError({ threadId, cause })));
    const byThread = new Map<string, Map<string, string>>();
    for (const row of payloads) {
      let items = byThread.get(row.thread_id);
      if (!items) byThread.set(row.thread_id, (items = new Map()));
      items.set(row.turn_item_id, row.payload_json);
    }
    return yield* Effect.forEach(rows, (row) =>
      Effect.gen(function* () {
        const payload = byThread.get(row.sourceThreadId)?.get(row.sourceItemId);
        if (payload === undefined) return yield* changed(threadId);
        const item = yield* decodeItem(payload).pipe(
          Effect.mapError((cause) => new ProjectionStoreReadError({ threadId, cause })),
        );
        return { ...row, item };
      }),
    );
  });
  const scan = Effect.fn("ThreadFind.scan")(function* (key: SearchKey) {
    const index = yield* readIndex(key.threadId);
    const rows = index.map((row, position) => ({ ...row, position }));
    // Question answers render inside their request card, not as searchable message bubbles.
    const questions = rows.filter((row) => row.item.type === "user_input_request");
    const foldedAnswers = new Set<string>();
    for (let start = 0; start < questions.length; start += 128) {
      for (const { item } of yield* load(key.threadId, questions.slice(start, start + 128))) {
        if (item.type === "user_input_request" && item.questionAnswer)
          foldedAnswers.add(`async-answer:${item.questionAnswer.requestId}`);
      }
      yield* Effect.yieldNow;
    }
    const candidates = rows.filter((row) =>
      ["user_message", "assistant_message", "proposed_plan"].includes(row.item.type),
    );
    const context: FindRow[] = [];
    const documents: FindDocument[] = [];
    for (let start = 0; start < candidates.length; start += 128) {
      const batch = yield* load(key.threadId, candidates.slice(start, start + 128));
      for (const { item, ...row } of batch) {
        if (item.type === "user_message" && foldedAnswers.has(item.messageId)) continue;
        context.push(row);
        const count = countItem(item, key.query, key.cwd);
        if (count > 0)
          documents.push({
            ...row,
            count,
            runId: item.runId,
            entryId:
              item.type === "user_message" || item.type === "assistant_message"
                ? item.messageId
                : item.id,
          });
      }
      yield* Effect.yieldNow;
    }
    if ((yield* revision(key.threadId)) !== key.sequence) return yield* changed(key.threadId);
    return { documents, context };
  });
  // Keep IDs/counts only. Navigation never retains transcript bodies or one record per occurrence.
  const cache = yield* Cache.makeWith(scan, {
    capacity: 16,
    timeToLive: (exit) =>
      Exit.isSuccess(exit) && exit.value.context.length <= 10_000 ? "1 minute" : 0,
  });
  return Effect.fn("ProjectionStore.searchThread")(function* (
    input: OrchestrationV2SearchThreadInput,
  ) {
    const active = yield* sql<{ cwd: string | null }>`
      SELECT COALESCE(json_extract(t.payload_json, '$.worktreePath'), p.workspace_root) AS cwd
      FROM orchestration_v2_projection_threads t JOIN projection_projects p ON p.project_id = t.project_id
      WHERE t.thread_id = ${input.threadId} AND t.deleted_at IS NULL AND p.deleted_at IS NULL
    `.pipe(
      Effect.mapError((cause) => new ProjectionStoreReadError({ threadId: input.threadId, cause })),
    );
    if (!active[0]) return yield* changed(input.threadId);
    const snapshotSequence = yield* revision(input.threadId);
    const { documents, context } = yield* Cache.get(
      cache,
      new SearchKey({
        threadId: input.threadId,
        query: input.query,
        sequence: snapshotSequence,
        cwd: active[0].cwd ?? undefined,
      }),
    );
    const selected = selectMatch(documents, input.index ?? 0);
    const document = selected.document;
    const index =
      document === null ? -1 : context.findIndex((row) => row.position === document.position);
    const items =
      index < 0
        ? []
        : yield* load(input.threadId, context.slice(Math.max(0, index - 2), index + 3));
    if ((yield* revision(input.threadId)) !== snapshotSequence)
      return yield* changed(input.threadId);
    return {
      snapshotSequence,
      totalMatches: selected.totalMatches,
      activeIndex: selected.activeIndex,
      match:
        document === null
          ? null
          : { entryId: document.entryId, runId: document.runId, occurrence: selected.occurrence },
      items,
    };
  });
});
