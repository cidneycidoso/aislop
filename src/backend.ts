declare const spindle: import('lumiverse-spindle-types').SpindleAPI

const EXT_ID = 'ai_character_rewriter'
const PROMPTS_FILE = 'prompts.json'
const VERSIONS_FILE = 'versions.json'

const DEFAULT_PROMPTS = {
  base: "You are an expert creative writer and character designer. Rewrite the following character aspect to be more detailed, engaging, and well-written. Do not add commentary, output only the rewritten text.",
  description: "Focus on physical appearance, background, and general vibe.",
  personality: "Focus on traits, quirks, likes, dislikes, and psychological profile.",
  scenario: "Focus on setting the scene and world-building.",
  first_mes: "Focus on setting a strong hook, descriptive actions, and an engaging opening dialogue."
}

spindle.onFrontendMessage(async (payload: any, userId: string) => {
  if (payload.type === 'get_prompts') {
    try {
      const prompts = await spindle.userStorage.getJson(PROMPTS_FILE, { fallback: DEFAULT_PROMPTS, userId })
      spindle.sendToFrontend({ type: 'prompts_data', prompts }, userId)
    } catch (err: any) {
      spindle.sendToFrontend({ type: 'prompts_data', prompts: DEFAULT_PROMPTS }, userId)
    }
  }

  else if (payload.type === 'save_prompts') {
    try {
      await spindle.userStorage.setJson(PROMPTS_FILE, payload.prompts, { userId })
      spindle.toast.success("Instructions updated!", { userId } as any)
      spindle.sendToFrontend({ type: 'prompts_saved' }, userId)
    } catch (err: any) {
      spindle.toast.error(`Save error: ${err.message}`, { userId } as any)
    }
  }

  else if (payload.type === 'get_versions') {
    try {
      const versions = await spindle.userStorage.getJson(VERSIONS_FILE, { fallback: {}, userId })
      spindle.sendToFrontend({ type: 'versions_data', versions }, userId)
    } catch (err: any) {
      spindle.sendToFrontend({ type: 'versions_data', versions: {} }, userId)
    }
  }

  else if (payload.type === 'save_versions') {
    try {
      await spindle.userStorage.setJson(VERSIONS_FILE, payload.versions, { userId })
      spindle.sendToFrontend({ type: 'versions_saved' }, userId)
    } catch (err: any) {
      spindle.toast.error(`Save versions error: ${err.message}`, { userId } as any)
    }
  }

  else if (payload.type === 'generate') {
    if (!spindle.permissions.has('generation')) {
      spindle.toast.error("Generation permission required.", { userId } as any)
      spindle.sendToFrontend({ type: 'generate_failed', error: 'Generation permission required' }, userId)
      return
    }
    try {
      const prompts = await spindle.userStorage.getJson(PROMPTS_FILE, { fallback: DEFAULT_PROMPTS, userId })
      const sysPrompt = `${prompts.base}\n\nCategory guidance:\n${prompts[payload.category] || ""}`

      spindle.toast.info("AI is rewriting...", { userId } as any)

      const result = await spindle.generate.quiet({
        messages: [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: `Original Text:\n${payload.originalText}` }
        ]
      }, userId)

      spindle.sendToFrontend({ type: 'generate_result', result: result.content }, userId)
    } catch (err: any) {
      spindle.toast.error(`Generation failed: ${err.message}`, { userId } as any)
      spindle.sendToFrontend({ type: 'generate_failed', error: err.message }, userId)
    }
  }
})
