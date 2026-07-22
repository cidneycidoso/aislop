declare const spindle: import('lumiverse-spindle-types').SpindleAPI

const DEFAULT_PROMPTS = {
  base: "You are an expert creative writer and character designer. Rewrite the following character aspect to be more detailed, engaging, and well-written. Do not add commentary, output only the rewritten text.",
  description: "Focus on physical appearance, background, and general vibe.",
  personality: "Focus on traits, quirks, likes, dislikes, and psychological profile.",
  scenario: "Focus on setting the scene and world-building.",
  first_mes: "Focus on setting a strong hook, descriptive actions, and an engaging opening dialogue.",
  mes_example: "Format as dialogue history. Focus on capturing the exact speech patterns, tone, and formatting of the character."
}

// Per the public docs, spindle.characters.* should resolve the calling user
// from the extension/request context automatically, even on operator-scoped
// installs — unlike spindle.userStorage, which needs userId passed explicitly.
// In practice, on some operator-scoped installs that auto-resolution doesn't
// kick in (this looks tied to the newer default "process mode" backend
// runtime) and the host throws "userId is required for operator-scoped
// operations" from inside characters.list/get itself.
// JS ignores properties/arguments a function doesn't declare, so it's safe to
// pass userId defensively here even though it's not in the documented type —
// if the host does respect it, this fixes the crash; if not, it's a no-op.
async function fetchAllCharacters(userId: string): Promise<any[]> {
  const allChars: any[] = []
  let offset = 0
  const limit = 200
  let hasMore = true

  while (hasMore) {
    const chars = await (spindle.characters.list as any)({ limit, offset, userId })
    if (!chars || !chars.data) break
    
    allChars.push(...chars.data)
    
    if (chars.data.length < limit || allChars.length >= (chars.total || 0)) {
      hasMore = false
    } else {
      offset += limit
    }
  }
  return allChars
}

async function checkAndSendInitData(userId: string, routeType?: string | null, routeId?: string | null) {
  // Everything below — including the permission reads — now lives inside this
  // try/catch. Previously the permissions.has() calls sat *outside* the try,
  // so if any of them threw (e.g. a transient permission-cache issue on this
  // operator-scoped install, or the "userId is required for operator-scoped
  // operations" error some hosts throw when they can't resolve the calling
  // user), the whole function rejected silently: no init_data, no init_error,
  // nothing — the frontend just sat on "Loading characters..." forever.
  // Now, whatever goes wrong, the frontend always gets *some* response.
  try {
    const hasCharacters = spindle.permissions.has('characters')
    const hasGeneration = spindle.permissions.has('generation')
    const hasChats = spindle.permissions.has('chats')

    if (!hasCharacters || !hasGeneration) {
      spindle.sendToFrontend({ type: 'permission_status', hasCharacters, hasGeneration }, userId)
      return
    }

    const charsData = await fetchAllCharacters(userId)

    // Explicit userId is required for userStorage on operator-scoped installs.
    const prompts = await spindle.userStorage.getJson('prompts.json', { fallback: DEFAULT_PROMPTS, userId })

    let activeCharId = null
    if (routeType === 'characters' && routeId) {
      activeCharId = routeId
    } else if (routeType === 'chat' && routeId && hasChats) {
      try {
        const chat = await (spindle.chats.get as any)(routeId, userId)
        if (chat) activeCharId = chat.character_id
      } catch (err: any) {
        spindle.log.error(`Chat lookup error: ${err.message}`)
      }
    }

    if (!activeCharId && hasChats) {
      try {
        const activeChat = await (spindle.chats.getActive as any)(userId)
        if (activeChat) activeCharId = activeChat.character_id
      } catch (err: any) {
        spindle.log.error(`Active chat lookup error: ${err.message}`)
      }
    }

    spindle.sendToFrontend({
      type: 'init_data',
      chars: charsData,
      prompts,
      activeCharId
    }, userId) // userId required to target the correct browser connection

  } catch (err: any) {
    spindle.log.error(`Init error: ${err?.message || err}`)
    try {
      spindle.sendToFrontend({ type: 'init_error', error: err?.message || String(err) }, userId)
    } catch (sendErr: any) {
      // If we can't even reach this user's frontend, log it — there's nothing
      // more we can do, but at least it's visible in the server console
      // instead of a silent hang.
      spindle.log.error(`Failed to notify frontend of init error: ${sendErr?.message || sendErr}`)
    }
  }
}

