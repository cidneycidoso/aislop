declare const spindle: import('lumiverse-spindle-types').SpindleAPI

const DEFAULT_PROMPTS = {
  base: "You are an expert creative writer and character designer. Rewrite the following character aspect to be more detailed, engaging, and well-written. Do not add commentary, output only the rewritten text.",
  description: "Focus on physical appearance, background, and general vibe.",
  personality: "Focus on traits, quirks, likes, dislikes, and psychological profile.",
  scenario: "Focus on setting the scene and world-building.",
  first_mes: "Focus on setting a strong hook, descriptive actions, and an engaging opening dialogue."
}

// Recursive helper to fetch EVERY character card by paging through the database [2.1.2]
async function fetchAllCharacters(userId: string): Promise<any[]> {
  const allChars: any[] = []
  let offset = 0
  const limit = 200
  let hasMore = true

  while (hasMore) {
    const chars = await spindle.characters.list({ limit, offset, userId }, userId)
    if (!chars || !chars.data) break
    
    allChars.push(...chars.data)
    
    // Stop if we received fewer items than the limit, or have retrieved all of them [2.1.2]
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
    // 1. Fetch ALL character cards using our recursive paginator [2.1.2]
    const charsData = await fetchAllCharacters(userId)
    const prompts = await spindle.userStorage.getJson('prompts.json', { fallback: DEFAULT_PROMPTS, userId })
    
    // 2. Smart auto-detect active character based on what you are looking at
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
    
    // Fallback to active chat if permission is granted [2.4.1]
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
        spindle.sendToFrontend({
          type: 'char_text_result',
          text: char[payload.category as keyof typeof char] || ""
        }, userId)
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
    } catch (err: any) {
      spindle.log.error(`Save error: ${err.message}`)
    }
  }

  else if (payload.type === 'generate') {
    if (!spindle.permissions.has('generation')) {
      spindle.toast.error("Generation permission required.", { userId } as any)
      spindle.sendToFrontend({ type: 'generate_failed' }, userId)
      return
    }
    try {
      const prompts = await spindle.userStorage.getJson('prompts.json', { fallback: DEFAULT_PROMPTS, userId })
      const sysPrompt = `${prompts.base}\n\nCategory guidance:\n${prompts[payload.category] || ""}`

      spindle.toast.info("AI is rewriting...", { userId } as any)
      
      const result = await spindle.generate.quiet({
        messages: [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: `Original Text:\n${payload.originalText}` }
        ],
        userId: userId // pass inside request in case of DTO validation
      } as any, userId) // pass as final argument [2.1.2]

      spindle.sendToFrontend({ type: 'generate_result', result: result.content }, userId)
    } catch (err: any) {
      spindle.toast.error(`Generation failed: ${err.message}`, { userId } as any)
      spindle.sendToFrontend({ type: 'generate_failed' }, userId)
    }
  }

  else if (payload.type === 'apply') {
    if (!spindle.permissions.has('characters')) return
    try {
      await spindle.characters.update(payload.characterId, { 
        [payload.category]: payload.newText 
      }, userId)
      spindle.toast.success("Character updated successfully!", { userId } as any)
    } catch (err: any) {
      spindle.log.error(`Apply error: ${err.message}`)
    }
  }
})
