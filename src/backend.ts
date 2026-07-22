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
// SAFE RPC WRAPPER: Exposes exact failure points if an endpoint hangs
// ------------------------------------------------------------------
const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
  return new Promise((resolve, reject) => {
    let done = false
    const timer = setTimeout(() => {
      if (!done) { done = true; reject(new Error(`Timeout at ${label} after ${ms}ms`)) }
    }, ms)
    promise.then(res => {
      if (!done) { done = true; clearTimeout(timer); resolve(res) }
    }).catch(err => {
      if (!done) { done = true; clearTimeout(timer); reject(err) }
    })
  })
}

// ------------------------------------------------------------------

async function fetchAllCharacters(userId: string): Promise<any[]> {
  const allChars: any[] = []
  let offset = 0
  const limit = 200 
  let hasMore = true

  while (hasMore) {
    // 1. List APIs take options object. userId goes INSIDE the options bag.
    const chars = await withTimeout(
      (spindle.characters.list as any)({ limit, offset, userId }), 
      5000, 
      'characters.list'
    )
    
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

    const charsData = await fetchAllCharacters(userId)
    
    // 2. Storage APIs take options object. userId goes INSIDE the options bag.
    const prompts = await spindle.userStorage.getJson('prompts.json', { fallback: DEFAULT_PROMPTS, userId })
    
    let activeCharId = null
    if (routeType === 'characters' && routeId) {
      activeCharId = routeId
    } else if (routeType === 'chat' && routeId && hasChats) {
      try {
        // 3. Entity getters have no options bag. userId is a trailing STRING.
        const chat = await withTimeout((spindle.chats.get as any)(routeId, userId), 3000, 'chats.get')
        if (chat) activeCharId = chat.character_id 
      } catch (e) { spindle.log.warn(`chats.get failed: ${e}`) }
    }
    
    if (!activeCharId && hasChats) {
      try {
        // 3. Entity getters have no options bag. userId is a trailing STRING.
        const activeChat = await withTimeout((spindle.chats.getActive as any)(userId), 3000, 'chats.getActive')
        if (activeChat) activeCharId = activeChat.character_id
      } catch (e) { spindle.log.warn(`chats.getActive failed: ${e}`) }
    }
    
    spindle.sendToFrontend({ 
      type: 'init_data', 
      chars: charsData, 
      prompts,
      activeCharId
    }, userId)
    
  } catch (err: any) {
    spindle.log.error(`Init error: ${err.message}`)
    // This will vividly print exactly what failed to load directly on the extension UI
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
      // 3. Entity getters have no options bag. userId is a trailing STRING.
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
      }
    } catch (err: any) {
      spindle.log.error(`Text fetch error: ${err.message}`)
    }
  }

  else if (payload.type === 'save_prompts') {
    try {
      // 2. Storage APIs take options object. userId goes INSIDE the options bag.
      await spindle.userStorage.setJson('prompts.json', payload.prompts, { userId })
      spindle.toast.success("Instructions updated!")
      spindle.sendToFrontend({ type: 'prompts_updated', prompts: payload.prompts }, userId)
    } catch (err: any) {
      spindle.log.error(`Save prompts error: ${err.message}`)
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
      
      // 4. Generate payload is not an options bag. userId is a trailing STRING.
      const result = await (spindle.generate.quiet as any)({
        messages: [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: `Original Text:\n${payload.originalText}` }
        ]
      }, userId) 

      const genText = result?.text || result?.content || ""
      spindle.sendToFrontend({ type: 'generate_result', result: genText }, userId)
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
        
        // 5. Entity mutations have no options bag. userId is a trailing STRING.
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
        
        // 5. Entity mutations have no options bag. userId is a trailing STRING.
        await (spindle.characters.update as any)(payload.characterId, {
          extensions: { 'char_rewriter': extData }
        }, userId)
        
        spindle.toast.success("Draft version deleted.")
      }

      const updatedList = extData.variants?.[payload.category] || []
      spindle.sendToFrontend({ type: 'save_version_success', variants: updatedList }, userId)
    } catch (err: any) {
      spindle.log.error(`Delete version error: ${err.message}`)
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

      // 5. Entity mutations have no options bag. userId is a trailing STRING.
      await (spindle.characters.update as any)(payload.characterId, updatePayload, userId)
      
      spindle.toast.success("Card updated successfully!")
      spindle.sendToFrontend({ type: 'apply_success', text: payload.text }, userId)
    } catch (err: any) {
      spindle.log.error(`Apply error: ${err.message}`)
    }
  }
})
