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

async function getPrompts(userId: string): Promise<PromptConfig> {
  try {
    return await spindle.userStorage.getJson(PROMPTS_FILE, { fallback: DEFAULT_PROMPTS, userId })
  } catch {
    return DEFAULT_PROMPTS
  }
}

async function setPrompts(userId: string, prompts: PromptConfig): Promise<void> {
  await spindle.userStorage.setJson(PROMPTS_FILE, prompts, { userId })
}

async function getVersions(userId: string): Promise<VersionStore> {
  try {
    return await spindle.userStorage.getJson(VERSIONS_FILE, { fallback: {}, userId })
  } catch {
    return {}
  }
}

async function setVersions(userId: string, versions: VersionStore): Promise<void> {
  await spindle.userStorage.setJson(VERSIONS_FILE, versions, { userId })
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

async function handleGetInitData(msg: any, userId: string) {
  const hasChars = spindle.permissions.has('characters')
  const hasGen = spindle.permissions.has('generation')
  const hasChats = spindle.permissions.has('chats')

  if (!hasChars || !hasGen || !hasChats) {
    spindle.sendToFrontend({ type: 'permission_status', missing: [] }, userId)
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
        // ignore
      }
    }

    spindle.sendToFrontend({
      type: 'init_data',
      chars: chars.map((c: any) => ({
        id: c.id,
        name: c.name,
        image_id: c.image_id,
        alternate_greetings: c.alternate_greetings ?? [],
      })),
      prompts,
      activeCharId: activeCharId || (chars[0]?.id ?? ''),
    }, userId)
  } catch (err: any) {
    spindle.log.error(`[${EXT_ID}] init_data error: ${err?.message ?? err}`)
    spindle.sendToFrontend({ type: 'init_error', error: err?.message ?? 'Unknown error' }, userId)
  }
}

async function handleGetCharText(msg: any, userId: string) {
  try {
    const char = await spindle.characters.get(msg.characterId)
    if (!char) {
      spindle.sendToFrontend({ type: 'char_text_result', text: '', variants: [] }, userId)
      return
    }

    const text = getCategoryText(char, msg.category)
    const versions = await getVersions(userId)
    const variants = versions[msg.characterId]?.[msg.category] ?? []

    spindle.sendToFrontend({
      type: 'char_text_result',
      text,
      variants,
    }, userId)
  } catch (err: any) {
    spindle.log.error(`[${EXT_ID}] get_char_text error: ${err?.message ?? err}`)
    spindle.sendToFrontend({ type: 'char_text_result', text: '', variants: [] }, userId)
  }
}

async function handleSavePrompts(msg: any, userId: string) {
  try {
    const prompts: PromptConfig = {
      base: msg.prompts?.base ?? DEFAULT_PROMPTS.base,
    }
    await setPrompts(userId, prompts)
    spindle.sendToFrontend({ type: 'prompts_updated', prompts }, userId)
    spindle.toast.success('AI instructions saved.', { userId })
  } catch (err: any) {
    spindle.log.error(`[${EXT_ID}] save_prompts error: ${err?.message ?? err}`)
    spindle.toast.error('Failed to save instructions.', { userId })
  }
}

async function handleSaveVersion(msg: any, userId: string) {
  try {
    const versions = await getVersions(userId)
    if (!versions[msg.characterId]) versions[msg.characterId] = {}
    if (!versions[msg.characterId][msg.category]) versions[msg.characterId][msg.category] = []

    versions[msg.characterId][msg.category].push(msg.text)
    await setVersions(userId, versions)

    spindle.sendToFrontend({
      type: 'save_version_success',
      variants: versions[msg.characterId][msg.category],
    }, userId)
    spindle.toast.success('Version saved.', { userId })
  } catch (err: any) {
    spindle.log.error(`[${EXT_ID}] save_version error: ${err?.message ?? err}`)
    spindle.toast.error('Failed to save version.', { userId })
  }
}

