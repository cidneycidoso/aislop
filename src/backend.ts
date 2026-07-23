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

/** Helper to conditionally return `{ userId }` options only if `userId` is a valid string. */
function getOpts(userId?: string): { userId?: string } {
  return typeof userId === 'string' && userId.length > 0 ? { userId } : {}
}

/** Deep-clone and strip any `undefined` values (serde_v8 rejects them). */
function sanitize<T>(obj: T): T {
  try {
    return JSON.parse(JSON.stringify(obj ?? {}))
  } catch {
    return {} as T
  }
}

/** Ensure a value is a dense string array with no nulls/undefineds. */
function toStringArray(arr: unknown): string[] {
  if (typeof arr === 'string') {
    try { arr = JSON.parse(arr) } catch { return [] }
  }
  if (!Array.isArray(arr)) return []
  return arr.map((v) => (typeof v === 'string' ? v : ''))
}

spindle.onFrontendMessage(async (payload: any, userId?: string) => {
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
      const prompts = await spindle.userStorage.getJson('prompts.json', { fallback: DEFAULT_PROMPTS, ...getOpts(userId) })
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
      await spindle.userStorage.setJson('prompts.json', payload.prompts, getOpts(userId))
      spindle.toast.success("Instructions updated!")
      spindle.sendToFrontend({ type: 'prompts_updated', prompts: payload.prompts }, userId)
    } catch (err: any) {
      spindle.log.error(`Save prompts error: ${err?.message || err}`)
      spindle.toast.error(`Failed to save instructions: ${err?.message || err}`)
    }
  }

  // ------------------------------------------------------------------
  // CHARACTERS
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
        const { data, total } = await spindle.characters.list({ limit, offset, ...getOpts(userId) })
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

      if (payload.routeType === 'characters' && typeof payload.routeId === 'string' && payload.routeId) {
        charId = payload.routeId
      } else if (payload.routeType === 'chat' && typeof payload.routeId === 'string' && payload.routeId && spindle.permissions.has('chats')) {
        const chat = await spindle.chats.get(payload.routeId, getOpts(userId))
        charId = chat?.character_id || null
      }

      if (!charId && spindle.permissions.has('chats')) {
        const activeChat = await spindle.chats.getActive(getOpts(userId))
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
    if (!payload?.characterId || typeof payload.characterId !== 'string') {
      sendError('Valid Character ID is required.')
      return
    }
    if (!payload?.category || typeof payload.category !== 'string') {
      sendError('Category is required.')
      return
    }

    try {
      const char = await spindle.characters.get(payload.characterId, getOpts(userId))
      if (!char) { sendError('Character not found'); return }

      const text = typeof payload.text === 'string' ? payload.text : String(payload.text ?? '')
      
      let rawExtensions: Record<string, any> = {}
      if (typeof char.extensions === 'string') {
        try { rawExtensions = JSON.parse(char.extensions) } catch { rawExtensions = {} }
      } else if (typeof char.extensions === 'object' && char.extensions !== null) {
        rawExtensions = char.extensions
      }

      const existingRewriter = rawExtensions['char_rewriter']
      const variants: Record<string, string[]> = {}

      if (existingRewriter?.variants && typeof existingRewriter.variants === 'object') {
        for (const [key, val] of Object.entries(existingRewriter.variants)) {
          if (Array.isArray(val)) {
            variants[key] = toStringArray(val)
          }
        }
      }

      if (!variants[payload.category]) variants[payload.category] = []
      if (variants[payload.category].length === 0 || variants[payload.category][variants[payload.category].length - 1] !== text) {
        variants[payload.category].push(text)
      }

      const extensionsObj = sanitize({ ...rawExtensions, char_rewriter: { variants } })
      // Must be serialized to string so SQLite database accepts it as a JSON payload
      const extensionsStr = JSON.stringify(extensionsObj)

      await spindle.characters.update(payload.characterId, { extensions: extensionsStr }, getOpts(userId))

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
    if (!payload?.characterId || typeof payload.characterId !== 'string') {
      sendError('Valid Character ID is required.')
      return
    }
    if (!payload?.category || typeof payload.category !== 'string') {
      sendError('Category is required.')
      return
    }

    try {
      const char = await spindle.characters.get(payload.characterId, getOpts(userId))
      if (!char) { sendError('Character not found'); return }

      let rawExtensions: Record<string, any> = {}
      if (typeof char.extensions === 'string') {
        try { rawExtensions = JSON.parse(char.extensions) } catch { rawExtensions = {} }
      } else if (typeof char.extensions === 'object' && char.extensions !== null) {
        rawExtensions = char.extensions
      }

      const rewriter = rawExtensions['char_rewriter'] || { variants: {} }
      if (!rewriter.variants) rewriter.variants = {}

      if (Array.isArray(rewriter.variants[payload.category])) {
        rewriter.variants[payload.category].splice(payload.index, 1)
        rawExtensions['char_rewriter'] = rewriter

        // Must be serialized to string so SQLite database accepts it as a JSON payload
        const extensionsStr = JSON.stringify(rawExtensions)
        await spindle.characters.update(payload.characterId, { extensions: extensionsStr }, getOpts(userId))
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
    if (!payload?.characterId || typeof payload.characterId !== 'string') {
      sendError('Valid Character ID is required.')
      return
    }
    if (!payload?.category || typeof payload.category !== 'string') {
      sendError('Category is required.')
      return
    }

    try {
      const text = typeof payload.text === 'string' ? payload.text : String(payload.text ?? '')
      let updatePayload: any = {}

      if (payload.category.startsWith('alt_greeting_')) {
        const char = await spindle.characters.get(payload.characterId, getOpts(userId))
        if (!char) { sendError('Character not found'); return }

        const altGreetings = toStringArray(char.alternate_greetings)
        const idx = parseInt(payload.category.replace('alt_greeting_', ''), 10)

        while (altGreetings.length < idx) {
          altGreetings.push('')
        }
        altGreetings[idx] = text
        
        // JSON array must be stringified for SQLite
        updatePayload = { alternate_greetings: JSON.stringify(altGreetings) }
      } else {
        updatePayload = { [payload.category]: text }
      }

      await spindle.characters.update(payload.characterId, updatePayload, getOpts(userId))

      spindle.sendToFrontend({
        type: 'version_applied',
        characterId: payload.characterId,
        category: payload.category,
        text
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

    const key = userId || 'default'
    const controller = new AbortController()
    activeGenerations.set(key, controller)

    try {
      const prompts = await spindle.userStorage.getJson('prompts.json', { fallback: DEFAULT_PROMPTS, ...getOpts(userId) })
      const promptCat = payload.category?.startsWith('alt_greeting_') ? 'first_mes' : (payload.category || 'description')
      const sysPrompt = `${prompts.base || ""}\n\nCategory guidance:\n${prompts[promptCat] || ""}`

      const genPayload: any = {
        messages: [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: `Original Text:\n${payload.originalText || ""}` }
        ],
        signal: controller.signal
      }
      if (userId) genPayload.userId = userId

      for await (const chunk of (spindle.generate.quietStream as any)(genPayload)) {
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
        spindle.toast.error(`Generation failed: ${err?.message || err}`)
        spindle.sendToFrontend({ type: 'generate_failed', error: err?.message || String(err) }, userId)
      }
    } finally {
      activeGenerations.delete(key)
    }
  }

  else if (payload.type === 'generate_cancel') {
    const key = userId || 'default'
    const controller = activeGenerations.get(key)
    if (controller) controller.abort()
  }
})
