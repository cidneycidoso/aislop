declare const spindle: import('lumiverse-spindle-types').SpindleAPI

const DEFAULT_PROMPTS = {
  base: "You are an expert creative writer and character designer. Rewrite the following character aspect to be more detailed, engaging, and well-written. Do not add commentary, output only the rewritten text.",
  description: "Focus on physical appearance, background, and general vibe.",
  personality: "Focus on traits, quirks, likes, dislikes, and psychological profile.",
  scenario: "Focus on setting the scene and world-building.",
  first_mes: "Focus on setting a strong hook, descriptive actions, and an engaging opening dialogue.",
  mes_example: "Format as dialogue history. Focus on capturing the exact speech patterns, tone, and formatting of the character."
}

// ------------------------------------------------------------------
// SAFE RPC WRAPPER: Prevents UI hangs if an endpoint drops out
// ------------------------------------------------------------------
const withTimeout = <T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> => {
  return new Promise((resolve) => {
    let done = false
    const timer = setTimeout(() => {
      if (!done) { done = true; resolve(fallback) }
    }, ms)
    promise.then(res => {
      if (!done) { done = true; clearTimeout(timer); resolve(res) }
    }).catch(err => {
      if (!done) { done = true; clearTimeout(timer); resolve(fallback) }
    })
  })
}

// ------------------------------------------------------------------

