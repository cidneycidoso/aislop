import type { SpindleFrontendContext } from 'lumiverse-spindle-types'

export function setup(ctx: SpindleFrontendContext) {
  try {
    type CategoryKey =
      | 'description' | 'personality' | 'scenario'
      | 'mes_example' | 'first_mes'
      | `alt_greeting_${number}`

    interface Character {
      id: string
      name: string
      description: string
      personality: string
      scenario: string
      first_mes: string
      mes_example: string
      alternate_greetings: string[]
      image_id: string | null
    }

    interface PromptConfig {
      base: string
    }

    interface VersionStore {
      [charId: string]: {
        [category: string]: string[]
      }
    }

    let selectedChar = ''
    let selectedCategory: CategoryKey = 'description'
    let currentPrompts: PromptConfig = { base: '' }
    let fullCharList: Character[] = []
    let originalTextRaw = ''
    let categoryVariants: string[] = []
    let selectedVersionKey = 'live'
    let savedVersions: VersionStore = {}
    const activeMounts: Array<{ destroy?: () => void }> = []

    async function apiGet<T>(path: string): Promise<T | null> {
      try {
        const res = await fetch(`/api/v1${path}`, { credentials: 'same-origin' })
        if (!res.ok) return null
        return await res.json()
      } catch {
        return null
      }
    }

    async function apiPut<T>(path: string, body: any): Promise<T | null> {
      try {
        const res = await fetch(`/api/v1${path}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify(body),
        })
        if (!res.ok) return null
        return await res.json()
      } catch {
        return null
      }
    }

    const tab = ctx.ui.registerDrawerTab({
      id: 'ai-rewriter',
      title: 'AI Character Rewriter',
      shortName: 'Rewrite',
      iconSvg:
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
    })

    const permissionWarning = document.createElement('div')
    permissionWarning.style.cssText =
      'display:none;padding:16px;margin:16px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.25);border-radius:var(--lumiverse-radius);color:var(--lumiverse-danger);font-size:13px;line-height:1.5;'
    permissionWarning.innerHTML =
      '<strong>Permissions Required.</strong> Please enable Characters, Chats, and Generation access.'
    tab.root.appendChild(permissionWarning)

    const container = document.createElement('div')
    container.style.cssText = 'display:flex;flex-direction:column;gap:16px;padding:16px;'
    tab.root.appendChild(container)

    const charSlot = document.createElement('div')
    container.appendChild(charSlot)
    const charSelect = ctx.components.mountSelect(charSlot, {
      value: '',
      placeholder: 'Loading characters...',
      options: [{ value: '', label: 'Loading characters...' }],
      onChange: (v) => {
        selectedChar = v
        updateCategoryOptions()
        fetchCurrentText()
      },
    })
    activeMounts.push(charSelect)

    const catSlot = document.createElement('div')
    container.appendChild(catSlot)
    const catSelect = ctx.components.mountSelect(catSlot, {
      value: selectedCategory,
      placeholder: 'Select Category',
      options: [
        { value: 'description', label: 'Description' },
        { value: 'personality', label: 'Personality' },
        { value: 'scenario', label: 'Scenario' },
        { value: 'first_mes', label: 'First Message' },
      ],
      onChange: (v) => {
        selectedCategory = v as CategoryKey
        fetchCurrentText()
      },
    })
    activeMounts.push(catSelect)

    function updateCategoryOptions() {
      const char = fullCharList.find((c) => c.id === selectedChar)
      const options: Array<{ value: string; label: string }> = [
        { value: 'description', label: 'Description' },
        { value: 'personality', label: 'Personality' },
        { value: 'scenario', label: 'Scenario' },
        { value: 'mes_example', label: 'Example Messages' },
        { value: 'first_mes', label: 'Main Greeting' },
      ]
      if (char && char.alternate_greetings.length > 0) {
        char.alternate_greetings.forEach((_, idx) => {
          options.push({ value: `alt_greeting_${idx}`, label: `Alt Greeting ${idx + 1}` })
        })
      }
      if (!options.find((o) => o.value === selectedCategory)) {
        selectedCategory = 'description'
      }
      catSelect.update({ options, value: selectedCategory })
    }

    const promptSlot = document.createElement('div')
    container.appendChild(promptSlot)
    const promptSection = ctx.components.mountCollapsibleSection(promptSlot, {
      title: 'Edit AI Instructions',
      defaultExpanded: false,
    })
    const basePromptInput = ctx.components.mountTextArea(promptSection.body, {
      value: '',
      rows: 3,
      placeholder: 'Base System Prompt',
      onChange: (v) => {
        currentPrompts.base = v
      },
    })
    activeMounts.push(basePromptInput)
    const savePromptsBtn = document.createElement('button')
    savePromptsBtn.textContent = 'Save Instructions'
    savePromptsBtn.className = 'btn'
    savePromptsBtn.style.marginTop = '8px'
    savePromptsBtn.addEventListener('click', () => {
      ctx.sendToBackend({ type: 'save_prompts', prompts: currentPrompts })
    })
    promptSection.body.appendChild(savePromptsBtn)

    const currentTextLabel = document.createElement('div')
    currentTextLabel.style.cssText =
      'font-weight:500;font-size:13px;color:var(--lumiverse-text-dim);margin-bottom:-8px;'
    currentTextLabel.textContent = 'Version History / Preview:'
    container.appendChild(currentTextLabel)

    const variantSelectSlot = document.createElement('div')
    variantSelectSlot.style.display = 'none'
    container.appendChild(variantSelectSlot)
    const variantSelect = ctx.components.mountSelect(variantSelectSlot, {
      value: 'live',
      placeholder: 'Select Draft Version',
      options: [{ value: 'live', label: 'Live Card Text' }],
      onChange: (v) => {
        selectedVersionKey = v
        if (v === 'live') {
          currentTextInput.update({ value: originalTextRaw })
          deleteVersionBtn.style.display = 'none'
        } else {
          const idx = parseInt(v, 10)
          currentTextInput.update({ value: categoryVariants[idx] ?? '' })
          deleteVersionBtn.style.display = 'block'
        }
      },
    })
    activeMounts.push(variantSelect)

    const currentTextSlot = document.createElement('div')
    container.appendChild(currentTextSlot)
    const currentTextInput = ctx.components.mountTextArea(currentTextSlot, {
      value: '',
      rows: 5,
      placeholder: 'Select a character card above...',
    })
    activeMounts.push(currentTextInput)

    const currentActionsRow = document.createElement('div')
    currentActionsRow.style.cssText = 'display:flex;gap:8px;margin-top:-8px;'
    container.appendChild(currentActionsRow)

    const saveCurrentBtn = document.createElement('button')
    saveCurrentBtn.textContent = 'Save Current as Version'
    saveCurrentBtn.className = 'btn'
    saveCurrentBtn.style.flex = '1'
    saveCurrentBtn.addEventListener('click', () => {
      if (!selectedChar || !selectedCategory) return
      const text = currentTextInput.getValue()
      if (!savedVersions[selectedChar]) savedVersions[selectedChar] = {}
      if (!savedVersions[selectedChar][selectedCategory]) savedVersions[selectedChar][selectedCategory] = []
      savedVersions[selectedChar][selectedCategory].push(text)
      ctx.sendToBackend({ type: 'save_versions', versions: savedVersions })
      categoryVariants = savedVersions[selectedChar][selectedCategory]
      renderVariantsDropdown()
      selectedVersionKey = (categoryVariants.length - 1).toString()
      variantSelect.update({ value: selectedVersionKey })
      currentTextInput.update({ value: categoryVariants[categoryVariants.length - 1] })
      deleteVersionBtn.style.display = 'block'
    })
    currentActionsRow.appendChild(saveCurrentBtn)

    const applyBtn = document.createElement('button')
    applyBtn.textContent = 'Apply Selected to Card'
    applyBtn.className = 'btn'
    applyBtn.style.cssText = 'background:var(--lumiverse-success);color:white;flex:1;'
    applyBtn.addEventListener('click', async () => {
      if (!selectedChar) return
      const text = currentTextInput.getValue()
      const char = fullCharList.find((c) => c.id === selectedChar)
      if (!char) return
      const body: any = {}
      if (selectedCategory.startsWith('alt_greeting_')) {
        const idx = parseInt(selectedCategory.replace('alt_greeting_', ''), 10)
        const greetings = [...char.alternate_greetings]
        greetings[idx] = text
        body.alternate_greetings = greetings
      } else {
        body[selectedCategory] = text
      }
      const result = await apiPut<Character>(`/characters/${selectedChar}`, body)
      if (result) {
        originalTextRaw = text
        const idx = fullCharList.findIndex((c) => c.id === selectedChar)
        if (idx >= 0) fullCharList[idx] = result
        selectedVersionKey = 'live'
        renderVariantsDropdown()
        currentTextInput.update({ value: originalTextRaw })
        ctx.messages.show('Applied to character card!', 'success')
      } else {
        ctx.messages.show('Failed to apply to character card.', 'error')
      }
    })
    currentActionsRow.appendChild(applyBtn)

    const deleteVersionBtn = document.createElement('button')
    deleteVersionBtn.textContent = 'Delete Version'
    deleteVersionBtn.className = 'btn'
    deleteVersionBtn.style.cssText =
      'background:var(--lumiverse-danger);color:white;margin-top:-8px;display:none;'
    deleteVersionBtn.addEventListener('click', () => {
      if (selectedVersionKey !== 'live' && selectedChar && selectedCategory) {
        const idx = parseInt(selectedVersionKey, 10)
        if (savedVersions[selectedChar]?.[selectedCategory]) {
          savedVersions[selectedChar][selectedCategory].splice(idx, 1)
          if (savedVersions[selectedChar][selectedCategory].length === 0) {
            delete savedVersions[selectedChar][selectedCategory]
          }
          ctx.sendToBackend({ type: 'save_versions', versions: savedVersions })
          categoryVariants = savedVersions[selectedChar]?.[selectedCategory] ?? []
          selectedVersionKey = 'live'
          renderVariantsDropdown()
          currentTextInput.update({ value: originalTextRaw })
        }
      }
    })
    container.appendChild(deleteVersionBtn)

    const aiDivider = document.createElement('div')
    aiDivider.style.cssText = 'border-top:1px solid var(--lumiverse-border);margin:8px 0;'
    container.appendChild(aiDivider)

    const generateBtn = document.createElement('button')
    generateBtn.textContent = 'Rewrite with AI'
    generateBtn.className = 'btn'
    generateBtn.style.cssText = 'background:var(--lumiverse-primary);color:white;'
    generateBtn.addEventListener('click', () => {
      if (!selectedChar) return
      const char = fullCharList.find((c) => c.id === selectedChar)
      if (!char) return
      generateBtn.textContent = 'Generating...'
      generateBtn.disabled = true
      const categoryLabel = getCategoryLabel(selectedCategory)
      const prompt = `Character Name: ${char.name}
Character Description: ${char.description || 'N/A'}
Character Personality: ${char.personality || 'N/A'}

Please rewrite the following ${categoryLabel} for this character:

---
${currentTextInput.getValue() || '(empty)'}
---`
      ctx.sendToBackend({ type: 'generate', prompt })
    })
    container.appendChild(generateBtn)

    const resultSlot = document.createElement('div')
    container.appendChild(resultSlot)
    const resultInput = ctx.components.mountTextArea(resultSlot, {
      value: '',
      rows: 5,
      placeholder: 'AI suggestion will appear here...',
    })
    activeMounts.push(resultInput)

    const saveResultBtn = document.createElement('button')
    saveResultBtn.textContent = 'Save AI Result as Version'
    saveResultBtn.className = 'btn'
    saveResultBtn.style.display = 'none'
    saveResultBtn.addEventListener('click', () => {
      if (!selectedChar || !selectedCategory) return
      const text = resultInput.getValue()
      if (!savedVersions[selectedChar]) savedVersions[selectedChar] = {}
      if (!savedVersions[selectedChar][selectedCategory]) savedVersions[selectedChar][selectedCategory] = []
      savedVersions[selectedChar][selectedCategory].push(text)
      ctx.sendToBackend({ type: 'save_versions', versions: savedVersions })
      categoryVariants = savedVersions[selectedChar][selectedCategory]
      renderVariantsDropdown()
      selectedVersionKey = (categoryVariants.length - 1).toString()
      variantSelect.update({ value: selectedVersionKey })
      currentTextInput.update({ value: text })
      resultInput.update({ value: '' })
      saveResultBtn.style.display = 'none'
      deleteVersionBtn.style.display = 'block'
    })
    container.appendChild(saveResultBtn)

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

    function getCategoryText(char: Character, category: string): string {
      if (category.startsWith('alt_greeting_')) {
        const idx = parseInt(category.replace('alt_greeting_', ''), 10)
        return char.alternate_greetings?.[idx] ?? ''
      }
      return (char as any)[category] ?? ''
    }

    function fetchCurrentText() {
      if (!selectedChar || !selectedCategory) return
      const char = fullCharList.find((c) => c.id === selectedChar)
      if (!char) return
      originalTextRaw = getCategoryText(char, selectedCategory)
      categoryVariants = savedVersions[selectedChar]?.[selectedCategory] ?? []
      selectedVersionKey = 'live'
      currentTextInput.update({ value: originalTextRaw })
      resultInput.update({ value: '' })
      saveResultBtn.style.display = 'none'
      renderVariantsDropdown()
    }

    function renderVariantsDropdown() {
      const variantOptions = [{ value: 'live', label: 'Live Card Text' }]
      categoryVariants.forEach((_, i) => {
        variantOptions.push({ value: i.toString(), label: `Saved Version ${i + 1}` })
      })
      variantSelectSlot.style.display = 'block'
      variantSelect.update({ options: variantOptions, value: selectedVersionKey })
      deleteVersionBtn.style.display = selectedVersionKey === 'live' ? 'none' : 'block'
    }

    async function loadCharacters() {
      charSelect.update({
        placeholder: 'Loading characters...',
        options: [{ value: '', label: 'Loading characters...' }],
      })
      const data = await apiGet<{ data: Character[]; total: number }>(
        '/characters?limit=200&offset=0'
      )
      if (!data || !data.data) {
        charSelect.update({ placeholder: 'Error loading characters', options: [] })
        currentTextInput.update({ value: 'Failed to load characters from API.' })
        return
      }
      fullCharList = data.data
      const currentUrl = window.location.pathname + window.location.hash
      const match = currentUrl.match(/\/(characters|chat)\/([a-zA-Z0-9_-]+)/)
      let activeCharId = ''
      if (match && match[1] === 'characters') {
        activeCharId = match[2]
      } else if (match && match[1] === 'chat') {
        const chat = await apiGet<{ character_id: string }>(`/chats/${match[2]}`)
        if (chat?.character_id) activeCharId = chat.character_id
      }
      if (!activeCharId && fullCharList.length > 0) {
        activeCharId = fullCharList[0].id
      }
      selectedChar = activeCharId
      charSelect.update({
        value: selectedChar,
        placeholder: 'Select Character',
        searchPlaceholder: 'Search...',
        options: fullCharList.map((c) => ({
          value: c.id,
          label: c.name,
          leading: c.image_id
            ? { type: 'image' as const, src: `/api/v1/images/${c.image_id}?size=sm` }
            : undefined,
        })),
      })
      updateCategoryOptions()
      if (selectedChar) fetchCurrentText()
    }

    ctx.onBackendMessage((payload: any) => {
      switch (payload.type) {
        case 'prompts_data': {
          currentPrompts = payload.prompts
          basePromptInput.update({ value: currentPrompts.base })
          break
        }
        case 'versions_data': {
          savedVersions = payload.versions || {}
          if (selectedChar && selectedCategory) {
            categoryVariants = savedVersions[selectedChar]?.[selectedCategory] ?? []
            renderVariantsDropdown()
          }
          break
        }
        case 'generate_result': {
          generateBtn.textContent = 'Rewrite with AI'
          generateBtn.disabled = false
          resultInput.update({ value: payload.result })
          saveResultBtn.style.display = 'block'
          break
        }
        case 'generate_failed': {
          generateBtn.textContent = 'Rewrite with AI'
          generateBtn.disabled = false
          ctx.messages.show(`Generation failed: ${payload.error}`, 'error')
          break
        }
      }
    })

    const unsubTabActivate = tab.onActivate(() => {
      loadCharacters()
      ctx.sendToBackend({ type: 'get_prompts' })
      ctx.sendToBackend({ type: 'get_versions' })
    })

    loadCharacters()
    ctx.sendToBackend({ type: 'get_prompts' })
    ctx.sendToBackend({ type: 'get_versions' })

    return () => {
      tab.destroy()
      unsubTabActivate()
      activeMounts.forEach((m) => m?.destroy?.())
    }
  } catch (err: any) {
    console.error('[AI Rewriter] FATAL setup error:', err?.message ?? err, err?.stack)
    throw err
  }
}
