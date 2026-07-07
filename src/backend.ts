declare const spindle: import('lumiverse-spindle-types').SpindleAPI

const DEFAULT_PROMPTS = {
  base: "You are an expert creative writer and character designer. Rewrite the following character aspect to be more detailed, engaging, and well-written. Do not add commentary, output only the rewritten text.",
  description: "Focus on physical appearance, background, and general vibe.",
  personality: "Focus on traits, quirks, likes, dislikes, and psychological profile.",
  scenario: "Focus on setting the scene and world-building.",
  first_mes: "Focus on setting a strong hook, descriptive actions, and an engaging opening dialogue."
}

// Safely gather data after validating permissions
async function checkAndSendInitData(userId?: string) {
  const hasCharacters = spindle.permissions.has('characters')
  const hasGeneration = spindle.permissions.has('generation')

  if (!hasCharacters || !hasGeneration) {
    spindle.sendToFrontend({
      type: 'permission_status',
      hasCharacters,
      hasGeneration
    }, userId)
    return
  }

  try {
    const chars = await spindle.characters.list({ limit: 100 })
    const prompts = await spindle.userStorage.getJson('prompts.json', { fallback: DEFAULT_PROMPTS, userId })
    
    const activeChat = await spindle.chats.getActive()
    const activeCharId = activeChat ? activeChat.character_id : null
    
    spindle.sendToFrontend({ 
      type: 'init_data', 
      chars: chars.data, 
      prompts,
      activeCharId
    }, userId)
  } catch (err: any) {
    spindle.log.error(`Failed to load initial data: ${err.message}`)
  }
}

spindle.onFrontendMessage(async (payload: any, userId?: string) => {
  if (payload.type === 'get_init_data') {
    await checkAndSendInitData(userId)
  }

  else if (payload.type === 'get_char_text') {
    if (!spindle.permissions.has('characters')) return
    try {
      const char = await spindle.characters.get(payload.characterId)
      if (char) {
        spindle.sendToFrontend({
          type: 'char_text_result',
          text: char[payload.category as keyof typeof char] || ""
        }, userId)
      }
    } catch (err: any) {
      spindle.log.error(`Failed to get character text: ${err.message}`)
    }
  }

  else if (payload.type === 'save_prompts') {
    try {
      await spindle.userStorage.setJson('prompts.json', payload.prompts, { userId })
      spindle.toast.success("Instructions updated!")
      spindle.sendToFrontend({ type: 'prompts_updated', prompts: payload.prompts }, userId)
    } catch (err: any) {
      spindle.log.error(`Failed to save prompts: ${err.message}`)
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
      const sysPrompt = `${prompts.base}\n\nCategory guidance:\n${prompts[payload.category] || ""}`

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

  else if (payload.type === 'apply') {
    if (!spindle.permissions.has('characters')) return
    try {
      await spindle.characters.update(payload.characterId, { 
        [payload.category]: payload.newText 
      })
      spindle.toast.success("Character updated successfully!")
    } catch (err: any) {
      spindle.log.error(`Failed to update character: ${err.message}`)
    }
  }
})