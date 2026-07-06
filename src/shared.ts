// Shared types + constants used by both backend.ts and frontend.ts.
// Kept dependency-free so it can be bundled into either target.

/** The rewritable plain-string fields on CharacterDTO / CharacterUpdateDTO. */
export const STRING_CATEGORIES = [
  "description",
  "personality",
  "scenario",
  "first_mes",
  "mes_example",
  "creator_notes",
  "system_prompt",
  "post_history_instructions",
] as const;

export type StringCategoryId = (typeof STRING_CATEGORIES)[number];

/** The one array-valued field this extension supports rewriting entries of. */
export const ALTERNATE_GREETINGS_CATEGORY = "alternate_greetings" as const;

export type CategoryId = StringCategoryId | typeof ALTERNATE_GREETINGS_CATEGORY;

/** Full ordered list used to populate the field picker in the UI. */
export const CATEGORIES: CategoryId[] = [...STRING_CATEGORIES, ALTERNATE_GREETINGS_CATEGORY];

export function isArrayCategory(category: CategoryId): category is typeof ALTERNATE_GREETINGS_CATEGORY {
  return category === ALTERNATE_GREETINGS_CATEGORY;
}

export const CATEGORY_LABELS: Record<CategoryId, string> = {
  description: "Description",
  personality: "Personality",
  scenario: "Scenario",
  first_mes: "First Message",
  mes_example: "Example Messages",
  creator_notes: "Creator Notes",
  system_prompt: "System Prompt",
  post_history_instructions: "Post-History Instructions",
  alternate_greetings: "Alternate Greetings",
};

/** The overarching "what's gonna change" instruction, prepended to every rewrite. */
export const DEFAULT_BASE_PROMPT = [
  "You are a professional character-card editor assisting a creator with their own character.",
  "You will be given ONE field from a chat-bot character card, plus instructions for how to change it.",
  "Rewrite ONLY that field according to the instructions.",
  "Preserve the character's core identity, established facts, and any placeholder tokens exactly as written (e.g. {{user}}, {{char}}).",
  "Keep roughly the same length unless told otherwise.",
  "Output ONLY the rewritten field text. No preamble, no explanation, no markdown fences, no quotes around the result.",
].join(" ");

/** Per-category default instructions, used unless the user overrides them. */
export const DEFAULT_CATEGORY_PROMPTS: Record<CategoryId, string> = {
  description:
    "Rewrite this description to be clearer and more vivid, without changing any established facts, appearance details, or backstory.",
  personality:
    "Rewrite this personality summary to read more naturally, keeping every listed trait and nuance intact.",
  scenario:
    "Rewrite this scenario/setting text to be more evocative and clear, keeping the same situation and stakes.",
  first_mes:
    "Rewrite this opening message in the character's voice, keeping the same tone, content, and any formatting conventions (actions in asterisks, etc.).",
  mes_example:
    "Rewrite these example exchanges to better demonstrate the character's voice, preserving the example format and any {{user}}/{{char}} turn structure.",
  creator_notes:
    "Rewrite these creator notes to be clearer and more organized, keeping all the same information for users of the card.",
  system_prompt:
    "Rewrite this system prompt to be clearer and more effective at steering the model, keeping every existing instruction and constraint.",
  post_history_instructions:
    "Rewrite these post-history instructions to be clearer, keeping every existing rule and constraint intact.",
  alternate_greetings:
    "Write an alternate opening message in the character's voice. It should offer a different angle, mood, or scenario than the character's other greetings, while staying consistent with who they are. Match the same formatting conventions (e.g. actions in asterisks) used elsewhere in the card. If no existing text is given, invent a fresh greeting from the character's other fields.",
};

export interface RewriterConfig {
  basePrompt: string;
  categoryPrompts: Record<CategoryId, string>;
  /** Last-used connection id, remembered as a convenience default. */
  lastConnectionId?: string;
}

export function defaultConfig(): RewriterConfig {
  return {
    basePrompt: DEFAULT_BASE_PROMPT,
    categoryPrompts: { ...DEFAULT_CATEGORY_PROMPTS },
  };
}

// ── Frontend <-> backend RPC message shapes ──
// Every request carries a requestId so the frontend can correlate the
// matching response out of the single onBackendMessage stream.

export type RewriterRequest =
  | { type: "get_config"; requestId: string }
  | { type: "save_config"; requestId: string; config: RewriterConfig }
  | { type: "list_connections"; requestId: string }
  | { type: "get_character"; requestId: string; characterId: string }
  | {
      type: "rewrite";
      requestId: string;
      characterId: string;
      category: CategoryId;
      originalText: string;
      instructions: string;
      connectionId?: string;
    }
  | {
      type: "apply";
      requestId: string;
      characterId: string;
      category: CategoryId;
      newText: string;
      /**
       * Only meaningful when `category` is `alternate_greetings`.
       * A number replaces that existing entry; omitted appends a new one.
       */
      greetingIndex?: number;
    };

/** Distributive Omit — plain `Omit` collapses a union to its shared keys only. */
export type DistributiveOmit<T, K extends keyof any> = T extends any ? Omit<T, K> : never;

export type RewriterRequestInput = DistributiveOmit<RewriterRequest, "requestId">;

export type RewriterResponse =
  | { type: "get_config"; requestId: string; config: RewriterConfig }
  | { type: "save_config"; requestId: string; ok: true }
  | {
      type: "list_connections";
      requestId: string;
      connections: Array<{ id: string; name: string; provider: string; model: string; isDefault: boolean }>;
    }
  | { type: "get_character"; requestId: string; character: Record<string, unknown> | null }
  | { type: "rewrite"; requestId: string; text: string }
  | { type: "apply"; requestId: string; ok: true }
  | { type: "error"; requestId: string; message: string };