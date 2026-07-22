declare const spindle: import('lumiverse-spindle-types').SpindleAPI

const DEFAULT_PROMPTS = {
  base: "You are an expert creative writer and character designer. Rewrite the following character aspect to be more detailed, engaging, and well-written. Do not add commentary, output only the rewritten text.",
  description: "Focus on physical appearance, background, and general vibe.",
  personality: "Focus on traits, quirks, likes, dislikes, and psychological profile.",
  scenario: "Focus on setting the scene and world-building.",
  first_mes: "Focus on setting a strong hook, descriptive actions, and an engaging opening dialogue.",
  mes_example: "Format as dialogue history. Focus on capturing the exact speech patterns, tone, and formatting of the character."
}

// Recursive helper to fetch EVERY character card - explicitly threads userId to prevent operator-scoped errors [2.1.2]
async function fetchAllCharacters(userId: string): Promise<any[]> {
  const allChars: any[] = []
  let offset = 0
  const limit = 200
  let hasMore = true

  while (hasMore) {
    const chars = await spindle.characters.list({ limit, offset, userId }, userId)
    if (!chars || !chars.data) break
    
    allChars.push(...chars.data)
    
    // Stop if we received fewer items than the limit, or have retrieved all of them [2.1.1]
    if (chars.data.length < limit || allChars.length >= (chars.total || 0)) {
      hasMore = false
    } else {
      offset += limit
    }
  }
  return allChars
}

