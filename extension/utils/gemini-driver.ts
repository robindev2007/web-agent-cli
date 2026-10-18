/**
 * High-Speed Gemini DOM Driver with Multi-Selector Support, Auto-Stop, and Error Recovery
 */
export class GeminiDriver {
  static getEditor(): HTMLElement | null {
    return (
      document.querySelector('rich-textarea .ql-editor') ||
      document.querySelector('rich-textarea div[contenteditable="true"]') ||
      document.querySelector('div.ql-editor[contenteditable="true"]') ||
      document.querySelector('div[contenteditable="true"]') ||
      document.querySelector('p[data-placeholder]')
    );
  }

  static getSendButton(): HTMLButtonElement | null {
    const selectors = [
      'button[aria-label="Send message"]',
      'button[aria-label*="Send" i]',
      'button[aria-label*="send" i]',
      'button.send-button',
      '.send-button button',
      'button:has(mat-icon[data-mat-icon-name="send"])',
      'button:has(mat-icon[fonticon="send"])',
      'button:has(mat-icon)',
    ];

    for (const sel of selectors) {
      try {
        const btn = document.querySelector<HTMLButtonElement>(sel);
        if (btn) {
          const label = (btn.getAttribute('aria-label') || '').toLowerCase();
          if (label.includes('stop')) continue;
          return btn;
        }
      } catch {}
    }
    return null;
  }

  static isGenerating(): boolean {
    const stopBtn = document.querySelector(
      'button[aria-label="Stop response"], button[aria-label*="Stop" i]'
    );
    return !!stopBtn;
  }

  static stopGenerating(): boolean {
    const stopBtn = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Stop response"], button[aria-label*="Stop" i]'
    );
    if (stopBtn) {
      stopBtn.click();
      return true;
    }
    return false;
  }

  /**
   * Fast, native text injection with automatic fallback
   */
  static async setPromptText(text: string): Promise<boolean> {
    const editor = this.getEditor();
    if (!editor) return false;

    editor.focus();

    // Select all existing content to replace it
    const range = document.createRange();
    range.selectNodeContents(editor);
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }

    let inserted = false;
    try {
      inserted = document.execCommand('insertText', false, text);
    } catch {}

    if (!inserted || !editor.innerText.trim()) {
      editor.innerHTML = `<p>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}</p>`;
      inserted = true;
    }

    try {
      editor.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: text }));
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    } catch {
      editor.dispatchEvent(new Event('beforeinput', { bubbles: true }));
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    }
    editor.dispatchEvent(new Event('change', { bubbles: true }));
    editor.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true }));

    return inserted;
  }

  /**
   * High-speed click send with button click and Enter key trigger
   */
  static async clickSend(): Promise<boolean> {
    const editor = this.getEditor();

    // 1. Click send button directly if found
    const sendBtn = this.getSendButton();
    if (sendBtn) {
      sendBtn.removeAttribute('disabled');
      sendBtn.setAttribute('aria-disabled', 'false');
      sendBtn.click();
    }

    // 2. Dispatch Enter key to trigger submit
    if (editor) {
      editor.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true,
        })
      );
      editor.dispatchEvent(
        new KeyboardEvent('keyup', {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true,
        })
      );
    }

    // 3. Short poll (up to 1.5s) to check if generation started or editor cleared
    for (let i = 0; i < 15; i++) {
      if (this.isGenerating()) return true;
      if (editor && !editor.innerText.trim()) return true;

      const currentBtn = this.getSendButton();
      if (currentBtn && !currentBtn.disabled && currentBtn.getAttribute('aria-disabled') !== 'true') {
        currentBtn.click();
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    return true;
  }

  /**
   * Send prompt with clean auto-wait:
   * If Gemini is currently generating, wait for it to finish naturally without clicking Stop.
   */
  static async sendPrompt(text: string): Promise<{ success: boolean; error?: string }> {
    // Wait for any previous turn to finish naturally (do NOT click stop!)
    for (let i = 0; i < 20; i++) {
      if (!this.isGenerating()) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    // Wait for editor element to appear in DOM (critical for newly opened tabs)
    for (let i = 0; i < 30; i++) {
      if (this.getEditor()) break;
      await new Promise((r) => setTimeout(r, 200));
    }

    const typed = await this.setPromptText(text);
    if (!typed) return { success: false, error: 'Failed to type prompt into editor.' };

    await this.clickSend();
    return { success: true };
  }

  /**
   * Instant response completion detection via MutationObserver with 50ms final settle
   */
  static async waitForResponse(
    timeoutMs: number = 35000,
    onChunk?: (fullText: string, chunk: string) => void
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      let generationDetected = false;
      let settleTimer: any = null;

      const extractFinalText = () => {
        const elements = document.querySelectorAll('message-content, model-response, .model-response-text');
        if (elements.length > 0) {
          return (elements[elements.length - 1] as HTMLElement).innerText.trim();
        }
        const markdown = document.querySelectorAll('.markdown');
        if (markdown.length > 0) {
          return (markdown[markdown.length - 1] as HTMLElement).innerText.trim();
        }
        return '';
      };

      const initialText = extractFinalText();
      const initialLength = initialText.length;
      let lastLength = initialLength;

      const emitChunkIfNew = () => {
        const current = extractFinalText();
        if (current.length > lastLength) {
          const delta = current.slice(lastLength);
          lastLength = current.length;
          onChunk?.(current, delta);
        }
        return current;
      };

      const targetNode =
        document.querySelector('infinite-scroller') ||
        document.querySelector('chat-window') ||
        document.body;

      const checkCompletion = () => {
        const generating = this.isGenerating();
        const current = emitChunkIfNew();

        if (generating || current.length > initialLength) {
          generationDetected = true;
        }

        if (generationDetected && !generating) {
          if (!settleTimer) {
            settleTimer = setTimeout(() => {
              observer.disconnect();
              clearInterval(watchdog);
              const text = emitChunkIfNew();
              resolve(text || current);
            }, 150);
          }
        } else if (generating && settleTimer) {
          clearTimeout(settleTimer);
          settleTimer = null;
        }
      };

      const observer = new MutationObserver(() => {
        checkCompletion();
      });

      observer.observe(targetNode, {
        childList: true,
        subtree: true,
        characterData: true,
      });

      // Watchdog fallback
      const watchdog = setInterval(() => {
        if (Date.now() - startTime > timeoutMs) {
          clearInterval(watchdog);
          observer.disconnect();
          const current = emitChunkIfNew();
          if (current.length > initialLength) {
            resolve(current);
          } else {
            reject(new Error('Timeout waiting for Gemini response.'));
          }
          return;
        }

        checkCompletion();
      }, 100);
    });
  }
}
