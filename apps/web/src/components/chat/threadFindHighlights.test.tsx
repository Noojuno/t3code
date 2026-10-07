// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vite-plus/test";
import { collectThreadFindRanges, useThreadFindHighlights } from "./threadFindHighlights";

function row(html: string) {
  const container = document.createElement("div");
  container.innerHTML = `<div data-timeline-row-id="row"><div data-thread-find-text>${html}</div></div>`;
  return container;
}

describe("collectThreadFindRanges", () => {
  it("finds matches split across inline token spans, in order", () => {
    // Shiki-style tokens split one identifier over several text nodes.
    const container = row(
      "<pre><code><span>con</span><span>st</span> a = <span>c</span>onst; const</code></pre>",
    );
    const ranges = collectThreadFindRanges(container, "const");
    expect(ranges.map((match) => [match.occurrence, match.range.toString()])).toEqual([
      [0, "const"],
      [1, "const"],
      [2, "const"],
    ]);
  });

  it("finds every match across thousands of token nodes", () => {
    const tokens = Array.from({ length: 4000 }, (_, i) => `<span>id</span><span>${i} </span>`);
    const container = row(`<pre><code>${tokens.join("")}</code></pre>`);
    const ranges = collectThreadFindRanges(container, "id");
    expect(ranges).toHaveLength(4000);
    expect(ranges.map((match) => match.occurrence)).toEqual([...ranges.keys()]);
    expect(ranges.every((match) => match.range.toString() === "id")).toBe(true);
  });
});

describe("useThreadFindHighlights", () => {
  it("repaints for searchable text changes but not for timers outside it", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "Highlight",
      class extends Set<Range> {
        constructor(...ranges: Range[]) {
          super(ranges);
        }
      },
    );
    vi.stubGlobal("CSS", { highlights: new Map(), escape: (value: string) => value });
    const container = row("<p>needle</p>");
    const timer = document.createElement("span");
    container.firstElementChild!.append(timer);
    document.body.append(container);
    const host = document.createElement("div");
    const root = createRoot(host);
    const onActiveRange = vi.fn();
    function Probe() {
      useThreadFindHighlights({
        container,
        query: "needle",
        activeRowId: "row",
        activeOccurrence: 0,
        onActiveRange,
      });
      return null;
    }
    const frame = () =>
      act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    try {
      await act(() => root.render(<Probe />));
      onActiveRange.mockClear();
      timer.textContent = "0:01";
      await frame();
      expect(onActiveRange).not.toHaveBeenCalled();
      container.querySelector("p")!.append(" needle");
      await frame();
      expect(onActiveRange).toHaveBeenCalled();
    } finally {
      await act(() => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  });
});
