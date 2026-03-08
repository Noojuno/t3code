import { Schema } from "effect";
import type { ProviderKind } from "./orchestration";

export const CURSOR_REASONING_OPTIONS = ["low", "normal", "high", "xhigh"] as const;
export type CursorReasoningOption = (typeof CURSOR_REASONING_OPTIONS)[number];

export const CODEX_REASONING_EFFORT_OPTIONS = ["xhigh", "high", "medium", "low"] as const;
export type CodexReasoningEffort = (typeof CODEX_REASONING_EFFORT_OPTIONS)[number];

export const CodexModelOptions = Schema.Struct({
  reasoningEffort: Schema.optional(Schema.Literals(CODEX_REASONING_EFFORT_OPTIONS)),
  fastMode: Schema.optional(Schema.Boolean),
});
export type CodexModelOptions = typeof CodexModelOptions.Type;

export const ClaudeCodeModelOptions = Schema.Struct({
  thinking: Schema.optional(Schema.Boolean),
});
export type ClaudeCodeModelOptions = typeof ClaudeCodeModelOptions.Type;

export const CursorModelOptions = Schema.Struct({
  reasoning: Schema.optional(Schema.Literals(CURSOR_REASONING_OPTIONS)),
  fastMode: Schema.optional(Schema.Boolean),
  thinking: Schema.optional(Schema.Boolean),
});
export type CursorModelOptions = typeof CursorModelOptions.Type;

export const GEMINI_THINKING_LEVEL_OPTIONS = ["high", "medium", "low"] as const;
export type GeminiThinkingLevel = (typeof GEMINI_THINKING_LEVEL_OPTIONS)[number];

export const GeminiModelOptions = Schema.Struct({
  thinkingLevel: Schema.optional(Schema.Literals(GEMINI_THINKING_LEVEL_OPTIONS)),
});
export type GeminiModelOptions = typeof GeminiModelOptions.Type;

export const ProviderModelOptions = Schema.Struct({
  codex: Schema.optional(CodexModelOptions),
  claudeCode: Schema.optional(ClaudeCodeModelOptions),
  cursor: Schema.optional(CursorModelOptions),
  gemini: Schema.optional(GeminiModelOptions),
});
export type ProviderModelOptions = typeof ProviderModelOptions.Type;

type ModelOption = {
  readonly slug: string;
  readonly name: string;
};

type CursorModelFamilyOption = {
  readonly slug: string;
  readonly name: string;
};

export const CURSOR_MODEL_FAMILY_OPTIONS = [
  { slug: "auto", name: "Auto" },
  { slug: "composer-1.5", name: "Composer 1.5" },
  { slug: "composer-1", name: "Composer 1" },
  { slug: "gpt-5.3-codex", name: "GPT-5.3 Codex" },
  { slug: "gpt-5.3-codex-spark-preview", name: "GPT-5.3 Codex Spark" },
  { slug: "opus-4.6", name: "Claude 4.6 Opus" },
  { slug: "opus-4.5", name: "Claude 4.5 Opus" },
  { slug: "sonnet-4.6", name: "Claude 4.6 Sonnet" },
  { slug: "gemini-3.1-pro", name: "Gemini 3.1 Pro" },
] as const satisfies readonly CursorModelFamilyOption[];

export type CursorModelFamily = (typeof CURSOR_MODEL_FAMILY_OPTIONS)[number]["slug"];