async function handleApplyVersion(msg: any, userId: string) {
  try {
    const char = await spindle.characters.get(msg.characterId)
    if (!char) {
      spindle.toast.error('Character not found.', { userId })
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
    }, userId)
    spindle.toast.success(`Applied to ${getCategoryLabel(msg.category)}.`, { userId })
  } catch (err: any) {
    spindle.log.error(`[${EXT_ID}] apply_version error: ${err?.message ?? err}`)
    spindle.toast.error('Failed to apply version.', { userId })
  }
}

async function handleDeleteVersion(msg: any, userId: string) {
  try {
    const versions = await getVersions(userId)
    const charVersions = versions[msg.characterId]?.[msg.category]
    if (!charVersions || msg.index < 0 || msg.index >= charVersions.length) {
      spindle.toast.error('Version not found.', { userId })
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
    }, userId)
    spindle.toast.success('Version deleted.', { userId })
  } catch (err: any) {
    spindle.log.error(`[${EXT_ID}] delete_version error: ${err?.message ?? err}`)
    spindle.toast.error('Failed to delete version.', { userId })
  }
}

async function handleGenerate(msg: any, userId: string) {
  try {
    const prompts = await getPrompts(userId)
    const char = await spindle.characters.get(msg.characterId)
    if (!char) {
      spindle.sendToFrontend({ type: 'generate_failed', error: 'Character not found' }, userId)
      return
    }

    const categoryLabel = getCategoryLabel(msg.category)

    const messages = [
      { role: 'system' as const, content: prompts.base },
      {
        role: 'user' as const,
        content: `Character Name: ${char.name}
Character Description: ${char.description || 'N/A'}
Character Personality: ${char.personality || 'N/A'}

Please rewrite the following ${categoryLabel} for this character:

---
${msg.originalText || '(empty)'}
---`,
      },
    ]

    const result = await spindle.generate.quiet({ messages }, userId)

    if (!result || !result.content) {
      spindle.sendToFrontend({ type: 'generate_failed', error: 'Empty generation result' }, userId)
      return
    }

    spindle.sendToFrontend({
      type: 'generate_result',
      result: result.content.trim(),
    }, userId)
  } catch (err: any) {
    spindle.log.error(`[${EXT_ID}] generate error: ${err?.message ?? err}`)
    spindle.sendToFrontend({ type: 'generate_failed', error: err?.message ?? 'Generation failed' }, userId)
  }
}

// ─── Main Message Router ───────────────────────────────────────────────────

spindle.onFrontendMessage(async (payload: any, userId?: string) => {
  // For operator-scoped: userId MUST come from payload (frontend sends it)
  // because Lumiverse host does not pass it in the second parameter.
  const resolvedUserId = payload?.userId || userId

  if (!resolvedUserId) {
    spindle.log.error(`[${EXT_ID}] No userId in payload. Message type=${payload?.type}`)
    try {
      spindle.sendToFrontend({ type: 'init_error', error: 'userId missing in payload. Is the frontend sending it?' })
    } catch {
      // ignore
    }
    return
  }

  switch (payload.type) {
    case 'get_init_data':
      await handleGetInitData(payload, resolvedUserId)
      break
    case 'get_char_text':
      await handleGetCharText(payload, resolvedUserId)
      break
    case 'save_prompts':
      await handleSavePrompts(payload, resolvedUserId)
      break
    case 'save_version':
      await handleSaveVersion(payload, resolvedUserId)
      break
    case 'apply_version':
      await handleApplyVersion(payload, resolvedUserId)
      break
    case 'delete_version':
      await handleDeleteVersion(payload, resolvedUserId)
      break
    case 'generate':
      await handleGenerate(payload, resolvedUserId)
      break
    default:
      spindle.log.warn(`[${EXT_ID}] Unknown message type: ${payload.type}`)
  }
})

spindle.log.info(`[${EXT_ID}] Backend initialized.`)
