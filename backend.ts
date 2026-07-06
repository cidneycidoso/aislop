declare const spindle: import('lumiverse-spindle-types').SpindleAPI

const DEFAULT_PROMPTS = {
  base: "You are an expert creative writer and character designer. Rewrite the following character aspect to be more detailed, engaging, and well-written. Do not add commentary, output only the rewritten text.",
  description: "Focus on physical appearance, background, and general vibe.",
  personality: "Focus on traits, quirks, likes, dislikes, and psychological profile.",
  scenario: "Focus on setting the scene and world-building.",
  first_mes: "Focus on setting a strong hook, descriptive actions, and an engaging opening dialogue."
}

spindle.onFrontendMessage(async (payload, userId) => {
  if (payload.type === 'get_init_data') {
    const chars = await spindle.characters.list({ limit: 100 }, userId)
    const prompts = await spindle.userStorage.getJson('prompts.json', { fallback: DEFAULT_PROMPTS, userId })
    
    const activeChat = await spindle.chats.getActive(userId)
    const activeCharId = activeChat ? activeChat.character_id : null
    
    spindle.sendToFrontend({ type: 'init_data', chars: chars.data, prompts, activeCharId }, userId)
  }
  else if (payload.type === 'get_char_text') {
    const char = await spindle.characters.get(payload.characterId, userId)
    if (char) {
      spindle.sendToFrontend({
        type: 'char_text_result',
        text: char[payload.category as keyof typeof char] || ""
      }, userId)
    }
  }
  else if (payload.type === 'save_prompts') {
    await spindle.userStorage.setJson('prompts.json', payload.prompts, { userId })
    spindle.toast.success("Prompts saved!")
  }
  else if (payload.type === 'generate') {
    try {
      const prompts = await spindle.userStorage.getJson('prompts.json', { fallback: DEFAULT_PROMPTS, userId })
      const sysPrompt = `${prompts.base}\n\nSpecific instructions for this category: ${prompts[payload.category] || ""}`

      spindle.toast.info("AI is rewriting...")
      
      const result = await spindle.generate.quiet({
        messages: [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: `Original Text:\n${payload.originalText}` }
        ]
      }, userId)

      spindle.sendToFrontend({ type: 'generate_result', result: result.content }, userId)
    } catch (err: any) {
      spindle.toast.error(`Generation failed: ${err.message}`)
      spindle.sendToFrontend({ type: 'generate_failed' }, userId)
    }
  }
  else if (payload.type === 'apply') {
    await spindle.characters.update(payload.characterId, { 
      [payload.category]: payload.newText 
    }, userId)
    spindle.toast.success("Character updated successfully!")
  }
})