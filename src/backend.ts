declare const spindle: import('lumiverse-spindle-types').SpindleAPI

const EXT_ID = 'ai_character_rewriter'
const PROMPTS_FILE = 'prompts.json'
const VERSIONS_FILE = 'versions.json'

// ─── Types ─────────────────────────────────────────────────────────────────

interface PromptConfig {
  base: string
}

interface VersionStore {
  [charId: string]: {
    [category: string]: string[]
  }
}

interface FrontendMessage {
  type: string
  userId?: string
  [key: string]: any
}

// ─── Default Prompts ────────────────────────────────────────────────────────

const DEFAULT_PROMPTS: PromptConfig = {
  base: `You are an expert creative writing assistant specializing in character development for AI roleplay.

Your task: rewrite the provided character field to be more vivid, engaging, and consistent with the character's overall persona.

Guidelines:
- Maintain the original tone and intent
- Expand on details where appropriate
- Keep the same approximate length unless the user wants expansion
- Preserve any formatting (markdown, dialogue tags, etc.)
- Do NOT add meta-commentary or explanations
- Output ONLY the rewritten text, nothing else`,
}

// ─── Helpers ───────────────────────────────────────────────────────────────

async function getPrompts(userId?: string): Promise<PromptConfig> {
  try {
    if (userId) {
      return await spindle.userStorage.getJson(PROMPTS_FILE, { fallback: DEFAULT_PROMPTS, userId })
    }
    return await spindle.userStorage.getJson(PROMPTS_FILE, { fallback: DEFAULT_PROMPTS })
  } catch {
    return DEFAULT_PROMPTS
  }
}

async function setPrompts(userId: string | undefined, prompts: PromptConfig): Promise<void> {
  if (userId) {
    await spindle.userStorage.setJson(PROMPTS_FILE, prompts, { userId })
  } else {
    await spindle.userStorage.setJson(PROMPTS_FILE, prompts)
  }
}

async function getVersions(userId?: string): Promise<VersionStore> {
  try {
    if (userId) {
      return await spindle.userStorage.getJson(VERSIONS_FILE, { fallback: {}, userId })
    }
    return await spindle.userStorage.getJson(VERSIONS_FILE, { fallback: {} })
  } catch {
    return {}
  }
}

async function setVersions(userId: string | undefined, versions: VersionStore): Promise<void> {
  if (userId) {
    await spindle.userStorage.setJson(VERSIONS_FILE, versions, { userId })
  } else {
    await spindle.userStorage.setJson(VERSIONS_FILE, versions)
  }
}

function getCategoryText(char: any, category: string): string {
  if (category.startsWith('alt_greeting_')) {
    const idx = parseInt(category.replace('alt_greeting_', ''), 10)
    return char.alternate_greetings?.[idx] ?? ''
  }
  return char[category] ?? ''
}

function getCategoryLabel(category: string): string {
  const labels: Record<string, string> = {
    description: 'Description',
    personality: 'Personality',
    scenario: 'Scenario',
    mes_example: 'Example Messages',
    first_mes: 'Main Greeting',
  }
  if (category.startsWith('alt_greeting_')) {
    const idx = parseInt(category.replace('alt_greeting_', ''), 10)
    return `Alt Greeting ${idx + 1}`
  }
  return labels[category] ?? category
}

// ─── Message Handlers ─────────────────────────────────────────────────────

