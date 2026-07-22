declare const spindle: import('lumiverse-spindle-types').SpindleAPI

const DEFAULT_PROMPTS = {
  base: "You are an expert creative writer and character designer. Rewrite the following character aspect to be more detailed, engaging, and well-written. Do not add commentary, output only the rewritten text.",
  description: "Focus on physical appearance, background, and general vibe.",
  personality: "Focus on traits, quirks, likes, dislikes, and psychological profile.",
  scenario: "Focus on setting the scene and world-building.",
  first_mes: "Focus on setting a strong hook, descriptive actions, and an engaging opening dialogue.",
  mes_example: "Format as dialogue history. Focus on capturing the exact speech patterns, tone, and formatting of the character."
}

const activeGenerations = new Map<string, AbortController>()

/** Strips `undefined` (which the Rust binding rejects) by round-tripping through JSON. */
function sanitize<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj ?? {}))
}

spindle.onFrontendMessage(async (payload: any, userId: string) => {
  const sendError = (error: string) => {
    spindle.sendToFrontend({ type: 'error', error }, userId)
  }

  // ------------------------------------------------------------------
  // STATUS
  // ------------------------------------------------------------------
  if (payload.type === 'get_status') {
    try {
      const hasGeneration = spindle.permissions.has('generation')
      const hasCharacters = spindle.permissions.has('characters')
      const hasChats      = spindle.permissions.has('chats')
      const prompts = await spindle.userStorage.getJson('prompts.json', { fallback: DEFAULT_PROMPTS, userId })
      spindle.sendToFrontend({ type: 'status_result', hasGeneration, hasCharacters, hasChats, prompts }, userId)
    } catch (err: any) {
      spindle.log.error(`Status error: ${err?.message || err}`)
      try {
        spindle.sendToFrontend({ type: 'status_error', error: err?.message || String(err) }, userId)
      } catch (sendErr: any) {
        spindle.log.error(`Failed to notify frontend of status error: ${sendErr?.message || sendErr}`)
      }
    }
  }

  // ------------------------------------------------------------------
  // PROMPTS
  // ------------------------------------------------------------------
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

  // ------------------------------------------------------------------
  // CHARACTERS  (paginated list)
  // ------------------------------------------------------------------
  else if (payload.type === 'get_characters') {
    if (!spindle.permissions.has('characters')) {
      sendError('Characters permission is required.')
      spindle.sendToFrontend({ type: 'characters_result', characters: [] }, userId)
      return
    }
    try {
      const allChars: any[] = []
      let offset = 0
      const limit = 200
      while (true) {
        const { data, total } = await spindle.characters.list({ limit, offset, userId })
        allChars.push(...data)
        if (data.length < limit || allChars.length >= total) break
        offset += limit
      }
      spindle.sendToFrontend({ type: 'characters_result', characters: allChars }, userId)
    } catch (err: any) {
      spindle.log.error(`Get characters error: ${err?.message || err}`)
      sendError(`Failed to load characters: ${err?.message || err}`)
      spindle.sendToFrontend({ type: 'characters_result', characters: [] }, userId)
    }
  }

  // ------------------------------------------------------------------
  // RESOLVE ACTIVE CHARACTER
  // ------------------------------------------------------------------
  else if (payload.type === 'resolve_active_char') {
    try {
      let charId: string | null = null

      if (payload.routeType === 'characters' && payload.routeId) {
        charId = payload.routeId
      } else if (payload.routeType === 'chat' && payload.routeId && spindle.permissions.has('chats')) {
        const chat = await spindle.chats.get(payload.routeId, { userId })
        charId = chat?.character_id || null
      }

      if (!charId && spindle.permissions.has('chats')) {
        const activeChat = await spindle.chats.getActive({ userId })
        charId = activeChat?.character_id || null
      }

      spindle.sendToFrontend({ type: 'active_char_resolved', characterId: charId }, userId)
    } catch (err: any) {
      spindle.log.error(`Resolve active char error: ${err?.message || err}`)
      spindle.sendToFrontend({ type: 'active_char_resolved', characterId: null }, userId)
    }
  }

  // ------------------------------------------------------------------
  // SAVE VERSION
  // ------------------------------------------------------------------
  else if (payload.type === 'save_version') {
    if (!spindle.permissions.has('characters')) {
      sendError('Characters permission is required to save versions.')
      return
    }
    try {
      const char = await spindle.characters.get(payload.characterId, { userId })
      if (!char) { sendError('Character not found'); return }

      // Build a clean variants map — only real arrays, no undefined values
      const existingRewriter = char.extensions?.['char_rewriter']
      const variants: Record<string, string[]> = {}

      if (existingRewriter?.variants && typeof existingRewriter.variants === 'object') {
        for (const [key, val] of Object.entries(existingRewriter.variants)) {
          if (Array.isArray(val)) {
            variants[key] = val.filter((v): v is string => typeof v === 'string')
          }
        }
      }

      if (!variants[payload.category]) variants[payload.category] = []
      if (variants[payload.category].length === 0 || variants[payload.category][variants[payload.category].length - 1] !== payload.text) {
        variants[payload.category].push(payload.text)
      }

      // Sanitize the full extensions object so no undefined survives
      const cleanExtensions = sanitize(char.extensions)
      cleanExtensions['char_rewriter'] = { variants }

      await spindle.characters.update(payload.characterId, {
        extensions: cleanExtensions
      }, { userId })

      spindle.sendToFrontend({
        type: 'version_saved',
        characterId: payload.characterId,
        category: payload.category,
        variants: variants[payload.category]
      }, userId)
    } catch (err: any) {
      spindle.log.error(`Save version error: ${err?.message || err}`)
      sendError(`Failed to save version: ${err?.message || err}`)
    }
  }

  // ------------------------------------------------------------------
  // DELETE VERSION
  // ------------------------------------------------------------------
  else if (payload.type === 'delete_version') {
    if (!spindle.permissions.has('characters')) {
      sendError('Characters permission is required to delete versions.')
      return
    }
    try {
      const char = await spindle.characters.get(payload.characterId, { userId })
      if (!char) { sendError('Character not found'); return }

      const cleanExtensions = sanitize(char.extensions)
      const rewriter = cleanExtensions['char_rewriter'] || { variants: {} }
      if (!rewriter.variants) rewriter.variants = {}

      if (Array.isArray(rewriter.variants[payload.category])) {
        rewriter.variants[payload.category].splice(payload.index, 1)
        cleanExtensions['char_rewriter'] = rewriter

        await spindle.characters.update(payload.characterId, {
          extensions: cleanExtensions
        }, { userId })
      }

      spindle.sendToFrontend({
        type: 'version_deleted',
        characterId: payload.characterId,
        category: payload.category,
        variants: rewriter.variants?.[payload.category] || []
      }, userId)
    } catch (err: any) {
      spindle.log.error(`Delete version error: ${err?.message || err}`)
      sendError(`Failed to delete version: ${err?.message || err}`)
    }
  }

  // ------------------------------------------------------------------
  // APPLY VERSION
  // ------------------------------------------------------------------
  else if (payload.type === 'apply_version') {
    if (!spindle.permissions.has('characters')) {
      sendError('Characters permission is required to apply versions.')
      return
    }
    try {
      let updatePayload: any = {}

      if (payload.category.startsWith('alt_greeting_')) {
        const char = await spindle.characters.get(payload.characterId, { userId })
        if (!char) { sendError('Character not found'); return }

        // Ensure a dense string array — no undefined holes, no nulls
        const altGreetings: string[] = (char.alternate_greetings || [])
          .map((g: any) => (typeof g === 'string' ? g : ''))

        const idx = parseInt(payload.category.replace('alt_greeting_', ''), 10)
        while (altGreetings.length < idx) {
          altGreetings.push('')
        }
        altGreetings[idx] = payload.text
        updatePayload = { alternate_greetings: altGreetings }
      } else {
        updatePayload = { [payload.category]: payload.text }
      }

      await spindle.characters.update(payload.characterId, updatePayload, { userId })

      spindle.sendToFrontend({
        type: 'version_applied',
        characterId: payload.characterId,
        category: payload.category
      }, userId)
    } catch (err: any) {
      spindle.log.error(`Apply version error: ${err?.message || err}`)
      sendError(`Failed to apply version: ${err?.message || err}`)
    }
  }

  // ------------------------------------------------------------------
  // GENERATION
  // ------------------------------------------------------------------
  else if (payload.type === 'generate') {
    if (!spindle.permissions.has('generation')) {
      spindle.toast.error("Generation permission required.")
      spindle.sendToFrontend({ type: 'generate_failed' }, userId)
      return
    }

    const controller = new AbortController()
    activeGenerations.set(userId, controller)

    try {
      const prompts = await spindle.userStorage.getJson('prompts.json', { fallback: DEFAULT_PROMPTS, userId })
      const promptCat = payload.category.startsWith('alt_greeting_') ? 'first_mes' : payload.category
      const sysPrompt = `${prompts.base}\n\nCategory guidance:\n${prompts[promptCat] || ""}`

      for await (const chunk of (spindle.generate.quietStream as any)({
        messages: [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: `Original Text:\n${payload.originalText}` }
        ],
        signal: controller.signal,
        userId
      })) {
        if (chunk.type === 'token') {
          spindle.sendToFrontend({ type: 'generate_token', token: chunk.token }, userId)
        } else if (chunk.type === 'done') {
          spindle.sendToFrontend({ type: 'generate_done', result: chunk.content }, userId)
        }
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        spindle.sendToFrontend({ type: 'generate_cancelled' }, userId)
      } else {
        spindle.toast.error(`Generation failed: ${err.message}`)
        spindle.sendToFrontend({ type: 'generate_failed', error: err?.message || String(err) }, userId)
      }
    } finally {
      activeGenerations.delete(userId)
    }
  }

  else if (payload.type === 'generate_cancel') {
    const controller = activeGenerations.get(userId)
    if (controller) controller.abort()
  }
})
