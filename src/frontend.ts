import type { SpindleFrontendContext } from 'lumiverse-spindle-types'

async function apiFetch(path: string, options: RequestInit = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  })
  const text = await res.text()
  let body: any = null
  if (text) {
    try { body = JSON.parse(text) } catch { body = text }
  }
  if (!res.ok) {
    const detail = (body && typeof body === 'object' && body.error) ? body.error : (typeof body === 'string' && body ? body : res.statusText)
    throw new Error(`${res.status} ${detail}`)
  }
  return body
}

async function fetchAllCharactersFromApi(): Promise<any[]> {
  const byId = new Map<string, any>()
  let offset = 0
  const limit = 200
  let page = 1
  const MAX_PAGES = 100

  while (page <= MAX_PAGES) {
    const result = await apiFetch(`/api/v1/characters?limit=${limit}&offset=${offset}&page=${page}`)
    const data = Array.isArray(result) ? result : (result?.data ?? [])
    const total = Array.isArray(result) ? undefined : result?.total

    if (!data.length) break

    const beforeCount = byId.size
    for (const c of data) byId.set(c.id, c)
    const newCount = byId.size - beforeCount

    if (newCount === 0) break

    if (data.length < limit || (typeof total === 'number' && byId.size >= total)) {
      break
    }

    offset += limit
    page += 1
  }

  return Array.from(byId.values())
}

async function resolveActiveCharId(routeType: string | null, routeId: string | null): Promise<string | null> {
  if (routeType === 'characters' && routeId) return routeId

  if (routeType === 'chat' && routeId) {
    try {
      const chat = await apiFetch(`/api/v1/chats/${routeId}`)
      if (chat?.character_id) return chat.character_id
    } catch (err) {
      console.warn('[AI Character Rewriter] Could not resolve character from chat route:', err)
    }
  }

  try {
    const activeChat = await apiFetch('/api/v1/chats/active')
    if (activeChat?.character_id) return activeChat.character_id
  } catch {
    // No active chat
  }

  return null
}