async function fetchAllCharacters(): Promise<any[]> {
  const allChars: any[] = []
  let offset = 0
  const limit = 200 // MUST NOT EXCEED 200 (Zod schema strict limit)
  let hasMore = true

  while (hasMore) {
    // 1.1.0: Characters API natively resolves context. DO NOT pass userId.
    const chars = await withTimeout(spindle.characters.list({ limit, offset }), 5000, null)
    
    if (!chars || !chars.data || chars.data.length === 0) break
    
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
  try {
    const hasCharacters = spindle.permissions.has('characters')
    const hasGeneration = spindle.permissions.has('generation')
    const hasChats = spindle.permissions.has('chats')

    if (!hasCharacters || !hasGeneration) {
      spindle.sendToFrontend({ type: 'permission_status', hasCharacters, hasGeneration }, userId)
      return
    }

    const charsData = await fetchAllCharacters()
    
    // UserStorage explicitly requires userId inside its options object
    const prompts = await withTimeout(
      spindle.userStorage.getJson('prompts.json', { fallback: DEFAULT_PROMPTS, userId }), 
      2000, 
      DEFAULT_PROMPTS
    )
    
    let activeCharId = null
    if (routeType === 'characters' && routeId) {
      activeCharId = routeId
    } else if (routeType === 'chat' && routeId && hasChats) {
      // Chats API requires userId as a trailing argument
      const chat = await withTimeout((spindle.chats.get as any)(routeId, userId), 2000, null)
      if (chat) activeCharId = chat.character_id 
    }
    
    if (!activeCharId && hasChats) {
      // Active Chat requires userId as a trailing argument
      const activeChat = await withTimeout((spindle.chats.getActive as any)(userId), 2000, null)
      if (activeChat) activeCharId = activeChat.character_id
    }
    
    spindle.sendToFrontend({ 
      type: 'init_data', 
      chars: charsData, 
      prompts,
      activeCharId
    }, userId)
    
  } catch (err: any) {
    spindle.log.error(`Init error: ${err.message}`)
    spindle.sendToFrontend({ type: 'init_error', error: err.message }, userId)
  }
}

spindle.onFrontendMessage(async (payload: any, userId: string) => {
  if (payload.type === 'get_init_data') {
    await checkAndSendInitData(userId, payload.routeType, payload.routeId)
  }

  else if (payload.type === 'get_char_text') {
    if (!spindle.permissions.has('characters')) return
    
    const char = await withTimeout(spindle.characters.get(payload.characterId), 3000, null)
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
    }
  }

  else if (payload.type === 'save_prompts') {
    await withTimeout(spindle.userStorage.setJson('prompts.json', payload.prompts, { userId }), 2000, null)
    spindle.toast.success("Instructions updated!")
    spindle.sendToFrontend({ type: 'prompts_updated', prompts: payload.prompts }, userId)
  }

  else if (payload.type === 'generate') {
    if (!spindle.permissions.has('generation')) {
      spindle.toast.error("Generation permission required.")
      spindle.sendToFrontend({ type: 'generate_failed' }, userId)
      return
    }
    
    const prompts = await withTimeout(
      spindle.userStorage.getJson('prompts.json', { fallback: DEFAULT_PROMPTS, userId }), 
      2000, 
      DEFAULT_PROMPTS
    )
    const promptCat = payload.category.startsWith('alt_greeting_') ? 'first_mes' : payload.category
    const sysPrompt = `${prompts.base}\n\nCategory guidance:\n${prompts[promptCat] || ""}`

    spindle.toast.info("AI is rewriting...")
    
    // Generate endpoints require userId as a trailing argument
    const result = await withTimeout((spindle.generate.quiet as any)({
      messages: [
        { role: 'system', content: sysPrompt },
        { role: 'user', content: `Original Text:\n${payload.originalText}` }
      ]
    }, userId), 60000, null) // 60s timeout for LLM

    if (result) {
      const genText = result.text || result.content || ""
      spindle.sendToFrontend({ type: 'generate_result', result: genText }, userId)
    } else {
      spindle.toast.error(`Generation failed or timed out.`)
      spindle.sendToFrontend({ type: 'generate_failed' }, userId)
    }
  }

  else if (payload.type === 'save_version') {
    if (!spindle.permissions.has('characters')) return
    const char = await withTimeout(spindle.characters.get(payload.characterId), 2000, null)
    if (!char) return

    const extData = char.extensions?.['char_rewriter'] || { variants: {} }
    if (!extData.variants) extData.variants = {}
    if (!extData.variants[payload.category]) extData.variants[payload.category] = []
    
    const currentList = extData.variants[payload.category]
    if (currentList.length === 0 || currentList[currentList.length - 1] !== payload.text) {
      extData.variants[payload.category].push(payload.text)
      
      await withTimeout(spindle.characters.update(payload.characterId, {
        extensions: { 'char_rewriter': extData }
      }), 2000, null)
      
      spindle.toast.success("Saved to draft history!")
    } else {
      spindle.toast.info("This exact version is already saved.")
    }

    spindle.sendToFrontend({ type: 'save_version_success', variants: extData.variants[payload.category] }, userId)
  }

  else if (payload.type === 'delete_version') {
    if (!spindle.permissions.has('characters')) return
    const char = await withTimeout(spindle.characters.get(payload.characterId), 2000, null)
    if (!char) return

    const extData = char.extensions?.['char_rewriter'] || { variants: {} }
    if (extData.variants?.[payload.category]) {
      extData.variants[payload.category].splice(payload.index, 1)
      
      await withTimeout(spindle.characters.update(payload.characterId, {
        extensions: { 'char_rewriter': extData }
      }), 2000, null)
      
      spindle.toast.success("Draft version deleted.")
    }

    const updatedList = extData.variants?.[payload.category] || []
    spindle.sendToFrontend({ type: 'save_version_success', variants: updatedList }, userId)
  }

  else if (payload.type === 'apply_version') {
    if (!spindle.permissions.has('characters')) return
    const char = await withTimeout(spindle.characters.get(payload.characterId), 2000, null)
    if (!char) return

    let updatePayload: any = {}
    if (payload.category.startsWith('alt_greeting_')) {
      const altGreetings = [...(char.alternate_greetings || [])]
      const idx = parseInt(payload.category.replace('alt_greeting_', ''), 10)
      altGreetings[idx] = payload.text
      updatePayload = { alternate_greetings: altGreetings }
    } else {
      updatePayload = { [payload.category]: payload.text }
    }

    await withTimeout(spindle.characters.update(payload.characterId, updatePayload), 2000, null)
    
    spindle.toast.success("Card updated successfully!")
    spindle.sendToFrontend({ type: 'apply_success', text: payload.text }, userId)
  }
})
