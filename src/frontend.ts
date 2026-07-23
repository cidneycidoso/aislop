import type { SpindleFrontendContext } from 'lumiverse-spindle-types'

// --- REST API HELPER ---
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
    try {
      const result = await apiFetch(`/api/v1/characters?limit=${limit}&offset=${offset}&page=${page}`)
      const data = Array.isArray(result) ? result : (result?.data ?? [])
      const total = Array.isArray(result) ? undefined : result?.total

      if (!data.length) break

      const beforeCount = byId.size
      for (const c of data) byId.set(c.id, c)
      const newCount = byId.size - beforeCount

      if (newCount === 0) break
      if (data.length < limit || (typeof total === 'number' && byId.size >= total)) break

      offset += limit
      page += 1
    } catch (e) {
      console.warn('[AI Rewriter] Page fetch error:', e)
      break
    }
  }

  return Array.from(byId.values())
}

async function resolveActiveCharId(routeType: string | null, routeId: string | null): Promise<string | null> {
  if (routeType === 'characters' && routeId) return routeId

  if (routeType === 'chat' && routeId) {
    try {
      const chat = await apiFetch(`/api/v1/chats/${routeId}`)
      if (chat?.character_id) return chat.character_id
    } catch {
      // Non-fatal fallback
    }
  }

  try {
    const activeChat = await apiFetch('/api/v1/chats/active')
    if (activeChat?.character_id) return activeChat.character_id
  } catch {
    // Non-fatal fallback
  }

  return null
}