export const MODEL_OPTIONS_BY_PROVIDER = {
  codex: [
    { slug: "gpt-5.4", name: "GPT-5.4" },
    { slug: "gpt-5.3-codex", name: "GPT-5.3 Codex" },
    { slug: "gpt-5.3-codex-spark", name: "GPT-5.3 Codex Spark" },
    { slug: "gpt-5.2-codex", name: "GPT-5.2 Codex" },
    { slug: "gpt-5.2", name: "GPT-5.2" },
  ],
  claudeCode: [
    { slug: "claude-opus-4-6", name: "Claude Opus 4.6" },
    { slug: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
    { slug: "claude-haiku-4-5", name: "Claude Haiku 4.5" },
  ],
  cursor: [
    { slug: "auto", name: "Auto" },
    { slug: "composer-1.5", name: "Composer 1.5" },
    { slug: "composer-1", name: "Composer 1" },
    { slug: "gpt-5.3-codex-low", name: "GPT-5.3 Codex Low" },
    { slug: "gpt-5.3-codex-low-fast", name: "GPT-5.3 Codex Low Fast" },
    { slug: "gpt-5.3-codex", name: "GPT-5.3 Codex" },
    { slug: "gpt-5.3-codex-fast", name: "GPT-5.3 Codex Fast" },
    { slug: "gpt-5.3-codex-high", name: "GPT-5.3 Codex High" },
    { slug: "gpt-5.3-codex-high-fast", name: "GPT-5.3 Codex High Fast" },
    { slug: "gpt-5.3-codex-xhigh", name: "GPT-5.3 Codex Extra High" },
    { slug: "gpt-5.3-codex-xhigh-fast", name: "GPT-5.3 Codex Extra High Fast" },
    { slug: "gpt-5.3-codex-spark-preview", name: "GPT-5.3 Codex Spark" },
    { slug: "opus-4.6", name: "Claude 4.6 Opus" },
    { slug: "opus-4.6-thinking", name: "Claude 4.6 Opus (Thinking)" },
    { slug: "opus-4.5", name: "Claude 4.5 Opus" },
    { slug: "opus-4.5-thinking", name: "Claude 4.5 Opus (Thinking)" },
    { slug: "sonnet-4.6", name: "Claude 4.6 Sonnet" },
    { slug: "sonnet-4.6-thinking", name: "Claude 4.6 Sonnet (Thinking)" },
    { slug: "gemini-3.1-pro", name: "Gemini 3.1 Pro" },
  ],
  gemini: [
    { slug: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    { slug: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
    { slug: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite" },
    { slug: "gemini-3-pro-preview", name: "Gemini 3 Pro Preview" },
    { slug: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview" },
    { slug: "gemini-3-flash-preview", name: "Gemini 3 Flash Preview" },
  ],
} as const satisfies Record<ProviderKind, readonly ModelOption[]>;

type BuiltInModelSlug = (typeof MODEL_OPTIONS_BY_PROVIDER)[ProviderKind][number]["slug"];
export type ModelSlug = BuiltInModelSlug | (string & {});
export type CursorModelSlug = (typeof MODEL_OPTIONS_BY_PROVIDER)["cursor"][number]["slug"];

export const DEFAULT_MODEL_BY_PROVIDER: Record<ProviderKind, ModelSlug> = {
  codex: "gpt-5.3-codex",
  claudeCode: "claude-sonnet-4-6",
  cursor: "opus-4.6-thinking",
  gemini: "gemini-2.5-pro",
};

// Backward compatibility for existing Codex-only call sites.
export const MODEL_OPTIONS = MODEL_OPTIONS_BY_PROVIDER.codex;
export const DEFAULT_MODEL = DEFAULT_MODEL_BY_PROVIDER.codex;

export const MODEL_SLUG_ALIASES_BY_PROVIDER: Record<ProviderKind, Record<string, ModelSlug>> = {
  codex: {
    "5.4": "gpt-5.4",
    "5.3": "gpt-5.3-codex",
    "gpt-5.3": "gpt-5.3-codex",
    "5.3-spark": "gpt-5.3-codex-spark",
    "gpt-5.3-spark": "gpt-5.3-codex-spark",
  },
  claudeCode: {
    opus: "claude-opus-4-6",
    "opus-4.6": "claude-opus-4-6",
    "claude-opus-4.6": "claude-opus-4-6",
    "claude-opus-4-6-20251117": "claude-opus-4-6",
    sonnet: "claude-sonnet-4-6",
    "sonnet-4.6": "claude-sonnet-4-6",
    "claude-sonnet-4.6": "claude-sonnet-4-6",
    "claude-sonnet-4-6-20251117": "claude-sonnet-4-6",
    haiku: "claude-haiku-4-5",
    "haiku-4.5": "claude-haiku-4-5",
    "claude-haiku-4.5": "claude-haiku-4-5",
    "claude-haiku-4-5-20251001": "claude-haiku-4-5",
  },
  cursor: {
    composer: "composer-1.5",
    "composer-1.5": "composer-1.5",
    "composer-1": "composer-1",
    "gpt-5.3-codex": "gpt-5.3-codex",
    "gpt-5.3-codex-spark": "gpt-5.3-codex-spark-preview",
    "gemini-3.1-pro": "gemini-3.1-pro",
    "claude-4.6-sonnet-thinking": "sonnet-4.6-thinking",
    "claude-4.6-opus-thinking": "opus-4.6-thinking",
    "claude-4.5-opus-thinking": "opus-4.5-thinking",
    "sonnet-4.6-thinking": "sonnet-4.6-thinking",
    "opus-4.6-thinking": "opus-4.6-thinking",
    "opus-4.5-thinking": "opus-4.5-thinking",
  },
  gemini: {
    "pro": "gemini-2.5-pro",
    "flash": "gemini-2.5-flash",
    "2.5-pro": "gemini-2.5-pro",
    "2.5-flash": "gemini-2.5-flash",
    "2.5-flash-lite": "gemini-2.5-flash-lite",
    "lite": "gemini-2.5-flash-lite",
    "3-pro": "gemini-3-pro-preview",
    "3.1-pro": "gemini-3.1-pro-preview",
    "3-flash": "gemini-3-flash-preview",
  },
};

export const REASONING_EFFORT_OPTIONS_BY_PROVIDER = {
  codex: CODEX_REASONING_EFFORT_OPTIONS,
  claudeCode: [],
  cursor: [],
  gemini: ["high", "medium", "low"] as const,
} as const satisfies Record<ProviderKind, readonly CodexReasoningEffort[]>;

export const DEFAULT_REASONING_EFFORT_BY_PROVIDER = {
  codex: "high",
  claudeCode: null,
  cursor: null,
  gemini: "medium",
} as const satisfies Record<ProviderKind, CodexReasoningEffort | null>;
