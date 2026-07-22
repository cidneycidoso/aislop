declare const spindle: import('lumiverse-spindle-types').SpindleAPI

const DEFAULT_PROMPTS = {
  base: "You are an expert creative writer and character designer. Rewrite the following character aspect to be more detailed, engaging, and well-written. Output only the rewritten content without introductory commentary.",
  description: "Focus on physical appearance, background, atmosphere, and general vibe.",
  personality: "Focus on character traits, quirks, likes, dislikes, and psychological profile.",
  scenario: "Focus on setting the scene, environment, and world-building.",
  first_mes: "Focus on setting a strong hook, descriptive sensory actions, and engaging opening dialogue.",
  mes_example: "Format as dialogue history. Capture the exact speech patterns, tone, and character voice."
}

async function getCharacterList(): Promise<any[]> {
  try {
    const response = await spindle.characters.list({ limit: 200 })
    if (Array.isArray(response)) return response
    if (response && Array.isArray(response.data)) return response.data
    return []
  } catch (err: any) {
    spindle.log.error(`Error listing characters: ${err.message}`)
    throw err
  }
}

async function handleInitData(userId: string, routeType?: string | null, routeId?: string | null) {
  const hasCharacters = spindle.permissions.has('characters')
  const hasGeneration = spindle.permissions.has('generation')

  if (!hasCharacters || !hasGeneration) {
    spindle.sendToFrontend({
      type: 'permission_error',
      error: 'Please grant Characters and Generation permissions in Lumiverse settings.'
    }, userId)
    return
  }

  try {
    const chars = await getCharacterList()
    
    // spindle.storage handles extension storage
    const prompts = await spindle.storage.getJson('prompts.json', { fallback: DEFAULT_PROMPTS })

    let activeCharId = null
    if (routeType === 'characters' && routeId) {
      activeCharId = routeId
    } else if (routeType === 'chat' && routeId && spindle.permissions.has('chats')) {
      try {
        const chat = await spindle.chats.get(routeId)
        if (chat) activeCharId = chat.character_id
      } catch (err) {}
    }

    if (!activeCharId && spindle.permissions.has('chats')) {
      try {
        const activeChat = await spindle.chats.getActive()
        if (activeChat) activeCharId = activeChat.character_id
      } catch (err) {}
    }

    spindle.sendToFrontend({
      type: 'init_data',
      chars,
      prompts,
      activeCharId
    }, userId)

  } catch (err: any) {
    spindle.log.error(`get_init_data failed: ${err.message}`)
    spindle.sendToFrontend({ type: 'backend_error', error: err.message }, userId)
  }
}

spindle.onFrontendMessage(async (payload: any, userId: string) => {
  try {
    if (payload.type === 'get_init_data') {
      await handleInitData(userId, payload.routeType, payload.routeId)
    }

    else if (payload.type === 'get_char_text') {
      const char = await spindle.characters.get(payload.characterId)
      if (!char) throw new Error("Character not found")

      let text = ""
      if (payload.category.startsWith('alt_greeting_')) {
        const idx = parseInt(payload.category.replace('alt_greeting_', ''), 10)
        text = (char.alternate_greetings || [])[idx] || ""
      } else {
        text = (char as any)[payload.category] || ""
      }

      const extData = char.extensions?.['char_rewriter'] || {}
      const variants = extData.variants?.[payload.category] || []

      spindle.sendToFrontend({ type: 'char_text_result', text, variants }, userId)
    }

    else if (payload.type === 'save_prompts') {
      await spindle.storage.setJson('prompts.json', payload.prompts)
      spindle.toast.success("Instructions saved!")
      spindle.sendToFrontend({ type: 'prompts_saved', prompts: payload.prompts }, userId)
    }

    else if (payload.type === 'generate_rewrite') {
      const prompts = await spindle.storage.getJson('prompts.json', { fallback: DEFAULT_PROMPTS })
      const catKey = payload.category.startsWith('alt_greeting_') ? 'first_mes' : payload.category
      const categoryGuidance = (prompts as any)[catKey] || ""
      const systemPrompt = `${prompts.base}\n\nCategory Focus:\n${categoryGuidance}`

      const result = await spindle.generate.quiet({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Original Text to Rewrite:\n${payload.originalText}` }
        ]
      }, userId)

      const generatedContent = result?.content || result?.text || ""
      spindle.sendToFrontend({ type: 'generate_success', result: generatedContent }, userId)
    }

    else if (payload.type === 'save_draft') {
      const char = await spindle.characters.get(payload.characterId)
      if (!char) throw new Error("Character card not found")

      const extData = char.extensions?.['char_rewriter'] || { variants: {} }
      if (!extData.variants) extData.variants = {}
      if (!extData.variants[payload.category]) extData.variants[payload.category] = []

      extData.variants[payload.category].push(payload.text)

      await spindle.characters.update(payload.characterId, {
        extensions: { 'char_rewriter': extData }
      })

      spindle.toast.success("Draft saved!")
      spindle.sendToFrontend({
        type: 'draft_saved',
        variants: extData.variants[payload.category]
      }, userId)
    }

    else if (payload.type === 'delete_draft') {
      const char = await spindle.characters.get(payload.characterId)
      if (!char) throw new Error("Character card not found")

      const extData = char.extensions?.['char_rewriter'] || { variants: {} }
      if (extData.variants?.[payload.category]) {
        extData.variants[payload.category].splice(payload.index, 1)

        await spindle.characters.update(payload.characterId, {
          extensions: { 'char_rewriter': extData }
        })

        spindle.toast.success("Draft deleted")
      }

      const updatedVariants = extData.variants?.[payload.category] || []
      spindle.sendToFrontend({
        type: 'draft_saved',
        variants: updatedVariants
      }, userId)
    }

    else if (payload.type === 'apply_to_card') {
      const char = await spindle.characters.get(payload.characterId)
      if (!char) throw new Error("Character card not found")

      let updatePayload: any = {}
      if (payload.category.startsWith('alt_greeting_')) {
        const altGreetings = [...(char.alternate_greetings || [])]
        const idx = parseInt(payload.category.replace('alt_greeting_', ''), 10)
        altGreetings[idx] = payload.text
        updatePayload = { alternate_greetings: altGreetings }
      } else {
        updatePayload = { [payload.category]: payload.text }
      }

      await spindle.characters.update(payload.characterId, updatePayload)
      spindle.toast.success("Card updated!")
      spindle.sendToFrontend({ type: 'apply_success', text: payload.text }, userId)
    }

  } catch (err: any) {
    spindle.log.error(`Message handler failed [${payload?.type}]: ${err.message}`)
    spindle.sendToFrontend({ type: 'backend_error', error: err.message }, userId)
  }
})