async function handleGetInitData(msg: FrontendMessage, userId?: string) {
  const hasChars = spindle.permissions.has('characters')
  const hasGen = spindle.permissions.has('generation')
  const hasChats = spindle.permissions.has('chats')

  if (!hasChars || !hasGen || !hasChats) {
    spindle.sendToFrontend({ type: 'permission_status', missing: [] })
    return
  }

  try {
    const { data: chars } = await spindle.characters.list({ limit: 200, offset: 0 })
    const prompts = await getPrompts(userId)

    let activeCharId = ''
    if (msg.routeType === 'characters' && msg.routeId) {
      const char = await spindle.characters.get(msg.routeId)
      if (char) activeCharId = char.id
    } else if (msg.routeType === 'chat' && msg.routeId) {
      try {
        const chat = await spindle.chats.get(msg.routeId)
        if (chat?.character_id) {
          activeCharId = chat.character_id
        }
      } catch {
        // Chat might not exist or we lack access
      }
    }

    spindle.sendToFrontend({
      type: 'init_data',
      chars: chars.map((c) => ({
        id: c.id,
        name: c.name,
        image_id: c.image_id,
        alternate_greetings: c.alternate_greetings ?? [],
      })),
      prompts,
      activeCharId: activeCharId || (chars[0]?.id ?? ''),
    })
  } catch (err: any) {
    spindle.log.error(`[${EXT_ID}] init_data error: ${err?.message ?? err}`)
    spindle.sendToFrontend({ type: 'init_error', error: err?.message ?? 'Unknown error' })
  }
}

async function handleGetCharText(msg: FrontendMessage, userId?: string) {
  try {
    const char = await spindle.characters.get(msg.characterId)
    if (!char) {
      spindle.sendToFrontend({ type: 'char_text_result', text: '', variants: [] })
      return
    }

    const text = getCategoryText(char, msg.category)
    const versions = await getVersions(userId)
    const variants = versions[msg.characterId]?.[msg.category] ?? []

    spindle.sendToFrontend({
      type: 'char_text_result',
      text,
      variants,
    })
  } catch (err: any) {
    spindle.log.error(`[${EXT_ID}] get_char_text error: ${err?.message ?? err}`)
    spindle.sendToFrontend({ type: 'char_text_result', text: '', variants: [] })
  }
}

async function handleSavePrompts(msg: FrontendMessage, userId?: string) {
  try {
    const prompts: PromptConfig = {
      base: msg.prompts?.base ?? DEFAULT_PROMPTS.base,
    }
    await setPrompts(userId, prompts)
    spindle.sendToFrontend({ type: 'prompts_updated', prompts })
    if (userId) {
      spindle.toast.success('AI instructions saved.', { userId })
    } else {
      spindle.toast.success('AI instructions saved.')
    }
  } catch (err: any) {
    spindle.log.error(`[${EXT_ID}] save_prompts error: ${err?.message ?? err}`)
    if (userId) {
      spindle.toast.error('Failed to save instructions.', { userId })
    } else {
      spindle.toast.error('Failed to save instructions.')
    }
  }
}

async function handleSaveVersion(msg: FrontendMessage, userId?: string) {
  try {
    const versions = await getVersions(userId)
    if (!versions[msg.characterId]) versions[msg.characterId] = {}
    if (!versions[msg.characterId][msg.category]) versions[msg.characterId][msg.category] = []

    versions[msg.characterId][msg.category].push(msg.text)
    await setVersions(userId, versions)

    spindle.sendToFrontend({
      type: 'save_version_success',
      variants: versions[msg.characterId][msg.category],
    })
    if (userId) {
      spindle.toast.success('Version saved.', { userId })
    } else {
      spindle.toast.success('Version saved.')
    }
  } catch (err: any) {
    spindle.log.error(`[${EXT_ID}] save_version error: ${err?.message ?? err}`)
    if (userId) {
      spindle.toast.error('Failed to save version.', { userId })
    } else {
      spindle.toast.error('Failed to save version.')
    }
  }
}

async function handleApplyVersion(msg: FrontendMessage, userId?: string) {
  try {
    const char = await spindle.characters.get(msg.characterId)
    if (!char) {
      if (userId) {
        spindle.toast.error('Character not found.', { userId })
      } else {
        spindle.toast.error('Character not found.')
      }
      return
    }

    const updateData: any = {}

    if (msg.category.startsWith('alt_greeting_')) {
      const idx = parseInt(msg.category.replace('alt_greeting_', ''), 10)
      const greetings = [...(char.alternate_greetings ?? [])]
      greetings[idx] = msg.text
      updateData.alternate_greetings = greetings
    } else {
      updateData[msg.category] = msg.text
    }

    await spindle.characters.update(msg.characterId, updateData)

    spindle.sendToFrontend({
      type: 'apply_success',
      text: msg.text,
    })
    if (userId) {
      spindle.toast.success(`Applied to ${getCategoryLabel(msg.category)}.`, { userId })
    } else {
      spindle.toast.success(`Applied to ${getCategoryLabel(msg.category)}.`)
    }
  } catch (err: any) {
    spindle.log.error(`[${EXT_ID}] apply_version error: ${err?.message ?? err}`)
    if (userId) {
      spindle.toast.error('Failed to apply version.', { userId })
    } else {
      spindle.toast.error('Failed to apply version.')
    }
  }
}

