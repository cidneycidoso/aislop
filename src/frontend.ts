import type { SpindleFrontendContext } from 'lumiverse-spindle-types'

export function setup(ctx: SpindleFrontendContext) {
  // 1. Register Drawer Tab in Lumiverse sidebar drawer & Ctrl+K Palette
  const tab = ctx.ui.registerDrawerTab({
    id: 'ai-character-rewriter',
    title: 'AI Character Rewriter',
    shortName: 'Rewriter',
    iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>'
  })

  // 2. Floating Action Button (FAB) for 1-click opening
  const fab = ctx.dom.inject('body', `
    <button id="ai-rewriter-fab-btn" title="Open AI Character Rewriter" style="
      position: fixed;
      bottom: 84px;
      right: 24px;
      z-index: 9990;
      width: 46px;
      height: 46px;
      border-radius: 50%;
      background: var(--lumiverse-primary, #6366f1);
      color: #ffffff;
      border: 1px solid rgba(255, 255, 255, 0.2);
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.15s ease, background 0.2s ease;
    ">
      <svg xmlns="http://www.w3.org/2000/svg" width="22" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
    </button>
  `)

  const handleFabClick = () => { tab.activate() }
  fab.addEventListener('click', handleFabClick)
  fab.addEventListener('mouseenter', () => { fab.style.transform = 'scale(1.08)' })
  fab.addEventListener('mouseleave', () => { fab.style.transform = 'scale(1.0)' })

  // --- STATE ---
  let characterList: any[] = []
  let selectedCharId = ''
  let selectedCategory = 'description'
  let currentPrompts: any = {}
  let liveTextRaw = ''
  let savedVariants: string[] = []
  let selectedVersionKey = 'live'

  const activeMounts: any[] = []

  // --- UI CONTAINER ---
  const container = document.createElement('div')
  container.style.cssText = 'display:flex; flex-direction:column; gap:14px; padding:16px; font-family:var(--lumiverse-font-sans, sans-serif);'
  tab.root.appendChild(container)

  // --- STATUS / ERROR BANNER ---
  const statusBanner = document.createElement('div')
  statusBanner.style.cssText = 'padding:10px 14px; border-radius:var(--lumiverse-radius, 6px); font-size:13px; line-height:1.4; display:none;'
  container.appendChild(statusBanner)

  function showStatus(message: string, type: 'error' | 'warning' | 'info' | 'success') {
    statusBanner.style.display = 'block'
    if (type === 'error') {
      statusBanner.style.background = 'rgba(239, 68, 68, 0.15)'
      statusBanner.style.border = '1px solid rgba(239, 68, 68, 0.4)'
      statusBanner.style.color = 'var(--lumiverse-danger, #ef4444)'
    } else if (type === 'warning') {
      statusBanner.style.background = 'rgba(245, 158, 11, 0.15)'
      statusBanner.style.border = '1px solid rgba(245, 158, 11, 0.4)'
      statusBanner.style.color = 'var(--lumiverse-warning, #f59e0b)'
    } else if (type === 'success') {
      statusBanner.style.background = 'rgba(16, 185, 129, 0.15)'
      statusBanner.style.border = '1px solid rgba(16, 185, 129, 0.4)'
      statusBanner.style.color = 'var(--lumiverse-success, #10b981)'
    } else {
      statusBanner.style.background = 'var(--lumiverse-bg-subtle, rgba(255,255,255,0.05))'
      statusBanner.style.border = '1px solid var(--lumiverse-border, rgba(255,255,255,0.1))'
      statusBanner.style.color = 'var(--lumiverse-text, #fff)'
    }
    statusBanner.innerHTML = message
  }

  function hideStatus() { statusBanner.style.display = 'none' }

  // --- 1. CHARACTER SELECTOR ---
  const charLabel = document.createElement('div')
  charLabel.style.cssText = 'font-size:12px; font-weight:600; text-transform:uppercase; color:var(--lumiverse-text-dim, #9ca3af); margin-bottom:-8px;'
  charLabel.textContent = 'Character'
  container.appendChild(charLabel)

  const charSlot = document.createElement('div')
  container.appendChild(charSlot)

  const charSelect = ctx.components.mountSelect(charSlot, {
    value: '',
    placeholder: 'Loading character cards...',
    options: [{ value: '', label: 'Loading characters...' }],
    onChange: (v) => {
      selectedCharId = v
      updateAspectOptions()
      fetchCategoryText()
    }
  })
  activeMounts.push(charSelect)

  // --- 2. ASPECT / CATEGORY SELECTOR ---
  const catLabel = document.createElement('div')
  catLabel.style.cssText = 'font-size:12px; font-weight:600; text-transform:uppercase; color:var(--lumiverse-text-dim, #9ca3af); margin-bottom:-8px;'
  catLabel.textContent = 'Aspect to Rewrite'
  container.appendChild(catLabel)

  const catSlot = document.createElement('div')
  container.appendChild(catSlot)

  const catSelect = ctx.components.mountSelect(catSlot, {
    value: selectedCategory,
    placeholder: 'Select Aspect',
    options: [
      { value: 'description', label: 'Description' },
      { value: 'personality', label: 'Personality' },
      { value: 'scenario', label: 'Scenario' },
      { value: 'mes_example', label: 'Example Messages' },
      { value: 'first_mes', label: 'Main Greeting' }
    ],
    onChange: (v) => {
      selectedCategory = v
      fetchCategoryText()
    }
  })
  activeMounts.push(catSelect)

  function updateAspectOptions() {
    const char = characterList.find(c => c.id === selectedCharId)
    const options = [
      { value: 'description', label: 'Description' },
      { value: 'personality', label: 'Personality' },
      { value: 'scenario', label: 'Scenario' },
      { value: 'mes_example', label: 'Example Messages' },
      { value: 'first_mes', label: 'Main Greeting' }
    ]

    if (char?.alternate_greetings?.length) {
      char.alternate_greetings.forEach((_: any, idx: number) => {
        options.push({ value: `alt_greeting_${idx}`, label: `Alt Greeting ${idx + 1}` })
      })
    }

    if (!options.some(o => o.value === selectedCategory)) {
      selectedCategory = 'description'
    }

    catSelect.update({ options, value: selectedCategory })
  }

  // --- 3. CUSTOM INSTRUCTIONS ---
  const promptSlot = document.createElement('div')
  container.appendChild(promptSlot)

  const promptSection = ctx.components.mountCollapsibleSection(promptSlot, {
    title: 'Customize AI Instructions',
    defaultExpanded: false
  })

  const basePromptInput = ctx.components.mountTextArea(promptSection.body, {
    value: '',
    rows: 3,
    placeholder: 'Base AI Instructions...',
    onChange: (v) => { currentPrompts.base = v }
  })
  activeMounts.push(basePromptInput)

  const savePromptsBtn = document.createElement('button')
  savePromptsBtn.textContent = 'Save Custom Instructions'
  savePromptsBtn.className = 'btn'
  savePromptsBtn.style.cssText = 'margin-top:8px; width:100%; font-size:12px; padding:6px;'
  savePromptsBtn.onclick = () => {
    ctx.sendToBackend({ type: 'save_prompts', prompts: currentPrompts })
  }
  promptSection.body.appendChild(savePromptsBtn)

  // --- 4. TEXT VIEWER & VERSION DRAFTS ---
  const viewHeader = document.createElement('div')
  viewHeader.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-bottom:-8px;'
  container.appendChild(viewHeader)

  const viewLabel = document.createElement('div')
  viewLabel.style.cssText = 'font-size:12px; font-weight:600; text-transform:uppercase; color:var(--lumiverse-text-dim, #9ca3af);'
  viewLabel.textContent = 'Version History & Preview'
  viewHeader.appendChild(viewLabel)

  const variantSelectSlot = document.createElement('div')
  container.appendChild(variantSelectSlot)

  const variantSelect = ctx.components.mountSelect(variantSelectSlot, {
    value: 'live',
    placeholder: 'Version',
    options: [{ value: 'live', label: 'Live Card Text' }],
    onChange: (v) => {
      selectedVersionKey = v
      renderCurrentText()
    }
  })
  activeMounts.push(variantSelect)

  const textViewerSlot = document.createElement('div')
  container.appendChild(textViewerSlot)

  const textViewerInput = ctx.components.mountTextArea(textViewerSlot, {
    value: '',
    rows: 5,
    placeholder: 'Select a character above...'
  })
  activeMounts.push(textViewerInput)

  const draftActionsRow = document.createElement('div')
  draftActionsRow.style.cssText = 'display:flex; gap:8px;'
  container.appendChild(draftActionsRow)

  const saveDraftBtn = document.createElement('button')
  saveDraftBtn.textContent = 'Save Current as Draft'
  saveDraftBtn.className = 'btn'
  saveDraftBtn.style.flex = '1'
  saveDraftBtn.onclick = () => {
    if (!selectedCharId) return
    ctx.sendToBackend({
      type: 'save_draft',
      characterId: selectedCharId,
      category: selectedCategory,
      text: textViewerInput.getValue()
    })
  }
  draftActionsRow.appendChild(saveDraftBtn)

  const applyBtn = document.createElement('button')
  applyBtn.textContent = 'Apply to Card'
  applyBtn.className = 'btn'
  applyBtn.style.cssText = 'flex:1; background:var(--lumiverse-success, #10b981); color:#fff; border:none; font-weight:600;'
  applyBtn.onclick = () => {
    if (!selectedCharId) return
    ctx.sendToBackend({
      type: 'apply_to_card',
      characterId: selectedCharId,
      category: selectedCategory,
      text: textViewerInput.getValue()
    })
  }
  draftActionsRow.appendChild(applyBtn)

  const deleteDraftBtn = document.createElement('button')
  deleteDraftBtn.textContent = 'Delete Selected Draft'
  deleteDraftBtn.className = 'btn'
  deleteDraftBtn.style.cssText = 'background:var(--lumiverse-danger, #ef4444); color:#fff; border:none; display:none;'
  deleteDraftBtn.onclick = () => {
    if (selectedVersionKey === 'live' || !selectedCharId) return
    ctx.sendToBackend({
      type: 'delete_draft',
      characterId: selectedCharId,
      category: selectedCategory,
      index: parseInt(selectedVersionKey, 10)
    })
  }
  container.appendChild(deleteDraftBtn)

  function renderCurrentText() {
    if (selectedVersionKey === 'live') {
      textViewerInput.update({ value: liveTextRaw })
      deleteDraftBtn.style.display = 'none'
    } else {
      const idx = parseInt(selectedVersionKey, 10)
      textViewerInput.update({ value: savedVariants[idx] || '' })
      deleteDraftBtn.style.display = 'block'
    }
  }

  function updateVariantOptions() {
    const options = [{ value: 'live', label: 'Live Card Text' }]
    savedVariants.forEach((_, i) => {
      options.push({ value: i.toString(), label: `Draft Version ${i + 1}` })
    })
    variantSelect.update({ options, value: selectedVersionKey })
    renderCurrentText()
  }

  // --- 5. AI GENERATION ---
  const divider = document.createElement('div')
  divider.style.cssText = 'border-top:1px solid var(--lumiverse-border, rgba(255,255,255,0.1)); margin:4px 0;'
  container.appendChild(divider)

  const generateBtn = document.createElement('button')
  generateBtn.textContent = 'Rewrite with AI'
  generateBtn.className = 'btn'
  generateBtn.style.cssText = 'background:var(--lumiverse-primary, #6366f1); color:#fff; font-weight:600; padding:10px;'
  generateBtn.onclick = () => {
    if (!selectedCharId) return
    generateBtn.disabled = true
    generateBtn.textContent = 'Rewriting with AI...'
    showStatus('AI is processing your request...', 'info')
    ctx.sendToBackend({
      type: 'generate_rewrite',
      characterId: selectedCharId,
      category: selectedCategory,
      originalText: textViewerInput.getValue()
    })
  }
  container.appendChild(generateBtn)

  const aiResultSlot = document.createElement('div')
  container.appendChild(aiResultSlot)

  const aiResultInput = ctx.components.mountTextArea(aiResultSlot, {
    value: '',
    rows: 5,
    placeholder: 'AI generated rewrite will appear here...'
  })
  activeMounts.push(aiResultInput)

  const saveAiDraftBtn = document.createElement('button')
  saveAiDraftBtn.textContent = 'Save AI Result as Draft'
  saveAiDraftBtn.className = 'btn'
  saveAiDraftBtn.style.cssText = 'display:none; background:var(--lumiverse-primary, #6366f1); color:#fff;'
  saveAiDraftBtn.onclick = () => {
    if (!selectedCharId || !aiResultInput.getValue()) return
    ctx.sendToBackend({
      type: 'save_draft',
      characterId: selectedCharId,
      category: selectedCategory,
      text: aiResultInput.getValue()
    })
  }
  container.appendChild(saveAiDraftBtn)

  // --- BACKEND IPC HANDLERS ---
  function requestInitData() {
    hideStatus()
    const currentUrl = window.location.pathname + window.location.hash
    const match = currentUrl.match(/\/(characters|chat)\/([a-zA-Z0-9_-]+)/)
    ctx.sendToBackend({
      type: 'get_init_data',
      routeType: match ? match[1] : null,
      routeId: match ? match[2] : null
    })
  }

  function fetchCategoryText() {
    if (!selectedCharId) return
    textViewerInput.update({ value: 'Loading aspect text...' })
    ctx.sendToBackend({
      type: 'get_char_text',
      characterId: selectedCharId,
      category: selectedCategory
    })
  }

  ctx.onBackendMessage((payload: any) => {
    if (payload.type === 'permission_error') {
      showStatus(`<strong>Permissions Required:</strong> ${payload.error}`, 'error')
      charSelect.update({ placeholder: 'Permissions required', options: [] })
      return
    }

    if (payload.type === 'backend_error') {
      showStatus(`<strong>Backend Error:</strong> ${payload.error}`, 'error')
      generateBtn.disabled = false
      generateBtn.textContent = 'Rewrite with AI'
      return
    }

    if (payload.type === 'init_data') {
      hideStatus()
      characterList = payload.chars || []
      currentPrompts = payload.prompts || {}
      basePromptInput.update({ value: currentPrompts.base || '' })

      if (characterList.length === 0) {
        showStatus('No character cards found in your library.', 'warning')
        charSelect.update({ value: '', placeholder: 'No characters available', options: [] })
        return
      }

      selectedCharId = payload.activeCharId || characterList[0]?.id || ''

      charSelect.update({
        value: selectedCharId,
        placeholder: 'Select Character',
        searchPlaceholder: 'Search character...',
        options: characterList.map((c: any) => ({
          value: c.id,
          label: c.name,
          leading: c.image_id ? { type: 'image', src: `/api/v1/images/${c.image_id}?size=sm` } : undefined
        }))
      })

      updateAspectOptions()
      if (selectedCharId) fetchCategoryText()
    }

    if (payload.type === 'char_text_result') {
      liveTextRaw = payload.text || ''
      savedVariants = payload.variants || []
      selectedVersionKey = 'live'
      updateVariantOptions()
      aiResultInput.update({ value: '' })
      saveAiDraftBtn.style.display = 'none'
    }

    if (payload.type === 'generate_success') {
      generateBtn.disabled = false
      generateBtn.textContent = 'Rewrite with AI'
      showStatus('AI rewrite completed!', 'success')
      aiResultInput.update({ value: payload.result })
      saveAiDraftBtn.style.display = 'block'
    }

    if (payload.type === 'draft_saved') {
      showStatus('Draft version saved!', 'success')
      savedVariants = payload.variants || []
      selectedVersionKey = (savedVariants.length - 1).toString()
      updateVariantOptions()
      aiResultInput.update({ value: '' })
      saveAiDraftBtn.style.display = 'none'
    }

    if (payload.type === 'apply_success') {
      showStatus('Character card updated successfully!', 'success')
      liveTextRaw = payload.text || ''
      selectedVersionKey = 'live'
      updateVariantOptions()
      requestInitData()
    }

    if (payload.type === 'prompts_saved') {
      showStatus('Instructions saved successfully!', 'success')
      currentPrompts = payload.prompts
    }
  })

  const unsubTabActivate = tab.onActivate(() => {
    requestInitData()
  })

  requestInitData()

  return () => {
    tab.destroy()
    unsubTabActivate()
    fab.removeEventListener('click', handleFabClick)
    ctx.dom.uninject(fab)
    activeMounts.forEach(m => m?.destroy?.())
  }
}
