import {
  OrchestrationV2TurnItemJson,
  type OrchestrationV2ProjectedTurnItem,
  OrchestrationV2SearchThreadInput,
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
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import {
  ProjectionStoreReadError,
  ProjectionStoreThreadNotFoundError,
  type ProjectionStoreV2Error,
} from "./ProjectionStore.ts";

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
class TextKey extends Data.Class<{
  text: string;
  role: "user" | "assistant" | "plan";
  streaming: boolean;
  hasContext: boolean;
  cwd: string | undefined;
  skills: NonNullable<OrchestrationV2SearchThreadInput["skills"]>;
}> {}

function textKey(
  item: OrchestrationV2TurnItem,
  cwd: string | undefined,
  skills: TextKey["skills"],
) {
  return new TextKey({
    text:
      item.type === "proposed_plan"
        ? item.markdown
        : item.type === "user_message" || item.type === "assistant_message"
          ? item.text
          : "",
    role:
      item.type === "proposed_plan" ? "plan" : item.type === "user_message" ? "user" : "assistant",
    streaming: item.type === "assistant_message" && item.streaming,
    hasContext: item.type === "user_message" && item.context !== undefined,
    cwd,
    skills,
  });
}

function parseText(key: TextKey): readonly string[] {
  return key.role === "plan"
    ? searchablePlanSegments(key.text, key.cwd)
    : (searchableMessageSegments(
        {
          role: key.role,
          text: key.text,
          streaming: key.streaming,
          context: key.hasContext ? { version: 1, records: [] } : undefined,
        },
        key.cwd,
        key.skills,
      ) ?? []);
}

function searchableRows(items: readonly OrchestrationV2ProjectedTurnItem[]) {
  const foldedAnswers = new Set(
    items.flatMap(({ item }) =>
      item.type === "user_input_request" && item.questionAnswer
        ? [`async-answer:${item.questionAnswer.requestId}`]
        : [],
    ),
  );
  return items.filter(
    ({ item }) =>
      ["user_message", "assistant_message", "proposed_plan"].includes(item.type) &&
      !(item.type === "user_message" && foldedAnswers.has(item.messageId)),
  );
}

function documentFor(row: OrchestrationV2ProjectedTurnItem, count: number): FindDocument {
  return {
    position: row.position,
    visibility: row.visibility,
    sourceThreadId: row.sourceThreadId,
    sourceItemId: row.sourceItemId,
    entryId:
      row.item.type === "user_message" || row.item.type === "assistant_message"
        ? row.item.messageId
        : row.item.id,
    runId: row.item.runId,
    count,
  };
}

function countSegments(segments: readonly string[], query: string) {
  return segments.reduce((sum, text) => sum + countThreadSearchOccurrences(text, query), 0);
}

function selectMatch(
  documents: readonly FindDocument[],
  input: Pick<OrchestrationV2SearchThreadInput, "index" | "start" | "offset">,
) {
  const totalMatches = documents.reduce((sum, doc) => sum + doc.count, 0);
  let requestedIndex = input.index ?? 0;
  if (input.index === undefined && input.start) {
    const startIndex = documents.findIndex((doc) => doc.entryId === input.start?.entryId);
    if (startIndex >= 0) {
      requestedIndex =
        documents.slice(0, startIndex).reduce((sum, doc) => sum + doc.count, 0) +
        Math.min(input.start.occurrence, documents[startIndex]!.count);
      if (requestedIndex >= totalMatches) requestedIndex = 0;
    }
  }
  const activeIndex =
    input.index === undefined && totalMatches > 0
      ? (((requestedIndex + (input.offset ?? 0)) % totalMatches) + totalMatches) % totalMatches
      : Math.min(requestedIndex, Math.max(0, totalMatches - 1));
  let occurrence = activeIndex;
  for (const document of documents) {
    if (occurrence < document.count) return { totalMatches, activeIndex, document, occurrence };
    occurrence -= document.count;
  }
  return { totalMatches, activeIndex, document: null, occurrence: 0 };
}

/** The memory projection uses the same match ordering as SQLite. */
export function findProjectedThreadItems(
  items: readonly OrchestrationV2ProjectedTurnItem[],
  input: OrchestrationV2SearchThreadInput,
  snapshotSequence: number,
  cwd?: string,
): OrchestrationV2SearchThreadResult {
  const rows = searchableRows(items);
  const docs = rows.map((row) =>
    documentFor(
      row,
      countSegments(parseText(textKey(row.item, cwd, input.skills ?? [])), input.query),
    ),
  );
  return resultForSelection(selectMatch(docs, input), snapshotSequence);
}

function resultForSelection(
  selected: ReturnType<typeof selectMatch>,
  snapshotSequence: number,
): OrchestrationV2SearchThreadResult {
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
  const encodeCacheKey = Schema.encodeEffect(
    Schema.fromJsonString(
      Schema.Struct({
        threadId: ThreadId,
        cwd: Schema.optional(Schema.String),
        query: Schema.String,
        skills: OrchestrationV2SearchThreadInput.fields.skills,
      }),
    ),
  );
  const encodeThreadIds = Schema.encodeEffect(Schema.fromJsonString(Schema.Array(ThreadId)));
  const encodeSources = Schema.encodeEffect(
    Schema.fromJsonString(Schema.Array(Schema.Struct({ threadId: ThreadId, id: TurnItemId }))),
  );
  const decodeItem = Schema.decodeUnknownEffect(Schema.fromJsonString(OrchestrationV2TurnItemJson));
  const isSnapshotError = Schema.is(
    Schema.Union([ProjectionStoreReadError, ProjectionStoreThreadNotFoundError]),
  );
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
    return yield* Effect.forEach(rows, (row) => {
      const payload = byThread.get(row.sourceThreadId)?.get(row.sourceItemId);
      return payload === undefined
        ? Effect.fail(new ProjectionStoreReadError({ threadId }))
        : Effect.succeed({ ...row, payload });
    });
  });
  // Cache rendered segments, not queries; typing and navigation reuse Markdown parsing.
  const textCache = yield* Cache.make({
    capacity: 512,
    timeToLive: "1 minute",
    lookup: (key: TextKey) => Effect.sync(() => parseText(key)),
  });
  // Bounded separately because each entry can hold a large body; typing reuses the parse.
  const largeTextCache = yield* Cache.make({
    capacity: 32,
    timeToLive: "1 minute",
    lookup: (key: TextKey) => Effect.sync(() => parseText(key)),
  });
  // Scans retain counts and item references, never message bodies. Navigation checks
  // the current revision in its transaction without reloading message payloads.
  const scans = new Map<
    string,
    {
      sequence: number;
      documents: readonly FindDocument[];
      sourceThreadIds: readonly ThreadId[];
    }
  >();
  const readRevision = Effect.fn("ThreadFind.readRevision")(function* (
    threadIds: readonly ThreadId[],
  ) {
    const sources = yield* encodeThreadIds(threadIds);
    const revision = yield* sql<{ sequence: number }>`
      WITH RECURSIVE source_threads(thread_id) AS (
        SELECT value FROM json_each(${sources})
        UNION
        SELECT json_extract(t.payload_json, '$.forkedFrom.threadId')
        FROM orchestration_v2_projection_threads t
        JOIN source_threads s ON s.thread_id = t.thread_id
        WHERE json_extract(t.payload_json, '$.forkedFrom.type') = 'run'
      )
      SELECT COALESCE(MAX(sequence), 0) AS sequence FROM orchestration_events
      WHERE application_event_version = 2 AND aggregate_kind = 'thread'
        AND stream_id IN (SELECT thread_id FROM source_threads)
    `;
    return revision[0]?.sequence ?? 0;
  });
  const snapshot = Effect.fn("ThreadFind.snapshot")(
    function* (input: OrchestrationV2SearchThreadInput) {
      const { threadId } = input;
      const active = yield* sql<{ cwd: string | null }>`
      SELECT COALESCE(json_extract(t.payload_json, '$.worktreePath'), p.workspace_root) AS cwd
      FROM orchestration_v2_projection_threads t JOIN projection_projects p ON p.project_id = t.project_id
      WHERE t.thread_id = ${threadId} AND t.deleted_at IS NULL AND p.deleted_at IS NULL
    `;
      if (!active[0]) return yield* new ProjectionStoreThreadNotFoundError({ threadId });
      const cwd = active[0].cwd ?? undefined;
      const cacheKey = yield* encodeCacheKey({
        threadId,
        cwd,
        query: input.query,
        skills: input.skills ?? [],
      });
      const cached = scans.get(cacheKey);
      if (cached && cached.sequence === (yield* readRevision(cached.sourceThreadIds))) {
        const selected = selectMatch(cached.documents, input);
        scans.delete(cacheKey);
        scans.set(cacheKey, cached);
        return { result: resultForSelection(selected, cached.sequence) };
      }
      const index = yield* readIndex(threadId);
      const sourceThreadIds = [...new Set([threadId, ...index.map((row) => row.sourceThreadId)])];
      const sequence = yield* readRevision(sourceThreadIds);
      const candidates = index
        .map((row, position) => ({ ...row, position }))
        .filter((row) =>
          ["user_message", "assistant_message", "proposed_plan", "user_input_request"].includes(
            row.item.type,
          ),
        );
      const payloads: (FindRow & { readonly payload: string })[] = [];
      for (let start = 0; start < candidates.length; start += 128) {
        payloads.push(...(yield* load(threadId, candidates.slice(start, start + 128))));
      }
      return { payloads, cwd, sequence, cacheKey, sourceThreadIds };
    },
    sql.withTransaction,
    (effect, input) =>
      effect.pipe(
        Effect.mapError((cause) =>
          isSnapshotError(cause)
            ? cause
            : new ProjectionStoreReadError({ threadId: input.threadId, cause }),
        ),
      ),
  );
  return Effect.fn("ProjectionStore.searchThread")(function* (
    input: OrchestrationV2SearchThreadInput,
  ) {
    // Release the SQLite connection before parsing. All rows and their revision
    // come from one snapshot, including inherited fork history.
    const data = yield* snapshot(input);
    if (data.result) return data.result;
    const { payloads, cwd, sequence, cacheKey, sourceThreadIds } = data;
    // Decode after the snapshot so the write lock is not held for it.
    const items: OrchestrationV2ProjectedTurnItem[] = yield* Effect.forEach(
      payloads,
      ({ payload, ...row }) =>
        decodeItem(payload).pipe(
          Effect.map((item) => ({ ...row, item })),
          Effect.mapError(
            (cause) => new ProjectionStoreReadError({ threadId: input.threadId, cause }),
          ),
        ),
    );
    const rows = searchableRows(items);
    const skills = input.skills ?? [];
    const documents: FindDocument[] = [];
    for (const row of rows) {
      const key = textKey(row.item, cwd, skills);
      const segments = yield* Cache.get(
        key.text.length <= 32_768 ? textCache : largeTextCache,
        key,
      );
      documents.push(documentFor(row, countSegments(segments, input.query)));
      yield* Effect.yieldNow;
    }
    scans.delete(cacheKey);
    scans.set(cacheKey, { sequence, documents, sourceThreadIds });
    if (scans.size > 8) {
      const oldest = scans.keys().next().value;
      if (oldest !== undefined) scans.delete(oldest);
    }
    return resultForSelection(selectMatch(documents, input), sequence);
  });
});
