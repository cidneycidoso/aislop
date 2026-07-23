declare const spindle: import('lumiverse-spindle-types').SpindleAPI

interface SavedPrompt {
  id: string
  title: string
  prompt: string
}

interface SavedVersion {
  id: string
  characterId: string
  field: string
  text: string
  promptUsed: string
  createdAt: string
}

// Helpers for operator-scoped user storage
async function loadUserData<T>(filename: string, userId: string, defaultValue: T): Promise<T> {
  try {
    const data = await spindle.userStorage.readJson<T>(filename, userId)
    return data ?? defaultValue
  } catch {
    return defaultValue
  }
}

async function saveUserData<T>(filename: string, data: T, userId: string): Promise<void> {
  await spindle.userStorage.writeJson(filename, data, userId)
}

// Frontend Message Router
spindle.onFrontendMessage(async (payload: any, userId: string) => {
  if (!userId) return

  switch (payload?.type) {
    // 1. List all character cards
    case 'get_characters': {
      try {
        const characters = await spindle.characters.list({ limit: 200 })
        spindle.sendToFrontend({ type: 'characters_list', characters }, userId)
      } catch (err: any) {
        spindle.sendToFrontend({ type: 'error', message: `Failed to load characters: ${err.message}` }, userId)
      }
      break
    }

    // 2. Fetch stored prompts and saved field versions
    case 'get_initial_data': {
      try {
        const prompts = await loadUserData<SavedPrompt[]>('prompts.json', userId, [])
        const versions = await loadUserData<SavedVersion[]>('versions.json', userId, [])
        spindle.sendToFrontend({ type: 'initial_data', prompts, versions }, userId)
      } catch (err: any) {
        spindle.sendToFrontend({ type: 'error', message: err.message }, userId)
      }
      break
    }

    // 3. Save a custom AI Prompt Template
    case 'save_prompt_template': {
      try {
        const prompts = await loadUserData<SavedPrompt[]>('prompts.json', userId, [])
        const newPrompt: SavedPrompt = {
          id: crypto.randomUUID(),
          title: payload.title,
          prompt: payload.prompt,
        }
        prompts.push(newPrompt)
        await saveUserData('prompts.json', prompts, userId)
        spindle.sendToFrontend({ type: 'prompts_updated', prompts }, userId)
      } catch (err: any) {
        spindle.sendToFrontend({ type: 'error', message: `Failed to save prompt: ${err.message}` }, userId)
      }
      break
    }

    // 4. Delete a saved prompt template
    case 'delete_prompt_template': {
      try {
        let prompts = await loadUserData<SavedPrompt[]>('prompts.json', userId, [])
        prompts = prompts.filter((p) => p.id !== payload.id)
        await saveUserData('prompts.json', prompts, userId)
        spindle.sendToFrontend({ type: 'prompts_updated', prompts }, userId)
      } catch (err: any) {
        spindle.sendToFrontend({ type: 'error', message: err.message }, userId)
      }
      break
    }

    // 5. Send Prompt + Characteristic to AI for Rewrite
    case 'generate_rewrite': {
      try {
        const { characterName, fieldLabel, currentValue, instructions } = payload

        const systemMessage = `You are a master creative writer, roleplay author, and character designer. 
Your task is to rewrite or refine a specific field of a character card based strictly on the user's instructions.
Output ONLY the rewritten text for the field. Do not include introductory notes, markdown codeblock wrappers, or meta-commentary.`

        const userMessage = `Character Name: ${characterName}
Field to Edit: ${fieldLabel}

--- Original Field Content ---
${currentValue || '(Empty)'}

--- Instruction / Prompt ---
${instructions}`

        const result = await spindle.generate.raw({
          messages: [
            { role: 'system', content: systemMessage },
            { role: 'user', content: userMessage },
          ],
          parameters: {
            temperature: 0.75,
            max_tokens: 2048,
          },
        })

        const generatedText = (result.content || '').trim()
        spindle.sendToFrontend({ type: 'rewrite_generated', text: generatedText }, userId)
      } catch (err: any) {
        spindle.sendToFrontend({ type: 'error', message: `AI Generation failed: ${err.message}` }, userId)
      }
      break
    }

    // 6. Save rewrite as a persistent version
    case 'save_version': {
      try {
        const versions = await loadUserData<SavedVersion[]>('versions.json', userId, [])
        const newVersion: SavedVersion = {
          id: crypto.randomUUID(),
          characterId: payload.characterId,
          field: payload.field,
          text: payload.text,
          promptUsed: payload.promptUsed,
          createdAt: new Date().toISOString(),
        }
        versions.unshift(newVersion)
        await saveUserData('versions.json', versions, userId)
        spindle.sendToFrontend({ type: 'versions_updated', versions }, userId)
      } catch (err: any) {
        spindle.sendToFrontend({ type: 'error', message: `Failed to save version: ${err.message}` }, userId)
      }
      break
    }

    // 7. Delete a saved version
    case 'delete_version': {
      try {
        let versions = await loadUserData<SavedVersion[]>('versions.json', userId, [])
        versions = versions.filter((v) => v.id !== payload.id)
        await saveUserData('versions.json', versions, userId)
        spindle.sendToFrontend({ type: 'versions_updated', versions }, userId)
      } catch (err: any) {
        spindle.sendToFrontend({ type: 'error', message: err.message }, userId)
      }
      break
    }

    // 8. Apply saved version directly to original character card
    case 'apply_to_card': {
      try {
        const { characterId, field, newText } = payload
        const char = await spindle.characters.get(characterId)
        if (!char) {
          throw new Error('Character not found')
        }

        const updatePayload: Record<string, any> = {}

        if (field === 'alternate_greetings') {
          // Handle alternate greetings (array of strings)
          const existing = char.alternate_greetings || []
          updatePayload.alternate_greetings = Array.isArray(newText)
            ? newText
            : [newText, ...existing]
        } else {
          updatePayload[field] = newText
        }

        const updatedChar = await spindle.characters.update(characterId, updatePayload)
        
        // Refresh character list for frontend
        const characters = await spindle.characters.list({ limit: 200 })
        spindle.sendToFrontend(
          { type: 'card_applied_success', updatedChar, characters, field },
          userId
        )
      } catch (err: any) {
        spindle.sendToFrontend({ type: 'error', message: `Failed to update character card: ${err.message}` }, userId)
      }
      break
    }
  }
})

spindle.log.info('Character AI Rewriter (Operator Extension) initialized.')
