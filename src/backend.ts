declare const spindle: import('lumiverse-spindle-types').SpindleAPI

const DEFAULT_PROMPTS = {
  base: "You are an expert creative writer and character designer. Rewrite the following character aspect to be more detailed, engaging, and well-written. Do not add commentary, output only the rewritten text.",
  description: "Focus on physical appearance, background, and general vibe.",
  personality: "Focus on traits, quirks, likes, dislikes, and psychological profile.",
  scenario: "Focus on setting the scene and world-building.",
  first_mes: "Focus on setting a strong hook, descriptive actions, and an engaging opening dialogue.",
  mes_example: "Format as dialogue history. Focus on capturing the exact speech patterns, tone, and formatting of the character."
}

// Recursive helper to fetch EVERY character card - in 1.0, userId is resolved automatically from the context!
async function fetchAllCharacters(): Promise<any[]> {
  const allChars: any[] = []
  let offset = 0
  const limit = 200
  let hasMore = true

  while (hasMore) {
    const chars = await spindle.characters.list({ limit, offset })
    if (!chars || !chars.data) break
    
    allChars.push(...chars.data)
    
    // Stop if we received fewer items than the limit, or have retrieved all of them
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
    // 1. Fetch ALL character cards (no longer needs manual userId parameters in 1.0!)
    const charsData = await fetchAllCharacters()
    const prompts = await spindle.userStorage.getJson('prompts.json', { fallback: DEFAULT_PROMPTS, userId })
    
    // 2. Smart auto-detect active character based on what you are looking at
    let activeCharId = null
    if (routeType === 'characters' && routeId) {
      activeCharId = routeId // You are on a character card page
    } else if (routeType === 'chat' && routeId && hasChats) {
      try {
        const chat = await spindle.chats.get(routeId)
        if (chat) activeCharId = chat.character_id // You are in a specific chat
      } catch (err: any) {
        spindle.log.error(`Auto-detect chat error: ${err.message}`)
      }
    }
    
    // Fallback to active chat if permission is granted
    if (!activeCharId && hasChats) {
      try {
        const activeChat = await spindle.chats.getActive()
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
      const char = await spindle.characters.get(payload.characterId)
      if (char) {
        let text = ""
        if (payload.category.startsWith('alt_greeting_')) {
          const idx = parseInt(payload.category.replace('alt_greeting_', ''), 10)
          text = (char.alternate_greetings || [])[idx] || ""
        } else {
          text = char[payload.category as keyof typeof char] || ""
        }

        // Fetch variants stored in the extensions blob!
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
      spindle.toast.success("Instructions updated!") // no manual userId needed for toasts in 1.0!
      spindle.sendToFrontend({ type: 'prompts_updated', prompts: payload.prompts }, userId)
    } catch (err: any) {}
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
        // no manual userId inside the generation options needed anymore!
      }) 

      spindle.sendToFrontend({ type: 'generate_result', result: result.content }, userId)
    } catch (err: any) {
      spindle.toast.error(`Generation failed: ${err.message}`)
      spindle.sendToFrontend({ type: 'generate_failed' }, userId)
    }
  }

  else if (payload.type === 'apply') {
    if (!spindle.permissions.has('characters')) return
    try {
      let updatePayload: any = {}
      const char = await spindle.characters.get(payload.characterId)
      if (!char) throw new Error("Character not found")

      // --- SAVE AS VARIANT / ALTERNATE FIELD ---
      if (payload.saveAsNewVariant) {
        if (payload.category === 'first_mes' || payload.category.startsWith('alt_greeting_')) {
          const altGreetings = [...(char.alternate_greetings || [])]
          altGreetings.push(payload.newText)
          updatePayload = { alternate_greetings: altGreetings }
        } else {
          const extData = char.extensions?.['char_rewriter'] || { variants: {} }
          if (!extData.variants) extData.variants = {}
          if (!extData.variants[payload.category]) extData.variants[payload.category] = []
          
          extData.variants[payload.category].push(payload.newText)
          updatePayload = { extensions: { 'char_rewriter': extData } }
        }
      } 
      
      // --- STANDARD OVERWRITE ---
      else {
        if (payload.category.startsWith('alt_greeting_')) {
          const altGreetings = [...(char.alternate_greetings || [])]
          const idx = parseInt(payload.category.replace('alt_greeting_', ''), 10)
          altGreetings[idx] = payload.newText
          updatePayload = { alternate_greetings: altGreetings }
        } else {
          updatePayload = { [payload.category]: payload.newText }
        }
      }

      await spindle.characters.update(payload.characterId, updatePayload)
      spindle.toast.success(payload.saveAsNewVariant ? "Saved as new Variant!" : "Character updated successfully!")
      spindle.sendToFrontend({ type: 'apply_success', savedAsVariant: payload.saveAsNewVariant }, userId)
    } catch (err: any) {
      spindle.log.error(`Apply error: ${err.message}`)
    }
  }
})
