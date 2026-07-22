import type { SpindleFrontendContext } from 'lumiverse-spindle-types'

export function setup(ctx: SpindleFrontendContext) {
  const tab = ctx.ui.registerDrawerTab({
    id: 'ai-rewriter',
    title: 'AI Character Rewriter',
    shortName: 'Rewrite',
    iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>'
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
  
  let originalTextRaw = ''
  let categoryVariants: string[] = []
  let selectedVersionKey = 'live' 
  
  const activeMounts: any[] = []

  const fetchCurrentText = () => {
    if (selectedChar && selectedCategory) {
      ctx.sendToBackend({ type: 'get_char_text', characterId: selectedChar, category: selectedCategory })
      currentTextInput.update({ value: 'Loading current text...' })
      variantSelectSlot.style.display = 'none' 
      deleteVersionBtn.style.display = 'none'
    }
  }

  // --- 1. ALWAYS MOUNTED CHARACTER DROPDOWN ---
  const charSlot = document.createElement('div')
  container.appendChild(charSlot)
  const charSelect = ctx.components.mountSelect(charSlot, {
    value: '', placeholder: "Loading characters...", options: [{ value: '', label: 'Loading characters...' }],
    onChange: (v) => { 
      selectedChar = v; 
      updateCategoryOptions(); 
      fetchCurrentText() 
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
    onChange: (v) => { selectedCategory = v; fetchCurrentText() }
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
  container.appendChild(currentTextSlot) // FIXED: Replaced circular appendChild
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
  saveCurrentBtn.onclick = () => {
    ctx.sendToBackend({
      type: 'save_version', characterId: selectedChar, category: selectedCategory, text: currentTextInput.getValue()
    })
  }
  currentActionsRow.appendChild(saveCurrentBtn)

  const applyBtn = document.createElement('button')
  applyBtn.textContent = 'Apply Selected to Card'
  applyBtn.className = 'btn'
  applyBtn.style.cssText = 'background: var(--lumiverse-success); color: white; flex: 1;'
  applyBtn.onclick = () => {
    ctx.sendToBackend({
      type: 'apply_version', characterId: selectedChar, category: selectedCategory, text: currentTextInput.getValue()
    })
  }
  currentActionsRow.appendChild(applyBtn)

  const deleteVersionBtn = document.createElement('button')
  deleteVersionBtn.textContent = 'Delete Version'
  deleteVersionBtn.className = 'btn'
  deleteVersionBtn.style.cssText = 'background: var(--lumiverse-danger); color: white; margin-top:-8px; display:none;'
  deleteVersionBtn.onclick = () => {
    if (selectedVersionKey !== 'live') {
      ctx.sendToBackend({
        type: 'delete_version', characterId: selectedChar, category: selectedCategory, index: parseInt(selectedVersionKey, 10)
      })
    }
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
  saveResultBtn.onclick = () => {
    ctx.sendToBackend({
      type: 'save_version', characterId: selectedChar, category: selectedCategory, text: resultInput.getValue()
    })
  }
  container.appendChild(saveResultBtn)


  // --- EVENT LISTENERS ---
  const unsubPermissions = ctx.events.on('PERMISSION_CHANGED', () => { requestInitData() })

  function renderVariantsDropdown() {
    const variantOptions = [{ value: 'live', label: 'Live Card Text' }]
    categoryVariants.forEach((_, i) => {
      variantOptions.push({ value: i.toString(), label: `Saved Version ${i + 1}` })
    })

    variantSelectSlot.style.display = 'block'
    variantSelect.update({ options: variantOptions, value: selectedVersionKey })

    if (selectedVersionKey === 'live') {
      deleteVersionBtn.style.display = 'none'
    } else {
      deleteVersionBtn.style.display = 'block'
    }
  }

  ctx.onBackendMessage((payload: any) => {
    if (payload.type === 'permission_status') {
      container.style.display = 'none'
      permissionWarning.style.display = 'block'
      permissionWarning.innerHTML = `<strong>Permissions Required.</strong> Please enable Characters, Chats, and Generation access.`
      return
    }

    if (payload.type === 'init_error') {
      charSelect.update({ placeholder: "Error loading characters", options: [] })
      currentTextInput.update({ value: `Backend error: ${payload.error}` })
      return
    }

    if (payload.type === 'init_data') {
      container.style.display = 'flex'
      permissionWarning.style.display = 'none'

      fullCharList = payload.chars 
      currentPrompts = payload.prompts
      basePromptInput.update({ value: currentPrompts.base })

      selectedChar = payload.activeCharId || (payload.chars[0]?.id ?? '')

      charSelect.update({
        value: selectedChar, placeholder: "Select Character", searchPlaceholder: "Search...",
        options: payload.chars.map((c: any) => ({
          value: c.id, label: c.name, leading: c.image_id ? { type: 'image', src: `/api/v1/images/${c.image_id}?size=sm` } : undefined
        }))
      })

      updateCategoryOptions()
      if (selectedChar) fetchCurrentText()
    }

    if (payload.type === 'prompts_updated') {
      currentPrompts = payload.prompts
      basePromptInput.update({ value: currentPrompts.base })
    }

    if (payload.type === 'char_text_result') {
      originalTextRaw = payload.text
      categoryVariants = payload.variants || []
      selectedVersionKey = 'live'
      
      currentTextInput.update({ value: originalTextRaw })
      resultInput.update({ value: '' })
      saveResultBtn.style.display = 'none'
      
      renderVariantsDropdown()
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

    if (payload.type === 'save_version_success') {
      categoryVariants = payload.variants || []
      
      if (categoryVariants.length > 0) {
        selectedVersionKey = (categoryVariants.length - 1).toString()
        currentTextInput.update({ value: categoryVariants[categoryVariants.length - 1] })
      } else {
        selectedVersionKey = 'live'
        currentTextInput.update({ value: originalTextRaw })
      }

      renderVariantsDropdown()
      
      resultInput.update({ value: '' })
      saveResultBtn.style.display = 'none'
    }

    if (payload.type === 'apply_success') {
      originalTextRaw = payload.text
      selectedVersionKey = 'live'
      
      renderVariantsDropdown()
      currentTextInput.update({ value: originalTextRaw })
      
      requestInitData()
    }
  })

  function requestInitData() {
    const currentUrl = window.location.pathname + window.location.hash
    const match = currentUrl.match(/\/(characters|chat)\/([a-zA-Z0-9_-]+)/)
    ctx.sendToBackend({ type: 'get_init_data', routeType: match ? match[1] : null, routeId: match ? match[2] : null })
  }

  requestInitData()

  return () => {
    tab.destroy()
    unsubPermissions()
    activeMounts.forEach(m => m?.destroy?.())
  }
}