async function handleDeleteVersion(msg: FrontendMessage, userId?: string) {
  try {
    const versions = await getVersions(userId)
    const charVersions = versions[msg.characterId]?.[msg.category]
    if (!charVersions || msg.index < 0 || msg.index >= charVersions.length) {
      if (userId) {
        spindle.toast.error('Version not found.', { userId })
      } else {
        spindle.toast.error('Version not found.')
      }
      return
    }

    charVersions.splice(msg.index, 1)
    if (charVersions.length === 0) {
      delete versions[msg.characterId][msg.category]
    }
    await setVersions(userId, versions)

    const char = await spindle.characters.get(msg.characterId)
    const liveText = getCategoryText(char, msg.category)

    spindle.sendToFrontend({
      type: 'char_text_result',
      text: liveText,
      variants: versions[msg.characterId]?.[msg.category] ?? [],
    })
    if (userId) {
      spindle.toast.success('Version deleted.', { userId })
    } else {
      spindle.toast.success('Version deleted.')
    }
  } catch (err: any) {
    spindle.log.error(`[${EXT_ID}] delete_version error: ${err?.message ?? err}`)
    if (userId) {
      spindle.toast.error('Failed to delete version.', { userId })
    } else {
      spindle.toast.error('Failed to delete version.')
    }
  }
}

async function handleGenerate(msg: FrontendMessage, userId?: string) {
  try {
    const prompts = await getPrompts(userId)
    const char = await spindle.characters.get(msg.characterId)
    if (!char) {
      spindle.sendToFrontend({ type: 'generate_failed', error: 'Character not found' })
      return
    }

    const categoryLabel = getCategoryLabel(msg.category)
    const systemPrompt = prompts.base

    const userPrompt = `Character Name: ${char.name}
Character Description: ${char.description || 'N/A'}
Character Personality: ${char.personality || 'N/A'}

Please rewrite the following ${categoryLabel} for this character:

---
${msg.originalText || '(empty)'}
---`

    let result
    if (userId) {
      result = await spindle.generate.quiet({
        systemPrompt,
        prompt: userPrompt,
        maxTokens: 2048,
        temperature: 0.8,
      }, userId)
    } else {
      result = await spindle.generate.quiet({
        systemPrompt,
        prompt: userPrompt,
        maxTokens: 2048,
        temperature: 0.8,
      })
    }

    if (!result || !result.text) {
      spindle.sendToFrontend({ type: 'generate_failed', error: 'Empty generation result' })
      return
    }

    spindle.sendToFrontend({
      type: 'generate_result',
      result: result.text.trim(),
    })
  } catch (err: any) {
    spindle.log.error(`[${EXT_ID}] generate error: ${err?.message ?? err}`)
    spindle.sendToFrontend({ type: 'generate_failed', error: err?.message ?? 'Generation failed' })
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

spindle.on('message', async (msg: FrontendMessage) => {
  const userId = msg.userId

  switch (msg.type) {
    case 'get_init_data':
      await handleGetInitData(msg, userId)
      break
    case 'get_char_text':
      await handleGetCharText(msg, userId)
      break
    case 'save_prompts':
      await handleSavePrompts(msg, userId)
      break
    case 'save_version':
      await handleSaveVersion(msg, userId)
      break
    case 'apply_version':
      await handleApplyVersion(msg, userId)
      break
    case 'delete_version':
      await handleDeleteVersion(msg, userId)
      break
    case 'generate':
      await handleGenerate(msg, userId)
      break
    default:
      spindle.log.warn(`[${EXT_ID}] Unknown message type: ${msg.type}`)
  }
})

spindle.log.info(`[${EXT_ID}] Backend initialized.`)
