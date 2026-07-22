declare const spindle: import('lumiverse-spindle-types').SpindleAPI

const DEFAULT_PROMPTS = {
  base: "Rewrite the following text to enhance depth, flow, and character consistency while retaining all key personality traits and lore details. Output ONLY the rewritten text with no markdown commentary or explanations."
}

// Helper: Read category text from CharacterDTO
function getCategoryText(char: any, category: string): string {
  if (!char) return ''
  if (category.startsWith('alt_greeting_')) {
    const idx = parseInt(category.replace('alt_greeting_', ''), 10)
    return char.alternate_greetings?.[idx] || ''
  }
  switch (category) {
    case 'description': return char.description || ''
    case 'personality': return char.personality || ''
    case 'scenario': return char.scenario || ''
    case 'mes_example': return char.mes_example || ''
    case 'first_mes': return char.first_mes || ''
    default: return ''
  }
}

// Helper: Build update payload for spindle.characters.update
function buildCategoryUpdatePayload(char: any, category: string, newText: string): Record<string, any> {
  if (category.startsWith('alt_greeting_')) {
    const idx = parseInt(category.replace('alt_greeting_', ''), 10)
    const altGreetings = Array.isArray(char.alternate_greetings) ? [...char.alternate_greetings] : []
    altGreetings[idx] = newText
    return { alternate_greetings: altGreetings }
  }
  switch (category) {
    case 'description': return { description: newText }
    case 'personality': return { personality: newText }
    case 'scenario': return { scenario: newText }
    case 'mes_example': return { mes_example: newText }
    case 'first_mes': return { first_mes: newText }
    default: return {}
  }
}

// Helper: Persistent per-user storage for prompt configuration
async function loadPrompts(userId: string): Promise<{ base: string }> {
  try {
    const data = await spindle.userStorage.read('prompts.json', userId)
    return JSON.parse(data)
  } catch {
    return DEFAULT_PROMPTS
  }
}

async function savePrompts(prompts: { base: string }, userId: string): Promise<void> {
  await spindle.userStorage.write('prompts.json', JSON.stringify(prompts, null, 2), userId)
}

// Helper: Persistent per-user storage for character draft variants
async function loadVariants(characterId: string, category: string, userId: string): Promise<string[]> {
  try {
    const data = await spindle.userStorage.read(`variants_${characterId}.json`, userId)
    const store = JSON.parse(data)
    return store[category] || []
  } catch {
    return []
  }
}

async function saveVariants(characterId: string, category: string, variants: string[], userId: string): Promise<void> {
  let store: Record<string, string[]> = {}
  try {
    const data = await spindle.userStorage.read(`variants_${characterId}.json`, userId)
    store = JSON.parse(data)
  } catch {
    store = {}
  }
  store[category] = variants
  await spindle.userStorage.write(`variants_${characterId}.json`, JSON.stringify(store, null, 2), userId)
}

// IPC Message Router
spindle.onFrontendMessage(async (payload: any, userId: string) => {
  if (!userId) {
    spindle.log.error('Received message without userId in frontend communication')
    return
  }

  // 1. Initial Data Request
  if (payload.type === 'get_init_data') {
    if (!spindle.permissions.has('characters', userId)) {
      spindle.sendToFrontend({ type: 'permission_status' }, userId)
      return
    }

    try {
      const { data: chars } = await spindle.characters.list({ limit: 200 }, userId)
      const prompts = await loadPrompts(userId)

      let activeCharId = ''
      if (payload.routeType === 'characters' && payload.routeId) {
        activeCharId = payload.routeId
      } else if (payload.routeType === 'chat' && payload.routeId && spindle.permissions.has('chats', userId)) {
        try {
          const chat = await spindle.chats.get(payload.routeId, userId)
          if (chat?.character_id) {
            activeCharId = chat.character_id
          }
        } catch {
          // Chat lookup fallback
        }
      }

      if (!activeCharId && chars.length > 0) {
        activeCharId = chars[0].id
      }

      spindle.sendToFrontend({
        type: 'init_data',
        chars,
        prompts,
        activeCharId
      }, userId)
    } catch (err: any) {
      spindle.sendToFrontend({
        type: 'init_error',
        error: err.message || 'Failed to fetch characters from server'
      }, userId)
    }
    return
  }

  // 2. Fetch Card Text & History
  if (payload.type === 'get_char_text') {
    const { characterId, category } = payload
    try {
      const char = await spindle.characters.get(characterId, userId)
      if (!char) {
        spindle.sendToFrontend({ type: 'char_text_result', text: '', variants: [] }, userId)
        return
      }
      const text = getCategoryText(char, category)
      const variants = await loadVariants(characterId, category, userId)
      spindle.sendToFrontend({ type: 'char_text_result', text, variants }, userId)
    } catch (err: any) {
      spindle.sendToFrontend({ type: 'char_text_result', text: `Error: ${err.message}`, variants: [] }, userId)
    }
    return
  }

  // 3. Save Prompt Configuration
  if (payload.type === 'save_prompts') {
    await savePrompts(payload.prompts, userId)
    spindle.sendToFrontend({ type: 'prompts_updated', prompts: payload.prompts }, userId)
    return
  }

  // 4. Save Version Draft
  if (payload.type === 'save_version') {
    const { characterId, category, text } = payload
    const variants = await loadVariants(characterId, category, userId)
    variants.push(text)
    await saveVariants(characterId, category, variants, userId)
    spindle.sendToFrontend({ type: 'save_version_success', variants }, userId)
    return
  }

  // 5. Delete Version Draft
  if (payload.type === 'delete_version') {
    const { characterId, category, index } = payload
    let variants = await loadVariants(characterId, category, userId)
    if (index >= 0 && index < variants.length) {
      variants.splice(index, 1)
      await saveVariants(characterId, category, variants, userId)
    }
    spindle.sendToFrontend({ type: 'save_version_success', variants }, userId)
    return
  }

  // 6. Apply Draft Version directly to Character Card
  if (payload.type === 'apply_version') {
    const { characterId, category, text } = payload
    try {
      const char = await spindle.characters.get(characterId, userId)
      if (char) {
        const updatePayload = buildCategoryUpdatePayload(char, category, text)
        await spindle.characters.update(characterId, updatePayload, userId)
        spindle.sendToFrontend({ type: 'apply_success', text }, userId)
      }
    } catch (err: any) {
      spindle.log.error(`Failed to apply version: ${err.message}`)
    }
    return
  }

  // 7. AI Text Generation
  if (payload.type === 'generate') {
    if (!spindle.permissions.has('generation', userId)) {
      spindle.sendToFrontend({ type: 'generate_failed', error: 'Missing generation permission' }, userId)
      return
    }

    try {
      const { category, originalText } = payload
      const prompts = await loadPrompts(userId)

      const result = await spindle.generate.quiet({
        messages: [
          { role: 'system', content: prompts.base },
          { role: 'user', content: `Target Field Category: ${category}\n\nOriginal Character Text:\n${originalText}` }
        ]
      }, userId)

      spindle.sendToFrontend({
        type: 'generate_result',
        result: result.content || ''
      }, userId)
    } catch (err: any) {
      spindle.log.error(`AI Generation failed: ${err.message}`)
      spindle.sendToFrontend({ type: 'generate_failed' }, userId)
    }
    return
  }
})

spindle.log.info('AI Character Rewriter Extension initialized successfully.')
