// @vitest-environment jsdom

import type { LegendListRef } from "@legendapp/list/react";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useThreadFindNavigation } from "./useThreadFindNavigation";

function Probe(props: Parameters<typeof useThreadFindNavigation>[0]) {
  useThreadFindNavigation(props);
  return null;
}

let root: Root;
let host: HTMLDivElement;
let container: HTMLDivElement;
let rect: DOMRect;
const scrollToIndex = vi.fn<LegendListRef["scrollToIndex"]>();
const scrollToOffset = vi.fn<LegendListRef["scrollToOffset"]>();
let props: ComponentProps<typeof Probe>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("CSS", { highlights: new Map() });
  vi.stubGlobal(
    "Highlight",
    class extends Set<Range> {
      constructor(...ranges: Range[]) {
        super(ranges);
      }
    },
  );
  rect = new DOMRect(0, 200, 40, 20);
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => rect,
  });
  host = document.createElement("div");
  container = document.createElement("div");
  container.innerHTML =
    '<div data-timeline-row-id="message"><p data-thread-find-text>COD4 and COD4</p></div>';
  container.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
  document.body.append(host, container);
  root = createRoot(host);
  scrollToIndex.mockResolvedValue();
  props = {
    container,
    query: "COD4",
    match: { entryId: "message", runId: null, occurrence: 0 },
    navigationId: 0,
    rowIndex: 0,
    entries: [{ id: "message" }],
    listRef: {
      current: {
        scrollToIndex,
        scrollToOffset,
        getState: () => ({ scroll: 300 }),
      } as unknown as LegendListRef,
    },
    contentInsetEndAdjustment: 100,
    listReady: true,
  };
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  container.remove();
  Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("find result navigation", () => {
  it("waits for list bootstrap before positioning the first result", async () => {
    rect = new DOMRect(0, 1800, 40, 20);
    await act(async () => root.render(<Probe {...props} listReady={false} />));
    expect(scrollToIndex).not.toHaveBeenCalled();
    expect(scrollToOffset).not.toHaveBeenCalled();
    scrollToIndex.mockImplementationOnce(async () => {
      rect = new DOMRect(0, 200, 40, 20);
    });
    await act(async () => root.render(<Probe {...props} />));
    expect(scrollToIndex).toHaveBeenCalledTimes(1);
    expect(scrollToOffset).not.toHaveBeenCalled();
  });
  it("leaves the scroll position unchanged between already visible occurrences", async () => {
    await act(async () => root.render(<Probe {...props} />));
    await act(async () =>
      root.render(
        <Probe
          {...props}
          navigationId={1}
          match={{ entryId: "message", runId: null, occurrence: 1 }}
        />,
      ),
    );
    expect(scrollToIndex).not.toHaveBeenCalled();
    expect(scrollToOffset).not.toHaveBeenCalled();
    const highlight = CSS.highlights.get("t3-thread-find-active");
    const ranges = [...(highlight as unknown as Set<Range>)];
    expect(ranges).toHaveLength(1);
    expect(ranges[0]?.startOffset).toBe(9);
    expect(ranges[0]?.toString()).toBe("COD4");
  });

  it("moves only far enough to reveal text below the composer", async () => {
    await act(async () => root.render(<Probe {...props} />));
    rect = new DOMRect(0, 450, 40, 20);
    await act(async () =>
      root.render(
        <Probe
          {...props}
          navigationId={1}
          match={{ entryId: "message", runId: null, occurrence: 1 }}
        />,
      ),
    );
    expect(scrollToIndex).not.toHaveBeenCalled();
    expect(scrollToOffset).toHaveBeenCalledExactlyOnceWith({ offset: 366, animated: false });
  });

  it("moves only far enough to reveal text above the viewport margin", async () => {
    await act(async () => root.render(<Probe {...props} />));
    rect = new DOMRect(0, 40, 40, 20);
    await act(async () =>
      root.render(
        <Probe
          {...props}
          navigationId={1}
          match={{ entryId: "message", runId: null, occurrence: 1 }}
        />,
      ),
    );
    expect(scrollToIndex).not.toHaveBeenCalled();
    expect(scrollToOffset).toHaveBeenCalledExactlyOnceWith({ offset: 244, animated: false });
  });

  it("waits for a new context window to settle before revealing an offscreen result", async () => {
    rect = new DOMRect(0, 1800, 40, 20);
    scrollToIndex.mockImplementationOnce(async () => {
      rect = new DOMRect(0, 450, 40, 20);
    });
    await act(async () => root.render(<Probe {...props} />));
    expect(scrollToIndex).toHaveBeenCalledTimes(1);
    expect(scrollToOffset).toHaveBeenCalledExactlyOnceWith({ offset: 366, animated: false });
  });

  it("materializes a virtualized message before revealing its occurrence", async () => {
    container.replaceChildren();
    await act(async () => root.render(<Probe {...props} rowIndex={4} />));
    expect(scrollToIndex).toHaveBeenCalledExactlyOnceWith({
      index: 4,
      animated: false,
      viewOffset: 96,
    });
    expect(scrollToOffset).not.toHaveBeenCalled();
    rect = new DOMRect(0, 450, 40, 20);
    await act(async () => {
      container.innerHTML =
        '<div data-timeline-row-id="message"><p data-thread-find-text>COD4</p></div>';
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    expect(scrollToIndex).toHaveBeenCalledTimes(1);
    expect(scrollToOffset).toHaveBeenCalledExactlyOnceWith({ offset: 366, animated: false });
  });
});