export function setup(ctx: SpindleFrontendContext) {
  let tab: any = null
  try {
    tab = ctx.ui.registerDrawerTab({
      id: 'ai-rewriter',
      title: 'AI Character Rewriter',
      shortName: 'Rewrite',
      iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>'
    })
  } catch (err) {
    console.error('[AI Rewriter] Failed to register drawer tab:', err)
    return () => {}
  }

  if (!tab || !tab.root) return () => {}

  // Styling helper for consistent Lumiverse UI elements
  const inputStyle = 'width:100%; padding:8px 12px; border-radius:var(--lumiverse-radius, 6px); border:1px solid var(--lumiverse-border, #333); background:var(--lumiverse-bg-secondary, #1e1e1e); color:var(--lumiverse-text, #fff); font-size:13px; font-family:inherit; box-sizing:border-box;'
  const btnStyle = 'padding:8px 14px; border-radius:var(--lumiverse-radius, 6px); border:none; cursor:pointer; font-weight:600; font-size:13px; font-family:inherit; transition:opacity 0.2s;'

  const container = document.createElement('div')
  container.style.cssText = 'display:flex; flex-direction:column; gap:14px; padding:16px; box-sizing:border-box;'
  tab.root.appendChild(container)

  const permissionWarning = document.createElement('div')
  permissionWarning.style.cssText = 'display:none; padding:12px; background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.25); border-radius:var(--lumiverse-radius, 6px); color:var(--lumiverse-danger, #ef4444); font-size:13px; line-height:1.4;'
  container.appendChild(permissionWarning)

  let selectedChar = ''
  let selectedCategory = 'description'
  let currentPrompts: any = {}
  let fullCharList: any[] = []
  let hasGeneration = true

  let originalTextRaw = ''
  let categoryVariants: string[] = []
  let selectedVersionKey = 'live'
  let statusRequestSeq = 0
  const WATCHDOG_MS = 15000

  // 1. CHARACTER SELECT
  const charSelect = document.createElement('select')
  charSelect.style.cssText = inputStyle
  charSelect.innerHTML = '<option value="">Loading characters...</option>'
  charSelect.onchange = () => {
    selectedChar = charSelect.value
    updateCategoryOptions()
    loadCurrentText().catch(console.error)
  }
  container.appendChild(charSelect)

  // 2. CATEGORY SELECT
  const catSelect = document.createElement('select')
  catSelect.style.cssText = inputStyle
  catSelect.onchange = () => {
    selectedCategory = catSelect.value
    loadCurrentText().catch(console.error)
  }
  container.appendChild(catSelect)

  function updateCategoryOptions() {
    const char = fullCharList.find(c => c.id === selectedChar)
    const options = [
      { value: 'description', label: 'Description' },
      { value: 'personality', label: 'Personality' },
      { value: 'scenario', label: 'Scenario' },
      { value: 'mes_example', label: 'Example Messages' },
      { value: 'first_mes', label: 'Main Greeting' }
    ]

    if (char?.alternate_greetings && Array.isArray(char.alternate_greetings)) {
      char.alternate_greetings.forEach((_: any, idx: number) => {
        options.push({ value: `alt_greeting_${idx}`, label: `Alt Greeting ${idx + 1}` })
      })
    }

    if (!options.find(o => o.value === selectedCategory)) selectedCategory = 'description'
    catSelect.innerHTML = ''
    options.forEach(o => {
      const opt = document.createElement('option')
      opt.value = o.value
      opt.textContent = o.label
      if (o.value === selectedCategory) opt.selected = true
      catSelect.appendChild(opt)
    })
  }

  // 3. PROMPTS SECTION (COLLAPSIBLE)
  const details = document.createElement('details')
  details.open = false
  details.style.cssText = 'border:1px solid var(--lumiverse-border, #333); border-radius:var(--lumiverse-radius, 6px); padding:8px 12px; background:var(--lumiverse-bg-secondary, #1e1e1e);'
  
  const summary = document.createElement('summary')
  summary.textContent = 'Edit AI Instructions'
  summary.style.cssText = 'cursor:pointer; font-weight:600; font-size:13px; color:var(--lumiverse-text, #fff); user-select:none;'
  details.appendChild(summary)

  const promptBody = document.createElement('div')
  promptBody.style.cssText = 'margin-top:8px; display:flex; flex-direction:column; gap:8px;'

  const basePromptInput = document.createElement('textarea')
  basePromptInput.rows = 3
  basePromptInput.placeholder = 'Base System Prompt'
  basePromptInput.style.cssText = inputStyle + ' resize:vertical;'
  basePromptInput.oninput = () => { currentPrompts.base = basePromptInput.value }
  promptBody.appendChild(basePromptInput)

  const savePromptsBtn = document.createElement('button')
  savePromptsBtn.textContent = 'Save Instructions'
  savePromptsBtn.style.cssText = btnStyle + ' background:var(--lumiverse-bg-elevated, #2a2a2a); color:var(--lumiverse-text, #fff); align-self:flex-start;'
  savePromptsBtn.onclick = () => ctx.sendToBackend({ type: 'save_prompts', prompts: currentPrompts })
  promptBody.appendChild(savePromptsBtn)

  details.appendChild(promptBody)
  container.appendChild(details)

  // 4. VERSION HISTORY & TEXT PREVIEW
  const currentTextLabel = document.createElement('div')
  currentTextLabel.style.cssText = 'font-weight:500; font-size:13px; color:var(--lumiverse-text-dim, #aaa); margin-bottom:-6px;'
  currentTextLabel.textContent = "Version History / Preview:"
  container.appendChild(currentTextLabel)

  const variantSelect = document.createElement('select')
  variantSelect.style.cssText = inputStyle + ' display:none;'
  variantSelect.onchange = () => {
    selectedVersionKey = variantSelect.value
    if (selectedVersionKey === 'live') {
      currentTextInput.value = originalTextRaw
      deleteVersionBtn.style.display = 'none'
    } else {
      const idx = parseInt(selectedVersionKey, 10)
      currentTextInput.value = categoryVariants[idx] || ''
      deleteVersionBtn.style.display = 'block'
    }
  }
  container.appendChild(variantSelect)

  const currentTextInput = document.createElement('textarea')
  currentTextInput.rows = 5
  currentTextInput.placeholder = 'Select a character card above...'
  currentTextInput.style.cssText = inputStyle + ' resize:vertical;'
  container.appendChild(currentTextInput)

  const currentActionsRow = document.createElement('div')
  currentActionsRow.style.cssText = 'display:flex; gap:8px;'
  container.appendChild(currentActionsRow)

  const saveCurrentBtn = document.createElement('button')
  saveCurrentBtn.textContent = 'Save Current as Version'
  saveCurrentBtn.style.cssText = btnStyle + ' flex:1; background:var(--lumiverse-bg-elevated, #2a2a2a); color:var(--lumiverse-text, #fff);'
  saveCurrentBtn.onclick = () => saveVersion(currentTextInput.value)
  currentActionsRow.appendChild(saveCurrentBtn)

  const applyBtn = document.createElement('button')
  applyBtn.textContent = 'Apply Selected to Card'
  applyBtn.style.cssText = btnStyle + ' flex:1; background:var(--lumiverse-success, #22c55e); color:#fff;'
  applyBtn.onclick = () => applyVersion(currentTextInput.value)
  currentActionsRow.appendChild(applyBtn)

  const deleteVersionBtn = document.createElement('button')
  deleteVersionBtn.textContent = 'Delete Version'
  deleteVersionBtn.style.cssText = btnStyle + ' background:var(--lumiverse-danger, #ef4444); color:#fff; display:none;'
  deleteVersionBtn.onclick = () => {
    if (selectedVersionKey !== 'live') deleteVersion(parseInt(selectedVersionKey, 10))
  }
  container.appendChild(deleteVersionBtn)

  // 5. AI GENERATOR
  const aiDivider = document.createElement('div')
  aiDivider.style.cssText = 'border-top:1px solid var(--lumiverse-border, #333); margin:4px 0;'
  container.appendChild(aiDivider)

  let isGenerating = false
  let streamedText = ''

  const generateBtn = document.createElement('button')
  generateBtn.textContent = 'Rewrite with AI'
  generateBtn.style.cssText = btnStyle + ' background:var(--lumiverse-primary, #3b82f6); color:#fff; width:100%;'
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
    resultInput.value = ''
    saveResultBtn.style.display = 'none'
    generateBtn.textContent = 'Stop Generating'
    ctx.sendToBackend({
      type: 'generate', characterId: selectedChar, category: selectedCategory, originalText: currentTextInput.value
    })
  }
  container.appendChild(generateBtn)

  const resultInput = document.createElement('textarea')
  resultInput.rows = 5
  resultInput.placeholder = 'AI suggestion will appear here...'
  resultInput.style.cssText = inputStyle + ' resize:vertical;'
  container.appendChild(resultInput)

  const saveResultBtn = document.createElement('button')
  saveResultBtn.textContent = 'Save AI Result as Version'
  saveResultBtn.style.cssText = btnStyle + ' background:var(--lumiverse-primary, #3b82f6); color:#fff; display:none; width:100%;'
  saveResultBtn.onclick = () => saveVersion(resultInput.value)
  container.appendChild(saveResultBtn)

  // Fetch single full character detail to populate full extensions object
  async function fetchFullCharacter(charId: string): Promise<any> {
    if (!charId) return null
    try {
      const fullChar = await apiFetch(`/api/v1/characters/${charId}`)
      if (fullChar && fullChar.id) {
        const idx = fullCharList.findIndex(c => c.id === charId)
        if (idx !== -1) fullCharList[idx] = fullChar
        else fullCharList.push(fullChar)
        return fullChar
      }
    } catch (err) {
      console.warn('[AI Rewriter] Fetch full character error:', err)
    }
    return fullCharList.find(c => c.id === charId) || null
  }

  async function loadCurrentText() {
    if (!selectedChar) {
      currentTextInput.value = 'Select a character card above...'
      variantSelect.style.display = 'none'
      deleteVersionBtn.style.display = 'none'
      return
    }

    const char = await fetchFullCharacter(selectedChar)
    if (!char) {
      currentTextInput.value = 'Select a character card above...'
      variantSelect.style.display = 'none'
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

    currentTextInput.value = originalTextRaw
    resultInput.value = ''
    saveResultBtn.style.display = 'none'

    renderVariantsDropdown()
  }

  function renderVariantsDropdown() {
    variantSelect.innerHTML = '<option value="live">Live Card Text</option>'
    categoryVariants.forEach((_, i) => {
      const opt = document.createElement('option')
      opt.value = i.toString()
      opt.textContent = `Saved Version ${i + 1}`
      variantSelect.appendChild(opt)
    })

    variantSelect.value = selectedVersionKey
    variantSelect.style.display = 'block'
    deleteVersionBtn.style.display = selectedVersionKey === 'live' ? 'none' : 'block'
  }

  async function withCurrentCharacter(work: (char: any) => Promise<any> | any): Promise<void> {
    if (!selectedChar) {
      alert('Please select a character first.')
      return
    }
    try {
      const char = await fetchFullCharacter(selectedChar)
      if (!char) throw new Error('Character not found')
      await work(char)
    } catch (err: any) {
      alert(`Action failed: ${err?.message || err}`)
    }
  }

  async function saveVersion(text: string) {
    await withCurrentCharacter(async (char) => {
      const extensions = JSON.parse(JSON.stringify(char.extensions || {}))
      if (!extensions.char_rewriter) extensions.char_rewriter = { variants: {} }
      if (!extensions.char_rewriter.variants) extensions.char_rewriter.variants = {}
      if (!extensions.char_rewriter.variants[selectedCategory]) {
        extensions.char_rewriter.variants[selectedCategory] = []
      }

      const list: string[] = extensions.char_rewriter.variants[selectedCategory]
      if (list.length === 0 || list[list.length - 1] !== text) {
        list.push(text)
        const updatedChar = await apiFetch(`/api/v1/characters/${selectedChar}`, {
          method: 'PATCH',
          body: JSON.stringify({ extensions })
        })

        if (updatedChar && updatedChar.id) {
          const idx = fullCharList.findIndex(c => c.id === selectedChar)
          if (idx !== -1) fullCharList[idx] = updatedChar
        }
      }

      await loadCurrentText()
      selectedVersionKey = categoryVariants.length > 0 ? (categoryVariants.length - 1).toString() : 'live'
      renderVariantsDropdown()
      currentTextInput.value = categoryVariants.length > 0 ? categoryVariants[categoryVariants.length - 1] : originalTextRaw
      resultInput.value = ''
      saveResultBtn.style.display = 'none'
    })
  }

  async function deleteVersion(index: number) {
    await withCurrentCharacter(async (char) => {
      const extensions = JSON.parse(JSON.stringify(char.extensions || {}))
      const rewriter = extensions.char_rewriter || { variants: {} }

      if (rewriter.variants?.[selectedCategory]) {
        rewriter.variants[selectedCategory].splice(index, 1)
        extensions.char_rewriter = rewriter

        const updatedChar = await apiFetch(`/api/v1/characters/${selectedChar}`, {
          method: 'PATCH',
          body: JSON.stringify({ extensions })
        })

        if (updatedChar && updatedChar.id) {
          const idx = fullCharList.findIndex(c => c.id === selectedChar)
          if (idx !== -1) fullCharList[idx] = updatedChar
        }
      }

      await loadCurrentText()
    })
  }

  async function applyVersion(text: string) {
    await withCurrentCharacter(async (char) => {
      let updatePayload: any = {}
      if (selectedCategory.startsWith('alt_greeting_')) {
        const altGreetings = [...(char.alternate_greetings || [])]
        const idx = parseInt(selectedCategory.replace('alt_greeting_', ''), 10)
        while (altGreetings.length < idx) altGreetings.push('')
        altGreetings[idx] = text
        updatePayload = { alternate_greetings: altGreetings }
      } else {
        updatePayload = { [selectedCategory]: text }
      }

      if (char.extensions) {
        updatePayload.extensions = char.extensions
      }

      const updatedChar = await apiFetch(`/api/v1/characters/${selectedChar}`, {
        method: 'PATCH',
        body: JSON.stringify(updatePayload)
      })

      if (updatedChar && updatedChar.id) {
        const idx = fullCharList.findIndex(c => c.id === selectedChar)
        if (idx !== -1) fullCharList[idx] = updatedChar
      }

      originalTextRaw = text
      selectedVersionKey = 'live'
      renderVariantsDropdown()
      currentTextInput.value = originalTextRaw
    })
  }

  const unsubPermissions = ctx.events?.on?.('PERMISSION_CHANGED', () => { 
    loadEverything().catch(console.error) 
  })

  ctx.onBackendMessage((payload: any) => {
    if (payload.type === 'status_result') {
      statusRequestSeq++
      hasGeneration = payload.hasGeneration
      currentPrompts = payload.prompts || {}
      basePromptInput.value = currentPrompts.base || ''
      generateBtn.style.display = hasGeneration ? 'block' : 'none'
      if (!hasGeneration) {
        permissionWarning.style.display = 'block'
        permissionWarning.innerHTML = `<strong>Generation permission not granted.</strong> AI rewriting is disabled until granted in extension settings.`
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
      currentPrompts = payload.prompts || {}
      basePromptInput.value = currentPrompts.base || ''
    }

    if (payload.type === 'generate_token') {
      streamedText += payload.token
      resultInput.value = streamedText
    }

    if (payload.type === 'generate_done') {
      isGenerating = false
      generateBtn.textContent = 'Rewrite with AI'
      generateBtn.disabled = false
      resultInput.value = payload.result || streamedText
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
        permissionWarning.innerHTML = `<strong>Backend didn't respond.</strong> AI rewriting may be unavailable — try reopening this tab.`
      }
    }, WATCHDOG_MS)
  }

  async function loadEverything() {
    charSelect.innerHTML = '<option value="">Loading characters...</option>'
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

      charSelect.innerHTML = ''
      if (chars.length === 0) {
        charSelect.innerHTML = '<option value="">No characters found</option>'
      } else {
        chars.forEach((c: any) => {
          const opt = document.createElement('option')
          opt.value = c.id
          opt.textContent = c.name
          if (c.id === selectedChar) opt.selected = true
          charSelect.appendChild(opt)
        })
      }

      updateCategoryOptions()
      if (selectedChar) await loadCurrentText()
    } catch (err: any) {
      charSelect.innerHTML = '<option value="">Error loading characters</option>'
      currentTextInput.value = `Couldn't load characters: ${err?.message || err}`
    }
  }

  tab.onActivate(() => {
    loadEverything().catch(console.error)
  })

  loadEverything().catch(console.error)

  return () => {
    try {
      tab?.destroy?.()
      unsubPermissions?.()
    } catch {
      // Cleanup safety
    }
  }
}

export default setup
