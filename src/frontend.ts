import type { SpindleFrontendContext } from 'lumiverse-spindle-types'

export function setup(ctx: SpindleFrontendContext) {
  // State variables
  let selectedChar = ''
  let selectedCategory = 'description'
  let currentPrompts: any = {}
  
  // Track mounted widgets for safe teardown
  const activeMounts: any[] = []

  // --- 1. SETTINGS PANEL MOUNT (Gear -> Extensions) ---
  const settingsRoot = ctx.ui.mount('settings_extensions')
  if (settingsRoot) {
    settingsRoot.innerHTML = '' // Clear loading placeholder

    const settingsContainer = document.createElement('div')
    settingsContainer.style.cssText = 'display:flex;flex-direction:column;gap:12px;padding:8px 0;'
    settingsRoot.appendChild(settingsContainer)

    const title = document.createElement('div')
    title.style.cssText = 'font-weight: 600; font-size: 15px; color: var(--lumiverse-text);'
    title.textContent = 'AI Rewriter Prompts'
    settingsContainer.appendChild(title)

    const desc = document.createElement('div')
    desc.style.cssText = 'font-size: 12.5px; color: var(--lumiverse-text-dim); margin-bottom: 8px;'
    desc.textContent = 'Configure the base instructions and category-specific rules sent to the AI during rewrites.'
    settingsContainer.appendChild(desc)

    // Base Prompt
    const baseLabel = document.createElement('label')
    baseLabel.style.cssText = 'font-size: 12.5px; font-weight: 500;'
    baseLabel.textContent = 'Base System Prompt'
    settingsContainer.appendChild(baseLabel)

    const baseSlot = document.createElement('div')
    settingsContainer.appendChild(baseSlot)
    const basePromptInput = ctx.components.mountTextArea(baseSlot, {
      value: '', rows: 3, placeholder: 'Global AI instructions...',
      onChange: (v) => { currentPrompts.base = v }
    })
    activeMounts.push(basePromptInput)

    // Helper to generate a label and textarea for category instructions
    const createCategorySetting = (key: string, label: string) => {
      const rowLabel = document.createElement('label')
      rowLabel.style.cssText = 'font-size: 12.5px; font-weight: 500; margin-top: 6px;'
      rowLabel.textContent = `${label} Category Focus`
      settingsContainer.appendChild(rowLabel)

      const slot = document.createElement('div')
      settingsContainer.appendChild(slot)
      const input = ctx.components.mountTextArea(slot, {
        value: '', rows: 2, placeholder: `AI guidance for the ${label.toLowerCase()}...`,
        onChange: (v) => { currentPrompts[key] = v }
      })
      activeMounts.push(input)
      return input
    }

    const descInput = createCategorySetting('description', 'Description')
    const personalityInput = createCategorySetting('personality', 'Personality')
    const scenarioInput = createCategorySetting('scenario', 'Scenario')
    const firstMesInput = createCategorySetting('first_mes', 'First Message')

    // Save Button
    const saveBtn = document.createElement('button')
    saveBtn.textContent = 'Save Instruction Settings'
    saveBtn.className = 'btn'
    saveBtn.style.cssText = 'background: var(--lumiverse-primary); color: white; margin-top: 12px; align-self: flex-start;'
    saveBtn.onclick = () => ctx.sendToBackend({ type: 'save_prompts', prompts: currentPrompts })
    settingsContainer.appendChild(saveBtn)

    // Keep the settings inputs updated when prompts are loaded or changed
    const syncSettingsUI = (prompts: any) => {
      basePromptInput.update({ value: prompts.base || '' })
      descInput.update({ value: prompts.description || '' })
      personalityInput.update({ value: prompts.personality || '' })
      scenarioInput.update({ value: prompts.scenario || '' })
      firstMesInput.update({ value: prompts.first_mes || '' })
    }
    
    // Attach sync function to state tracking
    (settingsContainer as any)._sync = syncSettingsUI
  }


  // --- 2. THE REWRITER TOOL (Sidebar Drawer Tab) ---
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

  // Listen for permission changes to reload configuration automatically [1]
  const unsubPermissions = ctx.events.on('PERMISSION_CHANGED', () => {
    ctx.sendToBackend({ type: 'get_init_data' })
  })

  ctx.onBackendMessage((payload: any) => {
    // missing permissions
    if (payload.type === 'permission_status') {
      container.style.display = 'none'
      permissionWarning.style.display = 'block'
      
      const missing = []
      if (!payload.hasCharacters) missing.push('<strong>Characters</strong>')
      if (!payload.hasGeneration) missing.push('<strong>Generation</strong>')
      
      permissionWarning.innerHTML = `
        <strong>Permissions Required:</strong><br>
        This extension needs permission access to run. Please go to the <strong>Extensions</strong> settings panel, select this extension, and enable: ${missing.join(' and ')}.
      `
      return
    }

    // loaded
    if (payload.type === 'init_data') {
      container.style.display = 'flex'
      permissionWarning.style.display = 'none'

      currentPrompts = payload.prompts
      
      // Update Settings UI inputs if mounted
      const settingsRoot = tab.root.parentElement?.querySelector('[data-spindle-mount="settings_extensions"]')
      const settingsSection = settingsRoot?.querySelector('.settings-wrapper')
      
      const settingsPanel = document.getElementById('spindle-settings-root')
      const optSettingsRoot = ctx.dom.query('#settings_extensions')

      // Sync settings tab if active
      const settingsContainer = document.getElementById('char-rewriter-settings-container')
      if (settingsContainer) {
         const baseInput = settingsContainer.querySelector('textarea')
         if (basePromptInput) {
            basePromptInput.update({ value: currentPrompts.base })
         }
      } else {
         basePromptInput.update({ value: currentPrompts.base })
      }

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
      const sync = (settingsRoot as any)?._sync
      if (sync) sync(currentPrompts)
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

  // Start initialization
  ctx.sendToBackend({ type: 'get_init_data' })

  return () => {
    tab.destroy()
    unsubPermissions()
    // Destroy all mounted interactive widgets to prevent memory leaks
    activeMounts.forEach(m => {
      if (m && typeof m.destroy === 'function') m.destroy()
    })
  }
}
