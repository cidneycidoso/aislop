import type { SpindleFrontendContext } from 'lumiverse-spindle-types'

export function setup(ctx: SpindleFrontendContext) {
  const tab = ctx.ui.registerDrawerTab({
    id: 'ai-character-rewriter',
    title: 'AI Character Rewriter',
    headerTitle: 'Character Rewriter',
    shortName: 'Rewrite',
    description: 'Rewrite character descriptions, personalities, and greetings with AI',
    keywords: ['rewrite', 'character', 'ai', 'editor', 'greeting', 'prompt'],
    // Explicit 20x20 dimensions ensure proper rendering and clickable hit box in sidebar
    iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>'
  })

  // --- STATE ---
  let characterList: any[] = []
  let selectedCharId = ''
  let selectedCategory = 'description'
  let currentPrompts: any = {}
  let liveTextRaw = ''
  let savedVariants: string[] = []
  let selectedVersionKey = 'live' // 'live' or string index '0', '1', ...

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

  function hideStatus() {
    statusBanner.style.display = 'none'
  }

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
