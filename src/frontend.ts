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
  const activeMounts: any[] = []

  const fetchCurrentText = () => {
    if (selectedChar && selectedCategory) {
      ctx.sendToBackend({ type: 'get_char_text', characterId: selectedChar, category: selectedCategory })
      currentTextInput.update({ value: 'Loading current text...' })
    }
  }

  const charSlot = document.createElement('div')
  container.appendChild(charSlot)
  let charSelect: any = null

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

  // Prompts Section - Self-contained directly in the tab
  const promptSlot = document.createElement('div')
  container.appendChild(promptSlot)
  const promptSection = ctx.components.mountCollapsibleSection(promptSlot, {
    title: 'Edit AI Instructions',
    defaultExpanded: false
  })
  
  const basePromptInput = ctx.components.mountTextArea(promptSection.body, {
    value: '', rows: 3, placeholder: 'Base System Prompt',
    onChange: (v) => { currentPrompts.base = v }
  })
  activeMounts.push(basePromptInput)
  
  const savePromptsBtn = document.createElement('button')
  savePromptsBtn.textContent = 'Save Instructions'
  savePromptsBtn.className = 'btn'
  savePromptsBtn.style.marginTop = '8px'
  savePromptsBtn.onclick = () => ctx.sendToBackend({ type: 'save_prompts', prompts: currentPrompts })
  promptSection.body.appendChild(savePromptsBtn)

  const currentTextLabel = document.createElement('div')
  currentTextLabel.style.cssText = 'font-weight: 500; font-size: 13px; color: var(--lumiverse-text-dim); margin-bottom: -8px;'
  currentTextLabel.textContent = "Current Character Card Text:"
  container.appendChild(currentTextLabel)

  const currentTextSlot = document.createElement('div')
  container.appendChild(currentTextSlot)
  const currentTextInput = ctx.components.mountTextArea(currentTextSlot, {
    value: '', rows: 5, placeholder: 'Select a character card above...'
  })
  activeMounts.push(currentTextInput)

  const generateBtn = document.createElement('button')
  generateBtn.textContent = 'Rewrite with AI'
  generateBtn.className = 'btn'
  generateBtn.style.cssText = 'background: var(--lumiverse-primary); color: white;'
  generateBtn.onclick = () => {
    if (!selectedChar) return
    generateBtn.textContent = 'Generating...'
    generateBtn.disabled = true
    ctx.sendToBackend({ 
      type: 'generate', 
      characterId: selectedChar, 
      category: selectedCategory,
      originalText: currentTextInput.getValue() 
    })
  }
  container.appendChild(generateBtn)

  const resultSlot = document.createElement('div')
  container.appendChild(resultSlot)
  const resultInput = ctx.components.mountTextArea(resultSlot, {
    value: '', rows: 6, placeholder: 'AI suggestions will appear here...',
  })
  activeMounts.push(resultInput)

  const applyBtn = document.createElement('button')
  applyBtn.textContent = 'Apply to Character Card'
  applyBtn.className = 'btn'
  applyBtn.style.cssText = 'background: var(--lumiverse-success); color: white; display: none;'
  applyBtn.onclick = () => {
    ctx.sendToBackend({ type: 'apply', characterId: selectedChar, category: selectedCategory, newText: resultInput.getValue() })
    currentTextInput.update({ value: resultInput.getValue() })
    resultInput.update({ value: '' })
    applyBtn.style.display = 'none'
  }
  container.appendChild(applyBtn)

  const unsubPermissions = ctx.events.on('PERMISSION_CHANGED', () => {
    ctx.sendToBackend({ type: 'get_init_data' })
  })

  ctx.onBackendMessage((payload: any) => {
    if (payload.type === 'permission_status') {
      container.style.display = 'none'
      permissionWarning.style.display = 'block'
      
      const missing = []
      if (!payload.hasCharacters) missing.push('<strong>Characters</strong>')
      if (!payload.hasGeneration) missing.push('<strong>Generation</strong>')
      
      permissionWarning.innerHTML = `
        <strong>Permissions Required:</strong><br>
        This extension needs permission access to run. Please go to your Extensions settings or run the developer script to grant: ${missing.join(' and ')}.
      `
      return
    }

    if (payload.type === 'init_data') {
      container.style.display = 'flex'
      permissionWarning.style.display = 'none'

      currentPrompts = payload.prompts
      basePromptInput.update({ value: currentPrompts.base })

      selectedChar = payload.activeCharId || (payload.chars[0]?.id ?? '')

      if (charSelect) {
        charSelect.destroy()
      }

      charSelect = ctx.components.mountSelect(charSlot, {
        value: selectedChar,
        placeholder: "Select Character",
        searchPlaceholder: "Search...",
        options: payload.chars.map((c: any) => ({
          value: c.id,
          label: c.name,
          leading: c.image_id ? { type: 'image', src: `/api/v1/images/${c.image_id}?size=sm` } : undefined
        })),
        onChange: (v) => { selectedChar = v; fetchCurrentText() }
      })
      activeMounts.push(charSelect)
      if (selectedChar) fetchCurrentText()
    }

    if (payload.type === 'prompts_updated') {
      currentPrompts = payload.prompts
      basePromptInput.update({ value: currentPrompts.base })
    }

    if (payload.type === 'char_text_result') {
      currentTextInput.update({ value: payload.text })
      resultInput.update({ value: '' })
      applyBtn.style.display = 'none'
    }
    if (payload.type === 'generate_result') {
      generateBtn.textContent = 'Rewrite with AI'
      generateBtn.disabled = false
      resultInput.update({ value: payload.result })
      applyBtn.style.display = 'block'
    }
    if (payload.type === 'generate_failed') {
      generateBtn.textContent = 'Rewrite with AI'
      generateBtn.disabled = false
    }
  })

  ctx.sendToBackend({ type: 'get_init_data' })

  return () => {
    tab.destroy()
    unsubPermissions()
    activeMounts.forEach(m => {
      if (m && typeof m.destroy === 'function') m.destroy()
    })
  }
}