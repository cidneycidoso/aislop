import type { SpindleFrontendContext } from 'lumiverse-spindle-types'

export function setup(ctx: SpindleFrontendContext) {
  // 1. Register Drawer Tab in Lumiverse sidebar
  const drawerTab = ctx.ui.registerDrawerTab({
    id: 'character-ai-rewriter',
    title: 'AI Character Rewriter',
    icon: 'edit',
  })

  // 2. Inject Lumiverse-native styling
  ctx.dom.injectStyle(`
    .car-container {
      display: flex;
      flex-direction: column;
      gap: 16px;
      padding: 16px;
      color: var(--lumiverse-text, #e2e8f0);
      font-family: inherit;
      max-width: 900px;
      margin: 0 auto;
    }
    .car-card {
      background: var(--lumiverse-bg-elevated, #1e293b);
      border: 1px solid var(--lumiverse-border, rgba(255, 255, 255, 0.1));
      border-radius: var(--lumiverse-radius, 8px);
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .car-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--lumiverse-text, #f8fafc);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .car-row {
      display: flex;
      gap: 12px;
      align-items: center;
      flex-wrap: wrap;
    }
    .car-field-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
      flex: 1;
      min-width: 200px;
    }
    .car-label {
      font-size: 12px;
      color: var(--lumiverse-text-muted, #94a3b8);
      font-weight: 500;
    }
    .car-select, .car-input, .car-textarea {
      background: var(--lumiverse-fill, #0f172a);
      border: 1px solid var(--lumiverse-border, rgba(255, 255, 255, 0.15));
      border-radius: var(--lumiverse-radius, 6px);
      color: var(--lumiverse-text, #f1f5f9);
      padding: 8px 12px;
      font-size: 13px;
      outline: none;
      width: 100%;
      box-sizing: border-box;
    }
    .car-textarea {
      min-height: 110px;
      resize: vertical;
      font-family: monospace;
      line-height: 1.4;
    }
    .car-btn {
      background: var(--lumiverse-primary, #3b82f6);
      color: #ffffff;
      border: none;
      border-radius: var(--lumiverse-radius, 6px);
      padding: 8px 16px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      transition: opacity 0.2s;
    }
    .car-btn:hover { opacity: 0.9; }
    .car-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .car-btn-secondary {
      background: rgba(255, 255, 255, 0.08);
      color: var(--lumiverse-text, #e2e8f0);
      border: 1px solid var(--lumiverse-border, rgba(255, 255, 255, 0.15));
    }
    .car-btn-success {
      background: #10b981;
    }
    .car-btn-danger {
      background: #ef4444;
    }
    .car-version-item {
      background: var(--lumiverse-fill, #0f172a);
      border: 1px solid var(--lumiverse-border, rgba(255, 255, 255, 0.1));
      border-radius: var(--lumiverse-radius, 6px);
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .car-badge {
      font-size: 10px;
      background: rgba(59, 130, 246, 0.2);
      color: #60a5fa;
      padding: 2px 6px;
      border-radius: 4px;
      align-self: flex-start;
    }
    .car-status {
      font-size: 12px;
      padding: 8px;
      border-radius: 6px;
      display: none;
    }
    .car-status.error { background: rgba(239, 68, 68, 0.15); color: #fca5a5; display: block; }
    .car-status.info { background: rgba(59, 130, 246, 0.15); color: #93c5fd; display: block; }
  `)

  // 3. Render HTML Shell
  drawerTab.root.innerHTML = `
    <div class="car-container">
      <div id="car-status" class="car-status"></div>

      <!-- Character & Field Selector Card -->
      <div class="car-card">
        <div class="car-title">1. Select Character & Characteristic</div>
        <div class="car-row">
          <div class="car-field-group">
            <label class="car-label">Character Card</label>
            <select id="car-char-select" class="car-select">
              <option value="">Loading characters...</option>
            </select>
          </div>
          <div class="car-field-group">
            <label class="car-label">Characteristic Field</label>
            <select id="car-field-select" class="car-select">
              <option value="description">Description</option>
              <option value="personality">Personality</option>
              <option value="first_mes">Main Greeting (first_mes)</option>
              <option value="scenario">Scenario</option>
              <option value="post_history_instructions">Post-History Instructions</option>
              <option value="alternate_greetings">Alternate Greetings</option>
            </select>
          </div>
        </div>

        <div class="car-field-group">
          <label class="car-label">Original Content Preview</label>
          <textarea id="car-original-text" class="car-textarea" readonly placeholder="Select a character to view field content..."></textarea>
        </div>
      </div>

      <!-- AI Prompt & Generation Card -->
      <div class="car-card">
        <div class="car-title">2. AI Rewrite Prompt</div>
        
        <div class="car-row">
          <div class="car-field-group">
            <label class="car-label">Load Saved Prompt Template</label>
            <div class="car-row">
              <select id="car-prompt-select" class="car-select" style="flex: 1;">
                <option value="">-- Custom Prompt --</option>
              </select>
              <button id="car-btn-del-prompt" class="car-btn car-btn-danger" title="Delete Saved Prompt" style="display:none;">✕</button>
            </div>
          </div>
        </div>

        <div class="car-field-group">
          <label class="car-label">Instruction / Prompt for AI</label>
          <textarea id="car-prompt-text" class="car-textarea" placeholder="e.g. Rewrite this description to be more dramatic, expanding on physical features and sensory details..."></textarea>
        </div>

        <div class="car-row">
          <button id="car-btn-generate" class="car-btn">
            <span>✨ Generate AI Rewrite</span>
          </button>
          
          <button id="car-btn-save-prompt" class="car-btn car-btn-secondary">
            <span>💾 Save Prompt Template</span>
          </button>
        </div>
      </div>

      <!-- AI Result & Action Card -->
      <div class="car-card" id="car-result-card" style="display: none;">
        <div class="car-title">3. Generated Result Preview</div>
        <div class="car-field-group">
          <textarea id="car-result-text" class="car-textarea" style="min-height: 140px;"></textarea>
        </div>
        <div class="car-row">
          <button id="car-btn-save-ver" class="car-btn car-btn-secondary">
            📌 Save as New Version
          </button>
          <button id="car-btn-apply-card" class="car-btn car-btn-success">
            ⚡ Apply to Original Card
          </button>
        </div>
      </div>

      <!-- Saved Versions History -->
      <div class="car-card">
        <div class="car-title">4. Saved Versions History</div>
        <div id="car-versions-list" style="display: flex; flex-direction: column; gap: 10px;">
          <div style="font-size: 12px; color: var(--lumiverse-text-muted);">No saved versions for this field yet.</div>
        </div>
      </div>
    </div>
  `

  // State Management
  let characters: any[] = []
  let savedPrompts: any[] = []
  let savedVersions: any[] = []
  let currentCharacter: any = null
  let currentGeneratedText: string = ''

  // DOM Handles
  const statusEl = drawerTab.root.querySelector('#car-status') as HTMLElement
  const charSelect = drawerTab.root.querySelector('#car-char-select') as HTMLSelectElement
  const fieldSelect = drawerTab.root.querySelector('#car-field-select') as HTMLSelectElement
  const originalText = drawerTab.root.querySelector('#car-original-text') as HTMLTextAreaElement
  const promptSelect = drawerTab.root.querySelector('#car-prompt-select') as HTMLSelectElement
  const promptText = drawerTab.root.querySelector('#car-prompt-text') as HTMLTextAreaElement
  const btnDelPrompt = drawerTab.root.querySelector('#car-btn-del-prompt') as HTMLButtonElement
  const btnGenerate = drawerTab.root.querySelector('#car-btn-generate') as HTMLButtonElement
  const btnSavePrompt = drawerTab.root.querySelector('#car-btn-save-prompt') as HTMLButtonElement
  const resultCard = drawerTab.root.querySelector('#car-result-card') as HTMLElement
  const resultText = drawerTab.root.querySelector('#car-result-text') as HTMLTextAreaElement
  const btnSaveVer = drawerTab.root.querySelector('#car-btn-save-ver') as HTMLButtonElement
  const btnApplyCard = drawerTab.root.querySelector('#car-btn-apply-card') as HTMLButtonElement
  const versionsList = drawerTab.root.querySelector('#car-versions-list') as HTMLElement

  function showStatus(msg: string, type: 'info' | 'error' = 'info') {
    statusEl.className = `car-status ${type}`
    statusEl.textContent = msg
    if (type === 'info') setTimeout(() => { statusEl.style.display = 'none' }, 4000)
  }

  function updateOriginalField() {
    if (!currentCharacter) {
      originalText.value = ''
      return
    }
    const field = fieldSelect.value
    const val = currentCharacter[field]
    if (Array.isArray(val)) {
      originalText.value = val.join('\n\n---\n\n')
    } else {
      originalText.value = val || ''
    }
    renderVersions()
  }

  function renderVersions() {
    if (!currentCharacter) {
      versionsList.innerHTML = '<div style="font-size:12px;color:var(--lumiverse-text-muted);">Select a character card above.</div>'
      return
    }
    const field = fieldSelect.value
    const charVersions = savedVersions.filter((v) => v.characterId === currentCharacter.id && v.field === field)

    if (charVersions.length === 0) {
      versionsList.innerHTML = `<div style="font-size:12px;color:var(--lumiverse-text-muted);">No saved versions for ${fieldSelect.options[fieldSelect.selectedIndex].text}.</div>`
      return
    }

    versionsList.innerHTML = ''
    charVersions.forEach((ver) => {
      const item = document.createElement('div')
      item.className = 'car-version-item'
      const dateStr = new Date(ver.createdAt).toLocaleString()

      item.innerHTML = `
        <div class="car-row" style="justify-content: space-between;">
          <span class="car-badge">${dateStr}</span>
          <div style="display:flex; gap:6px;">
            <button class="car-btn car-btn-secondary car-ver-apply" style="padding: 4px 8px; font-size: 11px;">Apply to Card</button>
            <button class="car-btn car-btn-danger car-ver-del" style="padding: 4px 8px; font-size: 11px;">Delete</button>
          </div>
        </div>
        <div style="font-size:11px; color: var(--lumiverse-text-muted);">Prompt: ${ver.promptUsed}</div>
        <textarea class="car-textarea" style="min-height:70px;" readonly>${ver.text}</textarea>
      `

      item.querySelector('.car-ver-apply')?.addEventListener('click', () => {
        ctx.sendToBackend({
          type: 'apply_to_card',
          characterId: ver.characterId,
          field: ver.field,
          newText: ver.text,
        })
      })

      item.querySelector('.car-ver-del')?.addEventListener('click', () => {
        ctx.sendToBackend({ type: 'delete_version', id: ver.id })
      })

      versionsList.appendChild(item)
    })
  }

  function renderPromptsDropdown() {
    promptSelect.innerHTML = '<option value="">-- Custom Prompt --</option>'
    savedPrompts.forEach((p) => {
      const opt = document.createElement('option')
      opt.value = p.id
      opt.textContent = p.title
      promptSelect.appendChild(opt)
    })
  }

  // Event Listeners
  charSelect.addEventListener('change', () => {
    const charId = charSelect.value
    currentCharacter = characters.find((c) => c.id === charId) || null
    updateOriginalField()
  })

  fieldSelect.addEventListener('change', () => {
    updateOriginalField()
  })

  promptSelect.addEventListener('change', () => {
    const selectedId = promptSelect.value
    const found = savedPrompts.find((p) => p.id === selectedId)
    if (found) {
      promptText.value = found.prompt
      btnDelPrompt.style.display = 'inline-flex'
    } else {
      btnDelPrompt.style.display = 'none'
    }
  })

  btnDelPrompt.addEventListener('click', () => {
    if (promptSelect.value) {
      ctx.sendToBackend({ type: 'delete_prompt_template', id: promptSelect.value })
    }
  })

  btnSavePrompt.addEventListener('click', async () => {
    const promptValue = promptText.value.trim()
    if (!promptValue) {
      showStatus('Please write a prompt first.', 'error')
      return
    }
    const title = prompt('Enter a name for this prompt template:')
    if (title) {
      ctx.sendToBackend({ type: 'save_prompt_template', title, prompt: promptValue })
    }
  })

  btnGenerate.addEventListener('click', () => {
    if (!currentCharacter) {
      showStatus('Please select a character first.', 'error')
      return
    }
    const instructions = promptText.value.trim()
    if (!instructions) {
      showStatus('Please enter an instruction/prompt for the AI.', 'error')
      return
    }

    btnGenerate.disabled = true
    btnGenerate.textContent = '⏳ Generating with AI...'
    resultCard.style.display = 'none'

    ctx.sendToBackend({
      type: 'generate_rewrite',
      characterName: currentCharacter.name,
      fieldLabel: fieldSelect.options[fieldSelect.selectedIndex].text,
      currentValue: originalText.value,
      instructions,
    })
  })

  btnSaveVer.addEventListener('click', () => {
    if (!currentCharacter || !currentGeneratedText) return
    ctx.sendToBackend({
      type: 'save_version',
      characterId: currentCharacter.id,
      field: fieldSelect.value,
      text: resultText.value,
      promptUsed: promptText.value.trim(),
    })
    showStatus('Version saved to history!', 'info')
  })

  btnApplyCard.addEventListener('click', () => {
    if (!currentCharacter || !resultText.value) return
    ctx.sendToBackend({
      type: 'apply_to_card',
      characterId: currentCharacter.id,
      field: fieldSelect.value,
      newText: resultText.value,
    })
  })

  // Backend Message Receiver
  ctx.onBackendMessage((msg: any) => {
    switch (msg.type) {
      case 'characters_list': {
        characters = msg.characters || []
        charSelect.innerHTML = '<option value="">Select a character...</option>'
        characters.forEach((c) => {
          const opt = document.createElement('option')
          opt.value = c.id
          opt.textContent = c.name
          charSelect.appendChild(opt)
        })
        break
      }

      case 'initial_data': {
        savedPrompts = msg.prompts || []
        savedVersions = msg.versions || []
        renderPromptsDropdown()
        renderVersions()
        break
      }

      case 'prompts_updated': {
        savedPrompts = msg.prompts || []
        renderPromptsDropdown()
        promptSelect.value = ''
        btnDelPrompt.style.display = 'none'
        showStatus('Prompts updated successfully!', 'info')
        break
      }

      case 'versions_updated': {
        savedVersions = msg.versions || []
        renderVersions()
        break
      }

      case 'rewrite_generated': {
        btnGenerate.disabled = false
        btnGenerate.textContent = '✨ Generate AI Rewrite'
        currentGeneratedText = msg.text
        resultText.value = msg.text
        resultCard.style.display = 'flex'
        showStatus('AI rewrite generated!', 'info')
        break
      }

      case 'card_applied_success': {
        characters = msg.characters || []
        if (currentCharacter) {
          currentCharacter = characters.find((c) => c.id === currentCharacter.id) || null
        }
        updateOriginalField()
        showStatus(`Character ${msg.field} updated directly on card!`, 'info')
        break
      }

      case 'error': {
        btnGenerate.disabled = false
        btnGenerate.textContent = '✨ Generate AI Rewrite'
        showStatus(msg.message, 'error')
        break
      }
    }
  })

  // Initialize
  ctx.sendToBackend({ type: 'get_characters' })
  ctx.sendToBackend({ type: 'get_initial_data' })
}
