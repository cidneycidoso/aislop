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

  const activeMounts: any[] = []
  const WATCHDOG_MS = 15000
  let statusRequestSeq = 0

  // Fetches full individual character details (including `extensions`) and updates cache
  async function fetchFullCharacter(charId: string): Promise<any> {
    if (!charId) return null
    try {
      const fullChar = await apiFetch(`/api/v1/characters/${charId}`)
      if (fullChar && fullChar.id) {
        const idx = fullCharList.findIndex(c => c.id === charId)
        if (idx !== -1) {
          fullCharList[idx] = fullChar
        } else {
          fullCharList.push(fullChar)
        }
        return fullChar
      }
    } catch (err) {
      console.warn('[AI Rewriter] Failed to fetch full character details:', err)
    }
    return fullCharList.find(c => c.id === charId) || null
  }

  // 1. CHARACTER SELECT DROPDOWN
  const charSlot = document.createElement('div')
  container.appendChild(charSlot)
  const charSelect = ctx.components.mountSelect(charSlot, {
    value: '', placeholder: "Loading characters...", options: [{ value: '', label: 'Loading characters...' }],
    onChange: async (v) => {
      selectedChar = v
      updateCategoryOptions()
      await loadCurrentText()
    }
  })
  activeMounts.push(charSelect)

  // 2. CATEGORY SELECT DROPDOWN
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
    onChange: async (v) => { selectedCategory = v; await loadCurrentText() }
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

  // 3. PROMPTS SECTION
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

  // 4. TEXT VIEWER & DRAFT PICKER
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
    resultInput.update({ value: '' })
    saveResultBtn.style.display = 'none'
    generateBtn.textContent = 'Stop Generating'
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

  async function loadCurrentText() {
    if (!selectedChar) {
      currentTextInput.update({ value: 'Select a character card above...' })
      variantSelectSlot.style.display = 'none'
      deleteVersionBtn.style.display = 'none'
      return
    }

    // Always ensure full character with extensions