spindle.onFrontendMessage(async (payload: any, userId: string) => {
  if (payload.type === 'get_init_data') {
    await checkAndSendInitData(userId, payload.routeType, payload.routeId)
  }

  else if (payload.type === 'get_char_text') {
    if (!spindle.permissions.has('characters')) {
      spindle.sendToFrontend({ type: 'char_text_error', error: 'Characters permission not granted.' }, userId)
      return
    }
    try {
      const char = await (spindle.characters.get as any)(payload.characterId, userId)
      if (char) {
        let text = ""
        if (payload.category.startsWith('alt_greeting_')) {
          const idx = parseInt(payload.category.replace('alt_greeting_', ''), 10)
          text = (char.alternate_greetings || [])[idx] || ""
        } else {
          text = char[payload.category as keyof typeof char] || ""
        }

        const extData = char.extensions?.['char_rewriter'] || {}
        const variants = extData.variants?.[payload.category] || []

        spindle.sendToFrontend({ type: 'char_text_result', text, variants }, userId)
      } else {
        // Character not found — still respond, or the frontend spins forever.
        spindle.sendToFrontend({ type: 'char_text_error', error: 'Character not found.' }, userId)
      }
    } catch (err: any) {
      spindle.log.error(`Text fetch error: ${err.message}`)
      spindle.sendToFrontend({ type: 'char_text_error', error: err?.message || String(err) }, userId)
    }
  }

  else if (payload.type === 'save_prompts') {
    try {
      // Explicit userId required here
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
      
      const result = await spindle.generate.quiet({
        messages: [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: `Original Text:\n${payload.originalText}` }
        ]
      }) 

      spindle.sendToFrontend({ type: 'generate_result', result: result.content }, userId)
    } catch (err: any) {
      spindle.toast.error(`Generation failed: ${err.message}`)
      spindle.sendToFrontend({ type: 'generate_failed' }, userId)
    }
  }

  else if (payload.type === 'save_version') {
    if (!spindle.permissions.has('characters')) return
    try {
      const char = await (spindle.characters.get as any)(payload.characterId, userId)
      if (!char) throw new Error("Character not found")

      const extData = char.extensions?.['char_rewriter'] || { variants: {} }
      if (!extData.variants) extData.variants = {}
      if (!extData.variants[payload.category]) extData.variants[payload.category] = []
      
      const currentList = extData.variants[payload.category]
      if (currentList.length === 0 || currentList[currentList.length - 1] !== payload.text) {
        extData.variants[payload.category].push(payload.text)
        
        await (spindle.characters.update as any)(payload.characterId, {
          extensions: { 'char_rewriter': extData }
        }, userId)
        spindle.toast.success("Saved to draft history!")
      } else {
        spindle.toast.info("This exact version is already saved.")
      }

      spindle.sendToFrontend({ type: 'save_version_success', variants: extData.variants[payload.category] }, userId)
    } catch (err: any) {
      spindle.log.error(`Save version error: ${err.message}`)
      spindle.toast.error(`Failed to save version: ${err.message}`)
    }
  }

  else if (payload.type === 'delete_version') {
    if (!spindle.permissions.has('characters')) return
    try {
      const char = await (spindle.characters.get as any)(payload.characterId, userId)
      if (!char) throw new Error("Character not found")

      const extData = char.extensions?.['char_rewriter'] || { variants: {} }
      if (extData.variants?.[payload.category]) {
        extData.variants[payload.category].splice(payload.index, 1)
        
        await (spindle.characters.update as any)(payload.characterId, {
          extensions: { 'char_rewriter': extData }
        }, userId)
        spindle.toast.success("Draft version deleted.")
      }

      const updatedList = extData.variants?.[payload.category] || []
      spindle.sendToFrontend({ type: 'save_version_success', variants: updatedList }, userId)
    } catch (err: any) {
      spindle.log.error(`Delete version error: ${err.message}`)
      spindle.toast.error(`Failed to delete version: ${err.message}`)
    }
  }

  else if (payload.type === 'apply_version') {
    if (!spindle.permissions.has('characters')) return
    try {
      let updatePayload: any = {}
      const char = await (spindle.characters.get as any)(payload.characterId, userId)
      if (!char) throw new Error("Character not found")

      if (payload.category.startsWith('alt_greeting_')) {
        const altGreetings = [...(char.alternate_greetings || [])]
        const idx = parseInt(payload.category.replace('alt_greeting_', ''), 10)
        altGreetings[idx] = payload.text
        updatePayload = { alternate_greetings: altGreetings }
      } else {
        updatePayload = { [payload.category]: payload.text }
      }

      await (spindle.characters.update as any)(payload.characterId, updatePayload, userId)
      spindle.toast.success("Card updated successfully!")
      spindle.sendToFrontend({ type: 'apply_success', text: payload.text }, userId)
    } catch (err: any) {
      spindle.log.error(`Apply error: ${err.message}`)
      spindle.toast.error(`Failed to apply to card: ${err.message}`)
    }
  }
})
