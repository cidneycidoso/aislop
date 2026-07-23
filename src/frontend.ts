import type { SpindleFrontendContext } from 'lumiverse-spindle-types'

export function setup(ctx: SpindleFrontendContext) {
  // 1. Inject Styles
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
      font-size: 13px;
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
      min-height: 100px;
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
    .car-btn-success { background: #10b981; }
    .car-btn-danger { background: #ef4444; }
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
      padding: 8px 12px;
      border-radius: 6px;
      display: none;
    }
    .car-status.error { background: rgba(239, 68, 68, 0.15); color: #fca5a5; display: block; }
    .car-status.info { background: rgba(59, 130, 246, 0.15); color: #93c5fd; display: block; }
  `)

  // Function to build UI inside any mount point (Drawer or Modal)
  function createRewriterUI(targetRoot: HTMLElement) {
    targetRoot.innerHTML = `
      <div class="car-container">
        <div class="car-status"></div>

        <div class="car-card">
          <div class="car-title">1. Select Character & Field</div>
          <div class="car-row">
            <div class="car-field-group">
              <label class="car-label">Character Card</label>
              <select class="car-char-select car-select">
                <option value="">Loading characters...</option>
              </select>
            </div>
            <div class="car-field-group">
              <label class="car-label">Field / Characteristic</label>
              <select class="car-field-select car-select">
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
            <label class="car-label">Current Content</label>
            <textarea class="car-original-text car-textarea" readonly placeholder="Select a character card to view field content..."></textarea>
          </div>
        </div>

        <div class="car-card">
          <div class="car-title">2. AI Prompt</div>
          <div class="car-row">
            <div class="car-field-group">
              <label class="car-label">Saved Prompt Template</label>
              <div class="car-row">
                <select class="car-prompt-select car-select" style="flex: 1;">
                  <option value="">-- Custom Prompt --</option>
                </select>
                <button class="car-btn-del-prompt car-btn car-btn-danger" title="Delete Saved Prompt" style="display:none; padding: 6px 10px;">✕</button>
              </div>
            </div>
          </div>

          <div class="car-field-group">
            <label class="car-label">Instruction for AI</label>
            <textarea class="car-prompt-text car-textarea" placeholder="e.g. Rewrite this description to be more dramatic and detailed..."></textarea>
          </div>

          <div class="car-row">
            <button class="car-btn-generate car-btn">
              <span>✨ Generate AI Rewrite</span>
            </button>
            <button class="car-btn-save-prompt car-btn car-btn-secondary">
              <span>💾 Save Prompt Template</span>
            </button>
          </div>
        </div>

        <div class="car-card car-result-card" style="display: none;">
          <div class="car-title">3. Generated Output</div>
          <div class="car-field-group">
            <textarea class="car-result-text car-textarea" style="min-height: 130px;"></textarea>
          </div>
          <div class="car-row">
            <button class="car-btn-save-ver car-btn car-btn-secondary">
              📌 Save as New Version
            </button>
            <button class="car-btn-apply-card car-btn car-btn-success">
              ⚡ Apply directly to Card
            </button>
          </div>
        </div>

        <div class="car-card">
          <div class="car-title">4. Saved Versions History</div>
          <div class="car-versions-list" style="display: flex; flex-direction: column; gap: 10px;">
            <div style="font-size: 12px; color: var(--lumiverse-text-muted);">No saved versions for this field yet.</div>
          </div>
        </div>
      </div>
    `

    // State
    let characters: any[] = []
    let savedPrompts: any[] = []
    let savedVersions: any[] = []
    let currentCharacter: any = null

    // Handles
    const statusEl = targetRoot.querySelector('.car-status') as HTMLElement
    const charSelect = targetRoot.querySelector('.car-char-select') as HTMLSelectElement
    const fieldSelect = targetRoot.querySelector('.car-field-select') as HTMLSelectElement
    const originalText = targetRoot.querySelector('.car-original-text') as HTMLTextAreaElement
    const promptSelect = targetRoot.querySelector('.car-prompt-select') as HTMLSelectElement
    const promptText = targetRoot.querySelector('.car-prompt-text') as HTMLTextAreaElement
    const btnDelPrompt = targetRoot.querySelector('.car-btn-del-prompt') as HTMLButtonElement
    const btnGenerate = targetRoot.querySelector('.car-btn-generate') as HTMLButtonElement
    const btnSavePrompt = targetRoot.querySelector('.car-btn-save-prompt') as HTMLButtonElement
    const resultCard = targetRoot.querySelector('.car-result-card') as HTMLElement
    const resultText = targetRoot.querySelector('.car-result-text') as HTMLTextAreaElement
    const btnSaveVer = targetRoot.querySelector('.car-btn-save-ver') as HTMLButtonElement
    const btnApplyCard = targetRoot.querySelector('.car-btn-apply-card') as HTMLButtonElement
    const versionsList = targetRoot.querySelector('.car-versions-list') as HTMLElement

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
        versionsList.innerHTML = '<div style="font-size:12px;color:var(--lumiverse-text-muted);">Select a character above.</div>'
        return
      }
      const field = fieldSelect.value
      const charVersions = savedVersions.filter((v) => v.characterId === currentCharacter.id && v.field === field)

      if (charVersions.length === 0) {
        versionsList.innerHTML = `<div style="font-size:12px;color:var(--lumiverse-text-muted);">No saved versions for this field yet.</div>`
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

    charSelect.addEventListener('change', () => {
      const charId = charSelect.value
      currentCharacter = characters.find((c) => c.id === charId) || null
      updateOriginalField()
    })

    fieldSelect.addEventListener('change', () => updateOriginalField())

    promptSelect.addEventListener('change', () => {
      const found = savedPrompts.find((p) => p.id === promptSelect.value)
      if (found) {
        promptText.value = found.prompt
        btnDelPrompt.style.display = 'inline-flex'
      } else {
        btnDelPrompt.style.display = 'none'
      }
    })

    btnDelPrompt.addEventListener('click', () => {
      if (promptSelect.value) ctx.sendToBackend({ type: 'delete_prompt_template', id: promptSelect.value })
    })

    btnSavePrompt.addEventListener('click', () => {
      const val = promptText.value.trim()
      if (!val) return showStatus('Please write a prompt first.', 'error')
      const title = prompt('Name for this prompt template:')
      if (title) ctx.sendToBackend({ type: 'save_prompt_template', title, prompt: val })
    })

    btnGenerate.addEventListener('click', () => {
      if (!currentCharacter) return showStatus('Please select a character card first.', 'error')
      const instructions = promptText.value.trim()
      if (!instructions) return showStatus('Please enter instructions for the AI.', 'error')

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
      if (!currentCharacter || !resultText.value) return
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
          resultText.value = msg.text
          resultCard.style.display = 'flex'
          showStatus('AI rewrite generated!', 'info')
          break
        }
        case 'card_applied_success': {
          characters = msg.characters || []
          if (currentCharacter) currentCharacter = characters.find((c) => c.id === currentCharacter.id) || null
          updateOriginalField()
          showStatus(`Character card updated!`, 'info')
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

    ctx.sendToBackend({ type: 'get_characters' })
    ctx.sendToBackend({ type: 'get_initial_data' })
  }

  // 1. Register in Viewport Drawer Sidebar
  const drawerTab = ctx.ui.registerDrawerTab({
    id: 'character-ai-rewriter',
    title: 'AI Character Rewriter',
    shortName: 'Rewriter',
    headerTitle: 'AI Character Rewriter',
    description: 'Rewrite character card fields with custom AI prompts and version history',
    iconSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`,
  })
  createRewriterUI(drawerTab.root)

  // 2. Register directly inside native Character Editor modal (for instant access)
  const editorTab = ctx.ui.registerCharacterEditorTab({
    id: 'ai-rewriter-tab',
    title: 'AI Rewriter',
  })
  createRewriterUI(editorTab.root)
}

export default setup
