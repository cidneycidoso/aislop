declare const spindle: import('lumiverse-spindle-types').SpindleAPI

interface PromptsConfig {
  base: string
}

const DEFAULT_PROMPTS: PromptsConfig = {
  base: `You are an expert creative roleplay writer and character developer. Your goal is to rewrite, refine, or expand the given character field according to the character's core identity. Output ONLY the rewritten text for the requested category. Do not include introductory notes, markdown wrappers, or conversational meta-commentary.`
}

const activeGenerations = new Map<string, { cancel: () => void }>()

async function getSavedPrompts(userId: string): Promise<PromptsConfig> {
  try {
    const data = await spindle.userStorage.readJson<PromptsConfig>('prompts.json', userId)
    return { ...DEFAULT_PROMPTS, ...data }
  } catch {
    return DEFAULT_PROMPTS
  }
}

async function saveSavedPrompts(prompts: PromptsConfig, userId: string): Promise<void> {
  await spindle.userStorage.writeJson('prompts.json', prompts, userId)
}

spindle.onFrontendMessage(async (payload: any, userId: string) => {
  if (!userId) return

  switch (payload?.type) {
    case 'get_status': {
      try {
        const prompts = await getSavedPrompts(userId)
        const hasGenPermission = spindle.permissions ? spindle.permissions.has('generation') : true

        spindle.sendToFrontend({
          type: 'status_result',
          hasGeneration: hasGenPermission,
          prompts
        }, userId)
      } catch (err: any) {
        spindle.sendToFrontend({
          type: 'status_error',
          error: err.message || 'Failed to initialize backend status'
        }, userId)
      }
      break
    }

    case 'save_prompts': {
      try {
        const prompts = payload.prompts || DEFAULT_PROMPTS
        await saveSavedPrompts(prompts, userId)
        spindle.sendToFrontend({
          type: 'prompts_updated',
          prompts
        }, userId)
      } catch (err: any) {
        spindle.sendToFrontend({
          type: 'status_error',
          error: `Failed to save instructions: ${err.message}`
        }, userId)
      }
      break
    }

    case 'generate': {
      try {
        const prompts = await getSavedPrompts(userId)
        const { category, originalText, customPrompt } = payload

        if (activeGenerations.has(userId)) {
          activeGenerations.get(userId)?.cancel()
          activeGenerations.delete(userId)
        }

        let isCancelled = false
        const cancelHandler = () => { isCancelled = true }
        activeGenerations.set(userId, { cancel: cancelHandler })

        const systemMessage = customPrompt || prompts.base || DEFAULT_PROMPTS.base
        const userPrompt = `Category to Rewrite: ${category.toUpperCase()}\n\n--- Current Content ---\n${originalText || '(Empty)'}\n\nPlease provide an improved, highly engaging rewrite for this category.`

        let accumulated = ''

        await spindle.generate.stream(
          {
            messages: [
              { role: 'system', content: systemMessage },
              { role: 'user', content: userPrompt }
            ],
            parameters: {
              temperature: 0.75,
              max_tokens: 2048
            }
          },
          (token: string) => {
            if (isCancelled) return false
            accumulated += token
            spindle.sendToFrontend({ type: 'generate_token', token }, userId)
            return true
          }
        )

        activeGenerations.delete(userId)

        if (isCancelled) {
          spindle.sendToFrontend({ type: 'generate_cancelled' }, userId)
        } else {
          spindle.sendToFrontend({ type: 'generate_done', result: accumulated }, userId)
        }
      } catch (err: any) {
        activeGenerations.delete(userId)
        spindle.sendToFrontend({
          type: 'generate_failed',
          error: err.message || 'Generation failed'
        }, userId)
      }
      break
    }

    case 'generate_cancel': {
      if (activeGenerations.has(userId)) {
        activeGenerations.get(userId)?.cancel()
        activeGenerations.delete(userId)
      }
      spindle.sendToFrontend({ type: 'generate_cancelled' }, userId)
      break
    }
  }
})

spindle.log.info('AI Character Rewriter backend initialized.')
