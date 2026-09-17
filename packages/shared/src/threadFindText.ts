import { renderCodexFileCitationsAsMarkdown } from "./codexMarkdownDirectives.ts";
import {
  buildFileLinkParentSuffixByPath,
  extractMarkdownLinkHrefs,
  extractInlineCodeSpans,
  inlineCodeFilePathCandidate,
  resolveMarkdownFileLinkTarget,
  splitFilePathPosition,
  markdownFileLinkLabel,
} from "./markdownLinks.ts";
import { upgradeLegacyContextMessage } from "./composerContextLegacy.ts";
import { parseComposerContextHref } from "./composerContextReferences.ts";
import type { OrchestrationMessage } from "@t3tools/contracts";
import { proposedPlanTitle, stripDisplayedPlanMarkdown } from "./proposedPlanText.ts";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import {
  CHAT_MARKDOWN_REHYPE_PLUGINS,
  CHAT_MARKDOWN_REMARK_PLUGINS,
  CHAT_MARKDOWN_REMARK_PLUGINS_WITH_BREAKS,
} from "./markdownPipeline.ts";

// Inline wrappers (including Shiki token spans) must not split a search phrase.
export const THREAD_FIND_BLOCK_TAGS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "br",
  "dd",
  "details",
  "div",
  "dl",
  "dt",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "summary",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
]);

const assistantProcessor = unified()
  .use(remarkParse)
  .use(CHAT_MARKDOWN_REMARK_PLUGINS)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(CHAT_MARKDOWN_REHYPE_PLUGINS);
const userProcessor = unified()
  .use(remarkParse)
  .use(CHAT_MARKDOWN_REMARK_PLUGINS_WITH_BREAKS)
  .use(remarkRehype, { allowDangerousHtml: true });

interface TextTree {
  readonly type: string;
  readonly tagName?: string;
  readonly value?: string;
  readonly properties?: {
    readonly href?: unknown;
    readonly src?: unknown;
    readonly dataInlineCode?: unknown;
  };
  readonly children?: ReadonlyArray<TextTree>;
}

/** Uses the renderer's Markdown transforms, without mounting folded/virtualized rows. */
function markdownThreadFindText(markdown: string, userMessage = false, cwd?: string): string[] {
  const processor = userMessage ? userProcessor : assistantProcessor;
  const tree = processor.runSync(processor.parse(markdown));
  const paths = userMessage
    ? []
    : [
        ...extractMarkdownLinkHrefs(renderCodexFileCitationsAsMarkdown(markdown)),
        ...extractInlineCodeSpans(markdown).flatMap(
          (span) => inlineCodeFilePathCandidate(span) ?? [],
        ),
      ].flatMap((href) => {
        const target = resolveMarkdownFileLinkTarget(href, cwd);
        return target ? [splitFilePathPosition(target).path] : [];
      });
  const parentSuffixes = buildFileLinkParentSuffixByPath(paths);
  const segments: string[] = [];
  let text = "";
  const flush = () => {
    if (text.trim()) segments.push(text);
    text = "";
  };
  const visit = (node: TextTree, inPre = false) => {
    const href = node.properties?.href ?? node.properties?.src;
    if (userMessage && typeof href === "string" && parseComposerContextHref(href)) {
      flush();
      return;
    }
    if (!userMessage) {
      let candidate: string | null = null;
      if (node.tagName === "a" && typeof href === "string") {
        candidate = href;
      } else if (
        node.tagName === "code" &&
        !inPre &&
        node.properties?.dataInlineCode !== undefined
      ) {
        candidate = inlineCodeFilePathCandidate(
          (node.children ?? []).map((child) => child.value ?? "").join(""),
        );
      }
      const target = candidate ? resolveMarkdownFileLinkTarget(candidate, cwd) : null;
      if (target) {
        text += markdownFileLinkLabel(splitFilePathPosition(target), parentSuffixes);
        return;
      }
    }
    const block = THREAD_FIND_BLOCK_TAGS.has(node.tagName ?? "");
    if (block) flush();
    if (node.type === "text" || (userMessage && node.type === "raw")) {
      text += inPre ? (node.value ?? "") : (node.value ?? "").replace(/\r?\n/g, " ");
    }
    for (const child of node.children ?? []) visit(child, inPre || node.tagName === "pre");
    if (block) flush();
  };
  visit(tree);
  flush();
  return segments;
}

export function searchablePlanSegments(markdown: string, cwd?: string): readonly string[] {
  return [
    proposedPlanTitle(markdown) ?? "Proposed plan",
    ...markdownThreadFindText(stripDisplayedPlanMarkdown(markdown), false, cwd),
  ];
}

export function searchableMessageSegments(
  message: Pick<OrchestrationMessage, "role" | "text" | "streaming" | "context">,
  cwd?: string,
): readonly string[] | null {
  if (message.role === "user") {
    const text = message.context ? message.text : upgradeLegacyContextMessage(message.text).text;
    return markdownThreadFindText(text, true);
  }
  if (message.role !== "assistant") return null;
  return markdownThreadFindText(
    message.text || (message.streaming ? "" : "(empty response)"),
    false,
    cwd,
  );
}