// Safely gather data after validating permissions
async function checkAndSendInitData(userId: string, routeType?: string | null, routeId?: string | null) {
  const hasCharacters = spindle.permissions.has('characters')
  const hasGeneration = spindle.permissions.has('generation')
  const hasChats = spindle.permissions.has('chats')

  if (!hasCharacters || !hasGeneration) {
    spindle.sendToFrontend({ type: 'permission_status', hasCharacters, hasGeneration }, userId)
    return
  }

  try {
    // 1. Fetch ALL character cards using our recursive paginator with explicit userId [2.1.2]
    const charsData = await fetchAllCharacters(userId)
    const prompts = await spindle.userStorage.getJson('prompts.json', { fallback: DEFAULT_PROMPTS, userId })
    
    // 2. Smart auto-detect active character based on what you are looking at [2.1.2, 2.3.1]
    let activeCharId = null
    if (routeType === 'characters' && routeId) {
      activeCharId = routeId // You are on a character card page
    } else if (routeType === 'chat' && routeId && hasChats) {
      try {
        const chat = await spindle.chats.get(routeId, userId)
        if (chat) activeCharId = chat.character_id // You are in a specific chat
      } catch (err: any) {
        spindle.log.error(`Auto-detect chat error: ${err.message}`)
      }
    }
    
    // Fallback to active chat if permission is granted [2.3.1, 2.4.1]
    if (!activeCharId && hasChats) {
      try {
        const activeChat = await spindle.chats.getActive(userId)
        if (activeChat) activeCharId = activeChat.character_id
      } catch (err: any) {
        spindle.log.error(`Auto-detect active chat error: ${err.message}`)
      }
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
    try {
      const char = await spindle.characters.get(payload.characterId, userId)
      if (char) {
        let text = ""
        if (payload.category.startsWith('alt_greeting_')) {
          const idx = parseInt(payload.category.replace('alt_greeting_', ''), 10)
          text = (char.alternate_greetings || [])[idx] || ""
        } else {
          text = char[payload.category as keyof typeof char] || ""
        }

        // Fetch variants stored in the extensions blob [2.2.5]
        const extData = char.extensions?.['char_rewriter'] || {}
        const variants = extData.variants?.[payload.category] || []

        spindle.sendToFrontend({ type: 'char_text_result', text, variants }, userId)
      }
    } catch (err: any) {
      spindle.log.error(`Text fetch error: ${err.message}`)
    }
  }

  else if (payload.type === 'save_prompts') {
    try {
      await spindle.userStorage.setJson('prompts.json', payload.prompts, { userId })
      spindle.toast.success("Instructions updated!", { userId } as any)
      spindle.sendToFrontend({ type: 'prompts_updated', prompts: payload.prompts }, userId)
    } catch (err: any) {}
  }

  else if (payload.type === 'generate') {
    if (!spindle.permissions.has('generation')) {
      spindle.toast.error("Generation permission required.", { userId } as any)
      spindle.sendToFrontend({ type: 'generate_failed' }, userId)
      return
    }
    try {
      const prompts = await spindle.userStorage.getJson('prompts.json', { fallback: DEFAULT_PROMPTS, userId })
      const promptCat = payload.category.startsWith('alt_greeting_') ? 'first_mes' : payload.category
      const sysPrompt = `${prompts.base}\n\nCategory guidance:\n${prompts[promptCat] || ""}`

      spindle.toast.info("AI is rewriting...", { userId } as any)
      
      const result = await spindle.generate.quiet({
        messages: [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: `Original Text:\n${payload.originalText}` }
        ],
        userId
      } as any, userId) 

      spindle.sendToFrontend({ type: 'generate_result', result: result.content }, userId)
    } catch (err: any) {
      spindle.toast.error(`Generation failed: ${err.message}`, { userId } as any)
      spindle.sendToFrontend({ type: 'generate_failed' }, userId)
    }
  }

  // Save a new draft version to history
  else if (payload.type === 'save_version') {
    if (!spindle.permissions.has('characters')) return
    try {
      const char = await spindle.characters.get(payload.characterId, userId)
      if (!char) throw new Error("Character not found")

      const extData = char.extensions?.['char_rewriter'] || { variants: {} }
      if (!extData.variants) extData.variants = {}
      if (!extData.variants[payload.category]) extData.variants[payload.category] = []
      
      // Prevent saving identical duplicates sequentially
      const currentList = extData.variants[payload.category]
      if (currentList[currentList.length - 1] !== payload.text) {
        extData.variants[payload.category].push(payload.text)
        await spindle.characters.update(payload.characterId, {
          extensions: { 'char_rewriter': extData }
        }, userId)
        spindle.toast.success("Saved to draft history!", { userId } as any)
      } else {
        spindle.toast.info("This exact version is already saved.", { userId } as any)
      }

      spindle.sendToFrontend({ type: 'save_version_success', variants: extData.variants[payload.category] }, userId)
    } catch (err: any) {
      spindle.log.error(`Save version error: ${err.message}`)
    }
  }

  // Delete a saved draft from history
  else if (payload.type === 'delete_version') {
    if (!spindle.permissions.has('characters')) return
    try {
      const char = await spindle.characters.get(payload.characterId, userId)
      if (!char) throw new Error("Character not found")

      const extData = char.extensions?.['char_rewriter'] || { variants: {} }
      if (extData.variants?.[payload.category]) {
        extData.variants[payload.category].splice(payload.index, 1)
        await spindle.characters.update(payload.characterId, {
          extensions: { 'char_rewriter': extData }
        }, userId)
        spindle.toast.success("Draft version deleted.", { userId } as any)
      }

      const updatedList = extData.variants?.[payload.category] || []
      spindle.sendToFrontend({ type: 'save_version_success', variants: updatedList }, userId)
    } catch (err: any) {
      spindle.log.error(`Delete version error: ${err.message}`)
    }
  }

  // Apply a selected version to overwrite the actual active card field
  else if (payload.type === 'apply_version') {
    if (!spindle.permissions.has('characters')) return
    try {
      let updatePayload: any = {}
      const char = await spindle.characters.get(payload.characterId, userId)
      if (!char) throw new Error("Character not found")

      if (payload.category.startsWith('alt_greeting_')) {
        const altGreetings = [...(char.alternate_greetings || [])]
        const idx = parseInt(payload.category.replace('alt_greeting_', ''), 10)
        altGreetings[idx] = payload.text
        updatePayload = { alternate_greetings: altGreetings }
      } else {
        updatePayload = { [payload.category]: payload.text }
      }

      await spindle.characters.update(payload.characterId, updatePayload, userId)
      spindle.toast.success("Card updated successfully!", { userId } as any)
      spindle.sendToFrontend({ type: 'apply_success', text: payload.text }, userId)
    } catch (err: any) {
      spindle.log.error(`Apply error: ${err.message}`)
    }
  }
})
