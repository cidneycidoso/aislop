declare const spindle: import('lumiverse-spindle-types').SpindleAPI

const DEFAULT_PROMPTS = {
  base: "You are an expert creative writer and character designer. Rewrite the following character aspect to be more detailed, engaging, and well-written. Do not add commentary, output only the rewritten text.",
  description: "Focus on physical appearance, background, and general vibe.",
  personality: "Focus on traits, quirks, likes, dislikes, and psychological profile.",
  scenario: "Focus on setting the scene and world-building.",
  first_mes: "Focus on setting a strong hook, descriptive actions, and an engaging opening dialogue.",
  mes_example: "Format as dialogue history. Focus on capturing the exact speech patterns, tone, and formatting of the character."
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

    // 1. Fetch characters safely without pagination loops
    let charsData: any[] = []
    try {
      // v1.1.0 natively resolves context
      const chars = await spindle.characters.list({ limit: 9999 })
      charsData = Array.isArray(chars) ? chars : (chars?.data || [])
    } catch (err: any) {
      try {
        // Fallback for older builds
        const fallback = await (spindle.characters.list as any)({ limit: 9999, userId })
        charsData = Array.isArray(fallback) ? fallback : (fallback?.data || [])
      } catch (e) {}
    }

    // 2. Fetch prompts
    const prompts = await spindle.userStorage.getJson('prompts.json', { fallback: DEFAULT_PROMPTS, userId }).catch(() => DEFAULT_PROMPTS)
    
    // 3. Resolve active character 
    let activeCharId = null
    if (routeType === 'characters' && routeId) {
      activeCharId = routeId
    } else if (routeType === 'chat' && routeId && hasChats) {
      let chat = await spindle.chats.get(routeId).catch(() => null)
      if (!chat) chat = await (spindle.chats.get as any)(routeId, { userId }).catch(() => null)
      if (chat) activeCharId = chat.character_id 
    }
    
    if (!activeCharId && hasChats) {
      let activeChat = await spindle.chats.getActive().catch(() => null)
      if (!activeChat) activeChat = await (spindle.chats.getActive as any)({ userId }).catch(() => null)
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
    try {
      let char = await spindle.characters.get(payload.characterId).catch(() => null)
      if (!char) char = await (spindle.characters.get as any)(payload.characterId, { userId }).catch(() => null)
      
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
      const prompts = await spindle.userStorage.getJson('prompts.json', { fallback: DEFAULT_PROMPTS, userId }).catch(() => DEFAULT_PROMPTS)
      const promptCat = payload.category.startsWith('alt_greeting_') ? 'first_mes' : payload.category
      const sysPrompt = `${prompts.base}\n\nCategory guidance:\n${prompts[promptCat] || ""}`

      spindle.toast.info("AI is rewriting...")
      
      // Generation always requires explicit threading as a secondary argument for operator-scoped
      const result = await (spindle.generate.quiet as any)({
        messages: [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: `Original Text:\n${payload.originalText}` }
        ]
      }, userId) 

      const genText = result.text || result.content || ""
      spindle.sendToFrontend({ type: 'generate_result', result: genText }, userId)
    } catch (err: any) {
      spindle.toast.error(`Generation failed: ${err.message}`)
      spindle.sendToFrontend({ type: 'generate_failed' }, userId)
    }
  }

  else if (payload.type === 'save_version') {
    if (!spindle.permissions.has('characters')) return
    try {
      let char = await spindle.characters.get(payload.characterId).catch(() => null)
      if (!char) char = await (spindle.characters.get as any)(payload.characterId, { userId }).catch(() => null)
      if (!char) throw new Error("Character not found")

      const extData = char.extensions?.['char_rewriter'] || { variants: {} }
      if (!extData.variants) extData.variants = {}
      if (!extData.variants[payload.category]) extData.variants[payload.category] = []
      
      const currentList = extData.variants[payload.category]
      if (currentList.length === 0 || currentList[currentList.length - 1] !== payload.text) {
        extData.variants[payload.category].push(payload.text)
        
        const payloadData = { extensions: { 'char_rewriter': extData } }
        await spindle.characters.update(payload.characterId, payloadData).catch(async () => {
          await (spindle.characters.update as any)(payload.characterId, payloadData, { userId })
        })
        
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
      let char = await spindle.characters.get(payload.characterId).catch(() => null)
      if (!char) char = await (spindle.characters.get as any)(payload.characterId, { userId }).catch(() => null)
      if (!char) throw new Error("Character not found")

      const extData = char.extensions?.['char_rewriter'] || { variants: {} }
      if (extData.variants?.[payload.category]) {
        extData.variants[payload.category].splice(payload.index, 1)
        
        const payloadData = { extensions: { 'char_rewriter': extData } }
        await spindle.characters.update(payload.characterId, payloadData).catch(async () => {
          await (spindle.characters.update as any)(payload.characterId, payloadData, { userId })
        })
        
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
      let char = await spindle.characters.get(payload.characterId).catch(() => null)
      if (!char) char = await (spindle.characters.get as any)(payload.characterId, { userId }).catch(() => null)
      if (!char) throw new Error("Character not found")

      if (payload.category.startsWith('alt_greeting_')) {
        const altGreetings = [...(char.alternate_greetings || [])]
        const idx = parseInt(payload.category.replace('alt_greeting_', ''), 10)
        altGreetings[idx] = payload.text
        updatePayload = { alternate_greetings: altGreetings }
      } else {
        updatePayload = { [payload.category]: payload.text }
      }

      await spindle.characters.update(payload.characterId, updatePayload).catch(async () => {
        await (spindle.characters.update as any)(payload.characterId, updatePayload, { userId })
      })
      
      spindle.toast.success("Card updated successfully!")
      spindle.sendToFrontend({ type: 'apply_success', text: payload.text }, userId)
    } catch (err: any) {
      spindle.log.error(`Apply error: ${err.message}`)
    }
  }
})
