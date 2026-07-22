import type { SpindleFrontendContext } from 'lumiverse-spindle-types'

// --- REST helper --------------------------------------------------------
// Character reading/writing now goes straight to Lumiverse's own REST API
// instead of through the Spindle backend RPC bridge. A same-origin fetch()
// here rides on the browser's own logged-in session, so there's no
// operator-scoped "which user is this?" ambiguity to resolve — it's always
// exactly the person looking at the screen.
//
// NOTE: these endpoint paths/shapes are inferred from REST conventions
// consistent with the rest of Lumiverse's API (e.g. /api/v1/images/:id,
// already used below for avatars) and the documented Spindle character DTO
// shape. They aren't in the public extension-facing REST docs. If any of
// these 404 or come back in an unexpected shape on your install, open the
// Characters page in Lumiverse itself, check the Network tab, and adjust
// the paths/method below to match — everything that touches these paths is
// isolated in the functions right below this comment.
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
  const allChars: any[] = []
  let offset = 0
  const limit = 200
  let hasMore = true

  while (hasMore) {
    const result = await apiFetch(`/api/v1/characters?limit=${limit}&offset=${offset}`)
    const data = Array.isArray(result) ? result : (result?.data ?? [])
    const total = Array.isArray(result) ? data.length : result?.total

    if (!data.length) break
    allChars.push(...data)

    if (data.length < limit || (typeof total === 'number' && allChars.length >= total)) {
      hasMore = false
    } else {
      offset += limit
    }
  }
  return allChars
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
    // No active chat, or this endpoint doesn't exist on this install —
    // non-fatal, we just fall back to the first character in the list.
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

  // Re-sync character list automatically whenever tab is clicked [2.3.1]
  const unsubTabActivate = tab.onActivate(() => {
    loadEverything()
  })

  // Permission warning UI
  const permissionWarning = document.createElement('div')
  permissionWarning.style.cssText = 'display:none; padding:16px; margin:16px; background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.25); border-radius:var(--lumiverse-radius); color:var(--lumiverse-danger); font-size:13px; line-height:1.5;'
  tab.root.appendChild(permissionWarning)

  // Main interaction container
  const container = document.createElement('div')
  container.style.cssText = 'display:flex;flex-direction:column;gap:16px;padding:16px;'
  tab.root.appendChild(container)

  let selectedChar = ''
  let selectedCategory = 'description'
  let currentPrompts: any = {}
  let fullCharList: any[] = []
  let hasGeneration = true // assume true until status_result says otherwise

  let originalTextRaw = ''
  let categoryVariants: string[] = []
  let selectedVersionKey = 'live'

  const activeMounts: any[] = []

  // Watchdog: only the backend round trip (status/prompts/generation) can
  // still silently hang the way character loading used to. Character data
  // itself now comes from fetch(), whose promise always settles one way or
  // the other, so no watchdog is needed for that part anymore.
  const WATCHDOG_MS = 15000
  let statusRequestSeq = 0

  // --- 1. ALWAYS MOUNTED CHARACTER DROPDOWN ---
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

  // --- 2. CATEGORY DROPDOWN ---
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

  // --- 3. PROMPTS CONFIGURATION ---
  const promptSlot = document.createElement('div')
  container.appendChild(promptSlot)
  const promptSection = ctx.components.mountCollapsibleSection(promptSlot, {
    title: 'Edit AI Instructions', defaultExpanded: false
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

  // --- 4. CURRENT TEXT VIEWER & VARIANT PICKER ---
  const currentTextLabel = document.createElement('div')
  currentTextLabel.style.cssText = 'font-weight: 500; font-size: 13px; color: var(--lumiverse-text-dim); margin-bottom: -8px;'
  currentTextLabel.textContent = "Version History / Preview:"
  container.appendChild(currentTextLabel)

  // Variant Selector
  const variantSelectSlot = document.createElement('div')
  variantSelectSlot.style.display = 'none'
  container.appendChild(variantSelectSlot)

  const variantSelect = ctx.components.mountSelect(variantSelectSlot, {
    value: 'live', placeholder: "Select Draft Version", options: [{ value: 'live', label: 'Live Card Text' }],
    onChange: (v) => {
      selectedVersionKey = v
      if (v === 'live') {
        currentTextInput.update({ value: originalTextRaw })
        deleteVersionBtn.style.display = 'none'
      } else {
        const idx = parseInt(v, 10)
        currentTextInput.update({ value: categoryVariants[idx] || '' })
        deleteVersionBtn.style.display = 'block'
      }
    }
  })
  activeMounts.push(variantSelect)

  const currentTextSlot = document.createElement('div')
  container.appendChild(currentTextSlot)
  const currentTextInput = ctx.components.mountTextArea(currentTextSlot, {
    value: '', rows: 5, placeholder: 'Select a character card above...'
  })
  activeMounts.push(currentTextInput)

  // Actions row
  const currentActionsRow = document.createElement('div')
  currentActionsRow.style.cssText = 'display:flex;gap:8px;margin-top:-8px;'
  container.appendChild(currentActionsRow)

  const saveCurrentBtn = document.createElement('button')
  saveCurrentBtn.textContent = 'Save Current as Version'
  saveCurrentBtn.className = 'btn'
  saveCurrentBtn.style.flex = '1'
  saveCurrentBtn.onclick = () => saveVersion(currentTextInput.getValue())
  currentActionsRow.appendChild(saveCurrentBtn)

  const applyBtn = document.createElement('button')
  applyBtn.textContent = 'Apply Selected to Card'
  applyBtn.className = 'btn'
  applyBtn.style.cssText = 'background: var(--lumiverse-success); color: white; flex: 1;'
  applyBtn.onclick = () => applyVersion(currentTextInput.getValue())
  currentActionsRow.appendChild(applyBtn)

  const deleteVersionBtn = document.createElement('button')
  deleteVersionBtn.textContent = 'Delete Version'
  deleteVersionBtn.className = 'btn'
  deleteVersionBtn.style.cssText = 'background: var(--lumiverse-danger); color: white; margin-top:-8px; display:none;'
  deleteVersionBtn.onclick = () => {
    if (selectedVersionKey !== 'live') deleteVersion(parseInt(selectedVersionKey, 10))
  }
  container.appendChild(deleteVersionBtn)

  // --- 5. AI GENERATOR ---
  const aiDivider = document.createElement('div')
  aiDivider.style.cssText = 'border-top: 1px solid var(--lumiverse-border); margin: 8px 0;'
  container.appendChild(aiDivider)

  const generateBtn = document.createElement('button')
  generateBtn.textContent = 'Rewrite with AI'
  generateBtn.className = 'btn'
  generateBtn.style.cssText = 'background: var(--lumiverse-primary); color: white;'
  generateBtn.onclick = () => {
    if (!selectedChar) return
    generateBtn.textContent = 'Generating...'
    generateBtn.disabled = true
    ctx.sendToBackend({
      type: 'generate', characterId: selectedChar, category: selectedCategory, originalText: currentTextInput.getValue()
    })
  }
  container.appendChild(generateBtn)

  const resultSlot = document.createElement('div')
  container.appendChild(resultSlot)
  const resultInput = ctx.components.mountTextArea(resultSlot, {
    value: '', rows: 5, placeholder: 'AI suggestion will appear here...',
  })
  activeMounts.push(resultInput)

  const saveResultBtn = document.createElement('button')
  saveResultBtn.textContent = 'Save AI Result as Version'
  saveResultBtn.className = 'btn'
  saveResultBtn.style.cssText = 'display: none;'
  saveResultBtn.onclick = () => saveVersion(resultInput.getValue())
  container.appendChild(saveResultBtn)


  // --- CHARACTER TEXT (now purely local — no round trip) -----------------
  function loadCurrentText() {
    const char = fullCharList.find(c => c.id === selectedChar)
    if (!char) {
      currentTextInput.update({ value: 'Select a character card above...' })
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

  // --- CHARACTER WRITES (now direct REST PATCH calls) ---------------------
  async function withFreshCharacter(work: (char: any) => Promise<any> | any): Promise<void> {
    try {
      const char = await apiFetch(`/api/v1/characters/${selectedChar}`)
      if (!char) throw new Error('Character not found')
      await work(char)
    } catch (err: any) {
      currentTextInput.update({ value: currentTextInput.getValue() }) // no-op, keeps current text
      alert(`Action failed: ${err?.message || err}`)
    }
  }

  async function saveVersion(text: string) {
    await withFreshCharacter(async (char) => {
      const extData = char.extensions?.['char_rewriter'] || { variants: {} }
      if (!extData.variants) extData.variants = {}
      if (!extData.variants[selectedCategory]) extData.variants[selectedCategory] = []

      const list = extData.variants[selectedCategory]
      if (list.length === 0 || list[list.length - 1] !== text) {
        list.push(text)
        await apiFetch(`/api/v1/characters/${selectedChar}`, {
          method: 'PATCH',
          body: JSON.stringify({ extensions: { ...char.extensions, char_rewriter: extData } })
        })
      }

      // Keep the in-memory copy in sync so we don't need a full re-fetch.
      const cached = fullCharList.find(c => c.id === selectedChar)
      if (cached) cached.extensions = { ...cached.extensions, char_rewriter: extData }

      categoryVariants = extData.variants[selectedCategory]
      selectedVersionKey = categoryVariants.length > 0 ? (categoryVariants.length - 1).toString() : 'live'
      currentTextInput.update({ value: categoryVariants.length > 0 ? categoryVariants[categoryVariants.length - 1] : originalTextRaw })
      resultInput.update({ value: '' })
      saveResultBtn.style.display = 'none'
      renderVariantsDropdown()
    })
  }

  async function deleteVersion(index: number) {
    await withFreshCharacter(async (char) => {
      const extData = char.extensions?.['char_rewriter'] || { variants: {} }
      if (extData.variants?.[selectedCategory]) {
        extData.variants[selectedCategory].splice(index, 1)
        await apiFetch(`/api/v1/characters/${selectedChar}`, {
          method: 'PATCH',
          body: JSON.stringify({ extensions: { ...char.extensions, char_rewriter: extData } })
        })
      }

      const cached = fullCharList.find(c => c.id === selectedChar)
      if (cached) cached.extensions = { ...cached.extensions, char_rewriter: extData }

      categoryVariants = extData.variants?.[selectedCategory] || []
      selectedVersionKey = 'live'
      currentTextInput.update({ value: originalTextRaw })
      renderVariantsDropdown()
    })
  }

  async function applyVersion(text: string) {
    await withFreshCharacter(async (char) => {
      let updatePayload: any = {}
      if (selectedCategory.startsWith('alt_greeting_')) {
        const altGreetings = [...(char.alternate_greetings || [])]
        const idx = parseInt(selectedCategory.replace('alt_greeting_', ''), 10)
        altGreetings[idx] = text
        updatePayload = { alternate_greetings: altGreetings }
      } else {
        updatePayload = { [selectedCategory]: text }
      }

      await apiFetch(`/api/v1/characters/${selectedChar}`, {
        method: 'PATCH',
        body: JSON.stringify(updatePayload)
      })

      const cached = fullCharList.find(c => c.id === selectedChar)
      if (cached) Object.assign(cached, updatePayload)

      originalTextRaw = text
      selectedVersionKey = 'live'
      renderVariantsDropdown()
      currentTextInput.update({ value: originalTextRaw })
    })
  }

  // --- EVENT LISTENERS ---
  const unsubPermissions = ctx.events.on('PERMISSION_CHANGED', () => { loadEverything() })

  ctx.onBackendMessage((payload: any) => {
    if (payload.type === 'status_result') {
      statusRequestSeq++ // a response arrived — cancel the status watchdog
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

    if (payload.type === 'generate_result') {
      generateBtn.textContent = 'Rewrite with AI'
      generateBtn.disabled = false
      resultInput.update({ value: payload.result })
      saveResultBtn.style.display = 'block'
    }

    if (payload.type === 'generate_failed') {
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

  // --- MAIN LOAD (characters via direct REST, no backend round trip) -----
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
      currentTextInput.update({ value: `Couldn't load characters: ${err?.message || err}` })
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
