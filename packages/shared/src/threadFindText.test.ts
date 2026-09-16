import { expect, it } from "vite-plus/test";
import { searchableMessageSegments } from "./threadFindText.ts";

it("excludes review attachments rendered as context chips", () => {
  const text = [
    "Before **review**",
    '<review_comment sectionId="turn:2" sectionTitle="Turn 2" filePath="hidden.ts" startIndex="3" endIndex="14" rangeLabel="L4">',
    "Keep **this literal** comment.",
    "```diff",
    "+ hidden patch content",
    "```",
    "</review_comment>",
    "After review",
  ].join("\n");
  expect(searchableMessageSegments({ role: "user", text, streaming: false })).toEqual([
    "Before review",
    " After review",
  ]);
});

it("keeps malformed review tags visible, matching the message renderer", () => {
  const text = "<review_comment>not a valid attachment</review_comment>";
  expect(searchableMessageSegments({ role: "user", text, streaming: false })).toEqual([text]);
});

it("excludes structured context chips without joining text across them", () => {
  expect(
    searchableMessageSegments({
      role: "user",
      streaming: false,
      text: "before[hidden label](t3-context://v1/terminal/terminal_1)after",
      context: { version: 1, records: [] },
    }),
  ).toEqual(["before", "after"]);
});

it("does not upgrade literal legacy tags in messages with structured context", () => {
  const text =
    "<terminal_context>\n- Terminal 1 line 12:\n  12 | visible output\n</terminal_context>";
  expect(
    searchableMessageSegments({
      role: "user",
      streaming: false,
      text,
      context: { version: 1, records: [] },
    })?.join("\n"),
  ).toContain("visible output");
  expect(searchableMessageSegments({ role: "user", streaming: false, text })).toEqual([]);
});

it("keeps context reference syntax inside code searchable", () => {
  expect(
    searchableMessageSegments({
      role: "user",
      streaming: false,
      text: "`[label](t3-context://v1/terminal/terminal_1)`",
    }),
  ).toEqual(["[label](t3-context://v1/terminal/terminal_1)"]);
});

it("excludes repeated legacy attachments containing literal context tags", () => {
  const context =
    "<terminal_context>\n- Terminal 1 line 12:\n  12 | <terminal_context>literal</terminal_context>\n</terminal_context>";
  expect(
    searchableMessageSegments({
      role: "user",
      streaming: false,
      text: `Fix this\n\n${context}\n\n${context}`,
    }),
  ).toEqual(["Fix this"]);
});