export function setup(ctx: SpindleFrontendContext) {
  const tab = ctx.ui.registerDrawerTab({
    id: 'ai-rewriter',
    title: 'AI Character Rewriter',
    shortName: 'Rewrite',
    iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>'
  })

  const unsubTabActivate = tab.onActivate(() => {
    loadEverything()
  })

  const permissionWarning = document.createElement('div')
  permissionWarning.style.cssText = 'display:none; padding:16px; margin:16px; background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.25); border-radius:var(--lumiverse-radius); color:var(--lumiverse-danger); font-size:13px; line-height:1.5;'
  tab.root.appendChild(permissionWarning)

  const container = document.createElement('div')
  container.style.cssText = 'display:flex;flex-direction:column;gap:16px;padding:16px;'
  tab.root.appendChild(container)

  let selectedChar = ''
  let selectedCategory = 'description'
  let currentPrompts: any = {}
  let fullCharList: any[] = []
  let hasGeneration = true

  let originalTextRaw = ''
  let categoryVariants: string[] = []
  let selectedVersionKey = 'live'

  let currentTextVal = ''
  let resultTextVal = ''

  const activeMounts: any[] = []
  const WATCHDOG_MS = 15000
  let statusRequestSeq = 0

  // 1. CHARACTER SELECT
  const charSlot = document.createElement('div')
  container.appendChild(charSlot)
  const charSelect = ctx.components.mountSelect(charSlot, {
    value: '', placeholder: "Loading characters...", options: [{ value: '', label: 'Loading characters...' }],
    onChange: (v) => {
      selectedChar = v
      updateCategoryOptions()
      loadCurrentText()
    }
  })
  activeMounts.push(charSelect)

  // 2. CATEGORY SELECT
  const catSlot = document.createElement('div')
  container.appendChild(catSlot)
  const catSelect = ctx.components.mountSelect(catSlot, {
    value: selectedCategory,
    placeholder: "Select Category",
    options: [
      { value: 'description', label: 'Description' },
      { value: 'personality', label: 'Personality' },
      { value: 'scenario', label: 'Scenario' },
      { value: 'first_mes', label: 'First Message' }
    ],
    onChange: (v) => { selectedCategory = v; loadCurrentText() }
  })
  activeMounts.push(catSelect)

  function updateCategoryOptions() {
    const char = fullCharList.find(c => c.id === selectedChar)
    const options = [
      { value: 'description', label: 'Description' },
      { value: 'personality', label: 'Personality' },
      { value: 'scenario', label: 'Scenario' },
      { value: 'mes_example', label: 'Example Messages' },
      { value: 'first_mes', label: 'Main Greeting' }
    ]

    if (char && char.alternate_greetings && char.alternate_greetings.length > 0) {
      char.alternate_greetings.forEach((_: any, idx: number) => {
        options.push({ value: `alt_greeting_${idx}`, label: `Alt Greeting ${idx + 1}` })
      })
    }

    if (!options.find(o => o.value === selectedCategory)) selectedCategory = 'description'
    catSelect.update({ options, value: selectedCategory })
  }

  // 3. PROMPTS
  const promptSlot = document.createElement('div')
  container.appendChild(promptSlot)
  const promptSection = ctx.components.mountCollapsibleSection(promptSlot, {
    title: 'Edit AI Instructions', defaultExpanded: true
  })
  const basePromptInput = ctx.components.mountTextArea(promptSection.body, {
    value: '', rows: 3, placeholder: 'Base System Prompt', onChange: (v) => { currentPrompts.base = v }
  })
  activeMounts.push(basePromptInput)

  const savePromptsBtn = document.createElement('button')
  savePromptsBtn.textContent = 'Save Instructions'
  savePromptsBtn.className = 'btn'
  savePromptsBtn.style.marginTop = '8px'
  savePromptsBtn.onclick = () => ctx.sendToBackend({ type: 'save_prompts', prompts: currentPrompts })
  promptSection.body.appendChild(savePromptsBtn)

  // 4. TEXT VIEWER
  const currentTextLabel = document.createElement('div')
  currentTextLabel.style.cssText = 'font-weight: 500; font-size: 13px; color: var(--lumiverse-text-dim); margin-bottom: -8px;'
  currentTextLabel.textContent = "Version History / Preview:"
  container.appendChild(currentTextLabel)

  const variantSelectSlot = document.createElement('div')
  variantSelectSlot.style.display = 'none'
  container.appendChild(variantSelectSlot)

  const variantSelect = ctx.components.mountSelect(variantSelectSlot, {
    value: 'live', placeholder: "Select Draft Version", options: [{ value: 'live', label: 'Live Card Text' }],
    onChange: (v) => {
      selectedVersionKey = v
      if (v === 'live') {
        currentTextVal = originalTextRaw
        currentTextInput.update({ value: currentTextVal })
        deleteVersionBtn.style.display = 'none'
      } else {
        const idx = parseInt(v, 10)
        currentTextVal = categoryVariants[idx] || ''
        currentTextInput.update({ value: currentTextVal })
        deleteVersionBtn.style.display = 'block'
      }
    }
  })
  activeMounts.push(variantSelect)

  const currentTextSlot = document.createElement('div')
  container.appendChild(currentTextSlot)
  const currentTextInput = ctx.components.mountTextArea(currentTextSlot, {
    value: '', rows: 5, placeholder: 'Select a character card above...',
    onChange: (v) => { currentTextVal = v }
  })
  activeMounts.push(currentTextInput)

  const currentActionsRow = document.createElement('div')
  currentActionsRow.style.cssText = 'display:flex;gap:8px;margin-top:-8px;'
  container.appendChild(currentActionsRow)

  const saveCurrentBtn = document.createElement('button')
  saveCurrentBtn.textContent = 'Save Current as Version'
  saveCurrentBtn.className = 'btn'
  saveCurrentBtn.style.flex = '1'
  saveCurrentBtn.onclick = () => saveVersion(currentTextVal)
  currentActionsRow.appendChild(saveCurrentBtn)

  const applyBtn = document.createElement('button')
  applyBtn.textContent = 'Apply Selected to Card'
  applyBtn.className = 'btn'
  applyBtn.style.cssText = 'background: var(--lumiverse-success); color: white; flex: 1;'
  applyBtn.onclick = () => applyVersion(currentTextVal)
  currentActionsRow.appendChild(applyBtn)

  const deleteVersionBtn = document.createElement('button')
  deleteVersionBtn.textContent = 'Delete Version'
  deleteVersionBtn.className = 'btn'
  deleteVersionBtn.style.cssText = 'background: var(--lumiverse-danger); color: white; margin-top:-8px; display:none;'
  deleteVersionBtn.onclick = () => {
    if (selectedVersionKey !== 'live') deleteVersion(parseInt(selectedVersionKey, 10))
  }
  container.appendChild(deleteVersionBtn)

  // 5. GENERATOR
  const aiDivider = document.createElement('div')
  aiDivider.style.cssText = 'border-top: 1px solid var(--lumiverse-border); margin: 8px 0;'
  container.appendChild(aiDivider)

  let isGenerating = false
  let streamedText = ''

  const generateBtn = document.createElement('button')
  generateBtn.textContent = 'Rewrite with AI'
  generateBtn.className = 'btn'
  generateBtn.style.cssText = 'background: var(--lumiverse-primary); color: white;'
  generateBtn.onclick = () => {
    if (!selectedChar) return

    if (isGenerating) {
      generateBtn.disabled = true
      generateBtn.textContent = 'Cancelling...'
      ctx.sendToBackend({ type: 'generate_cancel' })
      return
    }

    isGenerating = true
    streamedText = ''
    resultTextVal = ''
    resultInput.update({ value: '' })
    saveResultBtn.style.display = 'none'
    generateBtn.textContent = 'Stop Generating'
    ctx.sendToBackend({
      type: 'generate', characterId: selectedChar, category: selectedCategory, originalText: currentTextVal
    })
  }
  container.appendChild(generateBtn)

  const resultSlot = document.createElement('div')
  container.appendChild(resultSlot)
  const resultInput = ctx.components.mountTextArea(resultSlot, {
    value: '', rows: 5, placeholder: 'AI suggestion will appear here...',
    onChange: (v) => { resultTextVal = v }
  })
  activeMounts.push(resultInput)

  const saveResultBtn = document.createElement('button')
  saveResultBtn.textContent = 'Save AI Result as Version'
  saveResultBtn.className = 'btn'
  saveResultBtn.style.cssText = 'display: none;'
  saveResultBtn.onclick = () => saveVersion(resultTextVal)
  container.appendChild(saveResultBtn)

  function loadCurrentText() {
    const char = fullCharList.find(c => c.id === selectedChar)
    if (!char) {
      currentTextVal = 'Select a character card above...'
      currentTextInput.update({ value: currentTextVal })
      variantSelectSlot.style.display = 'none'
      deleteVersionBtn.style.display = 'none'
      return
    }

    let text = ""
    if (selectedCategory.startsWith('alt_greeting_')) {
      const idx = parseInt(selectedCategory.replace('alt_greeting_', ''), 10)
      text = (char.alternate_greetings || [])[idx] || ""
    } else {
      text = char[selectedCategory] || ""
    }

    const extData = char.extensions?.['char_rewriter'] || {}
    categoryVariants = extData.variants?.[selectedCategory] || []
    originalTextRaw = text
    selectedVersionKey = 'live'

    currentTextVal = originalTextRaw
    currentTextInput.update({ value: currentTextVal })
    resultTextVal = ''
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

  function saveVersion(text: string) {
    if (!selectedChar) {
      alert('Please select a character first.')
      return
    }
    ctx.sendToBackend({
      type: 'save_version',
      characterId: selectedChar,
      category: selectedCategory,
      text
    })
  }

  function deleteVersion(index: number) {
    if (!selectedChar) return
    ctx.sendToBackend({
      type: 'delete_version',
      characterId: selectedChar,
      category: selectedCategory,
      index
    })
  }

  function applyVersion(text: string) {
    if (!selectedChar) {
      alert('Please select a character first.')
      return
    }
    ctx.sendToBackend({
      type: 'apply_version',
      characterId: selectedChar,
      category: selectedCategory,
      text
    })
  }

  const unsubPermissions = ctx.events.on('PERMISSION_CHANGED', () => { loadEverything() })

  ctx.onBackendMessage((payload: any) => {
    if (payload.type === 'error') {
      alert(`Error: ${payload.error}`)
      return
    }

    if (payload.type === 'status_result') {
      statusRequestSeq++
      hasGeneration = payload.hasGeneration
      currentPrompts = payload.prompts
      basePromptInput.update({ value: currentPrompts.base })
      generateBtn.style.display = hasGeneration ? 'block' : 'none'
      if (!hasGeneration) {
        permissionWarning.style.display = 'block'
        permissionWarning.innerHTML = `<strong>Generation permission not granted.</strong> AI rewriting is disabled until it's enabled in the extension's permissions.`
      } else {
        permissionWarning.style.display = 'none'
      }
      return
    }

    if (payload.type === 'status_error') {
      statusRequestSeq++
      permissionWarning.style.display = 'block'
      permissionWarning.innerHTML = `<strong>Backend error:</strong> ${payload.error}`
      return
    }

    if (payload.type === 'prompts_updated') {
      currentPrompts = payload.prompts
      basePromptInput.update({ value: currentPrompts.base })
    }

    if (payload.type === 'version_saved') {
      if (payload.characterId === selectedChar) {
        const cached = fullCharList.find(c => c.id === selectedChar)
        if (cached) {
          if (!cached.extensions) cached.extensions = {}
          if (!cached.extensions.char_rewriter) cached.extensions.char_rewriter = { variants: {} }
          if (!cached.extensions.char_rewriter.variants) cached.extensions.char_rewriter.variants = {}
          cached.extensions.char_rewriter.variants[payload.category] = payload.variants
        }

        if (payload.category === selectedCategory) {
          categoryVariants = payload.variants || []
          selectedVersionKey = categoryVariants.length > 0 ? (categoryVariants.length - 1).toString() : 'live'
          currentTextVal = categoryVariants.length > 0 ? categoryVariants[categoryVariants.length - 1] : originalTextRaw
          currentTextInput.update({ value: currentTextVal })
          resultTextVal = ''
          resultInput.update({ value: '' })
          saveResultBtn.style.display = 'none'
          renderVariantsDropdown()
        }
      }
      return
    }

    if (payload.type === 'version_deleted') {
      if (payload.characterId === selectedChar) {
        const cached = fullCharList.find(c => c.id === selectedChar)
        if (cached?.extensions?.char_rewriter?.variants) {
          cached.extensions.char_rewriter.variants[payload.category] = payload.variants
        }

        if (payload.category === selectedCategory) {
          categoryVariants = payload.variants || []
          selectedVersionKey = 'live'
          currentTextVal = originalTextRaw
          currentTextInput.update({ value: currentTextVal })
          renderVariantsDropdown()
        }
      }
      return
    }

    if (payload.type === 'version_applied') {
      if (payload.characterId === selectedChar) {
        const appliedText = payload.text ?? currentTextVal
        const cached = fullCharList.find(c => c.id === selectedChar)

        if (cached) {
          if (payload.category.startsWith('alt_greeting_')) {
            const idx = parseInt(payload.category.replace('alt_greeting_', ''), 10)
            if (!cached.alternate_greetings) cached.alternate_greetings = []
            cached.alternate_greetings[idx] = appliedText
          } else {
            cached[payload.category] = appliedText
          }
        }

        if (payload.category === selectedCategory) {
          originalTextRaw = appliedText
          selectedVersionKey = 'live'
          renderVariantsDropdown()
          currentTextVal = originalTextRaw
          currentTextInput.update({ value: currentTextVal })
        }
      }
      return
    }

    if (payload.type === 'generate_token') {
      streamedText += payload.token
      resultTextVal = streamedText
      resultInput.update({ value: streamedText })
    }

    if (payload.type === 'generate_done') {
      isGenerating = false
      generateBtn.textContent = 'Rewrite with AI'
      generateBtn.disabled = false
      resultTextVal = payload.result
      resultInput.update({ value: payload.result })
      saveResultBtn.style.display = 'block'
    }

    if (payload.type === 'generate_cancelled') {
      isGenerating = false
      generateBtn.textContent = 'Rewrite with AI'
      generateBtn.disabled = false
      if (streamedText) saveResultBtn.style.display = 'block'
    }

    if (payload.type === 'generate_failed') {
      isGenerating = false
      generateBtn.textContent = 'Rewrite with AI'
      generateBtn.disabled = false
    }
  })

  function requestStatus() {
    const seq = ++statusRequestSeq
    ctx.sendToBackend({ type: 'get_status' })
    setTimeout(() => {
      if (seq === statusRequestSeq) {
        permissionWarning.style.display = 'block'
        permissionWarning.innerHTML = `<strong>Backend didn't respond.</strong> AI rewriting and saved instructions may be unavailable — try reopening this tab.`
      }
    }, WATCHDOG_MS)
  }

  async function loadEverything() {
    charSelect.update({ placeholder: "Loading characters...", options: [{ value: '', label: 'Loading characters...' }] })

    requestStatus()

    try {
      const currentUrl = window.location.pathname + window.location.hash
      const match = currentUrl.match(/\/(characters|chat)\/([a-zA-Z0-9_-]+)/)
      const routeType = match ? match[1] : null
      const routeId = match ? match[2] : null

      const [chars, activeId] = await Promise.all([
        fetchAllCharactersFromApi(),
        resolveActiveCharId(routeType, routeId)
      ])

      fullCharList = chars
      selectedChar = activeId || (chars[0]?.id ?? '')

      charSelect.update({
        value: selectedChar, placeholder: "Select Character", searchPlaceholder: "Search...",
        options: chars.map((c: any) => ({
          value: c.id, label: c.name, leading: c.image_id ? { type: 'image', src: `/api/v1/images/${c.image_id}?size=sm` } : undefined
        }))
      })

      updateCategoryOptions()
      if (selectedChar) loadCurrentText()
    } catch (err: any) {
      charSelect.update({ placeholder: "Error loading characters", options: [] })
      currentTextVal = `Couldn't load characters: ${err?.message || err}`
      currentTextInput.update({ value: currentTextVal })
    }
  }

  loadEverything()

  return () => {
    tab.destroy()
    unsubPermissions()
    unsubTabActivate()
    activeMounts.forEach(m => m?.destroy?.())
  }
}
