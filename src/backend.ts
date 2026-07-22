declare const spindle: import('lumiverse-spindle-types').SpindleAPI

// Backend responsibilities are now deliberately minimal: permission status,
// prompt storage, and AI generation. All character reading/writing moved to
// the frontend, which talks to Lumiverse's own REST API directly using the
// browser's session — see frontend.ts. That sidesteps the operator-scoped
// userId resolution issue entirely, since a same-origin browser fetch() is
// naturally scoped to whichever user is actually logged in, no extension
// context resolution involved.

const DEFAULT_PROMPTS = {
  base: "You are an expert creative writer and character designer. Rewrite the following character aspect to be more detailed, engaging, and well-written. Do not add commentary, output only the rewritten text.",
  description: "Focus on physical appearance, background, and general vibe.",
  personality: "Focus on traits, quirks, likes, dislikes, and psychological profile.",
  scenario: "Focus on setting the scene and world-building.",
  first_mes: "Focus on setting a strong hook, descriptive actions, and an engaging opening dialogue.",
  mes_example: "Format as dialogue history. Focus on capturing the exact speech patterns, tone, and formatting of the character."
}

spindle.onFrontendMessage(async (payload: any, userId: string) => {
  if (payload.type === 'get_status') {
    // Everything wrapped in try/catch — always answer, never leave the
    // frontend hanging on a "Loading..." placeholder with no response.
    try {
      const hasGeneration = spindle.permissions.has('generation')
      const prompts = await spindle.userStorage.getJson('prompts.json', { fallback: DEFAULT_PROMPTS, userId })
      spindle.sendToFrontend({ type: 'status_result', hasGeneration, prompts }, userId)
    } catch (err: any) {
      spindle.log.error(`Status error: ${err?.message || err}`)
      try {
        spindle.sendToFrontend({ type: 'status_error', error: err?.message || String(err) }, userId)
      } catch (sendErr: any) {
        spindle.log.error(`Failed to notify frontend of status error: ${sendErr?.message || sendErr}`)
      }
    }
  }

  else if (payload.type === 'save_prompts') {
    try {
      await spindle.userStorage.setJson('prompts.json', payload.prompts, { userId })
      spindle.toast.success("Instructions updated!")
      spindle.sendToFrontend({ type: 'prompts_updated', prompts: payload.prompts }, userId)
    } catch (err: any) {
      spindle.log.error(`Save prompts error: ${err.message}`)
      spindle.toast.error(`Failed to save instructions: ${err.message}`)
    }
  }

  else if (payload.type === 'generate') {
    if (!spindle.permissions.has('generation')) {
      spindle.toast.error("Generation permission required.")
      spindle.sendToFrontend({ type: 'generate_failed' }, userId)
      return
    }
    try {
      const prompts = await spindle.userStorage.getJson('prompts.json', { fallback: DEFAULT_PROMPTS, userId })
      const promptCat = payload.category.startsWith('alt_greeting_') ? 'first_mes' : payload.category
      const sysPrompt = `${prompts.base}\n\nCategory guidance:\n${prompts[promptCat] || ""}`

      spindle.toast.info("AI is rewriting...")

      // Same defensive treatment as characters.*/chats.* earlier: docs don't
      // show userId as a generate.quiet() param, but this install clearly
      // needs it somewhere in the operator-scoped RPC path. JS ignores
      // properties a function doesn't use, so passing it is harmless if
      // it's not actually needed.
      const result = await (spindle.generate.quiet as any)({
        messages: [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: `Original Text:\n${payload.originalText}` }
        ],
        userId
      }, userId)

      spindle.sendToFrontend({ type: 'generate_result', result: result.content }, userId)
    } catch (err: any) {
      spindle.toast.error(`Generation failed: ${err.message}`)
      spindle.sendToFrontend({ type: 'generate_failed' }, userId)
    }
  }
})
