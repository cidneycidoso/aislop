import type { SpindleAPI } from "lumiverse-spindle-types";
import {
  CATEGORIES,
  defaultConfig,
  isArrayCategory,
  type CategoryId,
  type RewriterConfig,
  type RewriterRequest,
  type RewriterResponse,
} from "./shared";

declare const spindle: SpindleAPI;

const CONFIG_PATH = "config.json";

async function loadConfig(userId: string): Promise<RewriterConfig> {
  const fallback = defaultConfig();
  const stored = await spindle.userStorage.getJson<RewriterConfig>(CONFIG_PATH, {
    fallback,
    userId,
  });
  // Merge in any category prompts added in a later version of this extension
  // that predate the user's saved config.
  return {
    ...fallback,
    ...stored,
    categoryPrompts: { ...fallback.categoryPrompts, ...(stored.categoryPrompts ?? {}) },
  };
}

async function saveConfig(userId: string, config: RewriterConfig): Promise<void> {
  await spindle.userStorage.setJson(CONFIG_PATH, config, { userId, indent: 2 });
}

/**
 * The `generate.quiet` / `generate.raw` result type is intentionally `unknown`
 * in the Spindle API (it mirrors whatever the resolved provider returns).
 * This defensively pulls text out of the shapes we're likely to see.
 */
function extractText(result: unknown): string {
  if (typeof result === "string") return result;
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (typeof r.content === "string") return r.content;
    // OpenAI-style
    const choices = r.choices as Array<{ message?: { content?: string } }> | undefined;
    if (choices?.[0]?.message?.content) return choices[0].message.content as string;
    // Anthropic-style content blocks
    const blocks = r.content as Array<{ type?: string; text?: string }> | undefined;
    if (Array.isArray(blocks)) {
      const text = blocks
        .filter((b) => b.type === "text" && typeof b.text === "string")
        .map((b) => b.text)
        .join("");
      if (text) return text;
    }
  }
  throw new Error("Could not extract text from generation result — check the shape logged below.");
}

function reply(response: RewriterResponse, userId: string) {
  spindle.sendToFrontend(response, userId);
}

function fail(requestId: string, userId: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  reply({ type: "error", requestId, message }, userId);
}

spindle.onFrontendMessage(async (payload, userId) => {
  const req = payload as RewriterRequest;

  try {
    switch (req.type) {
      case "get_config": {
        const config = await loadConfig(userId);
        reply({ type: "get_config", requestId: req.requestId, config }, userId);
        break;
      }

      case "save_config": {
        await saveConfig(userId, req.config);
        reply({ type: "save_config", requestId: req.requestId, ok: true }, userId);
        break;
      }

      case "list_connections": {
        const connections = await spindle.connections.list(userId);
        reply(
          {
            type: "list_connections",
            requestId: req.requestId,
            connections: connections.map((c) => ({
              id: c.id,
              name: c.name,
              provider: c.provider,
              model: c.model,
              isDefault: c.is_default,
            })),
          },
          userId,
        );
        break;
      }

      case "get_character": {
        const character = await spindle.characters.get(req.characterId, userId);
        reply({ type: "get_character", requestId: req.requestId, character: character as Record<string, unknown> | null }, userId);
        break;
      }

      case "rewrite": {
        if (!CATEGORIES.includes(req.category as CategoryId)) {
          throw new Error(`Unknown category: ${req.category}`);
        }
        const config = await loadConfig(userId);
        const systemPrompt = `${config.basePrompt}\n\nField-specific instructions: ${req.instructions}`;

        const result = await spindle.generate.quiet({
          type: "quiet",
          connection_id: req.connectionId,
          userId,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: req.originalText },
          ],
        });

        const text = extractText(result).trim();

        // Remember the connection choice as a convenience default.
        if (req.connectionId && req.connectionId !== config.lastConnectionId) {
          await saveConfig(userId, { ...config, lastConnectionId: req.connectionId });
        }

        reply({ type: "rewrite", requestId: req.requestId, text }, userId);
        break;
      }

      case "apply": {
        if (!CATEGORIES.includes(req.category as CategoryId)) {
          throw new Error(`Unknown category: ${req.category}`);
        }

        if (isArrayCategory(req.category)) {
          const character = await spindle.characters.get(req.characterId, userId);
          if (!character) throw new Error("Character not found.");
          const greetings = Array.isArray(character.alternate_greetings) ? [...character.alternate_greetings] : [];

          if (typeof req.greetingIndex === "number" && req.greetingIndex >= 0 && req.greetingIndex < greetings.length) {
            greetings[req.greetingIndex] = req.newText;
          } else {
            greetings.push(req.newText);
          }

          await spindle.characters.update(req.characterId, { alternate_greetings: greetings }, userId);
        } else {
          await spindle.characters.update(req.characterId, { [req.category]: req.newText }, userId);
        }

        reply({ type: "apply", requestId: req.requestId, ok: true }, userId);
        break;
      }

      default: {
        const _exhaustive: never = req;
        void _exhaustive;
      }
    }
  } catch (err) {
    fail((req as { requestId: string }).requestId, userId, err);
  }
});