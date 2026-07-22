declare const spindle: import('lumiverse-spindle-types').SpindleAPI

const EXT_ID = 'ai_character_rewriter'
const PROMPTS_FILE = 'prompts.json'
const VERSIONS_FILE = 'versions.json'

interface PromptConfig {
  base: string
}

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

async function getPrompts(): Promise<PromptConfig> {
  try {
    return await spindle.storage.getJson(PROMPTS_FILE, { fallback: DEFAULT_PROMPTS })
  } catch {
    return DEFAULT_PROMPTS
  }
}

async function setPrompts(prompts: PromptConfig): Promise<void> {
  await spindle.storage.setJson(PROMPTS_FILE, prompts)
}

async function getVersions(): Promise<any> {
  try {
    return await spindle.storage.getJson(VERSIONS_FILE, { fallback: {} })
  } catch {
    return {}
  }
}

async function setVersions(versions: any): Promise<void> {
  await spindle.storage.setJson(VERSIONS_FILE, versions)
}

spindle.onFrontendMessage(async (payload: any, userId?: string) => {
  switch (payload.type) {
    case 'get_prompts': {
      try {
        const prompts = await getPrompts()
        spindle.sendToFrontend({ type: 'prompts_data', prompts }, userId)
      } catch (err: any) {
        spindle.sendToFrontend({ type: 'prompts_data', prompts: DEFAULT_PROMPTS }, userId)
      }
      break
    }

    case 'save_prompts': {
      try {
        await setPrompts({ base: payload.prompts?.base ?? DEFAULT_PROMPTS.base })
        spindle.sendToFrontend({ type: 'prompts_saved' }, userId)
        spindle.toast.success('AI instructions saved.')
      } catch (err: any) {
        spindle.toast.error('Failed to save instructions.')
      }
      break
    }

    case 'get_versions': {
      try {
        const versions = await getVersions()
        spindle.sendToFrontend({ type: 'versions_data', versions }, userId)
      } catch (err: any) {
        spindle.sendToFrontend({ type: 'versions_data', versions: {} }, userId)
      }
      break
    }

    case 'save_versions': {
      try {
        await setVersions(payload.versions)
        spindle.sendToFrontend({ type: 'versions_saved' }, userId)
      } catch (err: any) {
        spindle.toast.error('Failed to save versions.')
      }
      break
    }

    case 'generate': {
      try {
        const prompts = await getPrompts()

        const messages = [
          { role: 'system' as const, content: prompts.base },
          { role: 'user' as const, content: payload.prompt },
        ]

        const result = await spindle.generate.quiet({ messages })

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
      break
    }

    default:
      spindle.log.warn(`[${EXT_ID}] Unknown message type: ${payload.type}`)
  }
})

spindle.log.info(`[${EXT_ID}] Backend initialized.`)
