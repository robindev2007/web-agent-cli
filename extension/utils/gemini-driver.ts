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
   * Fast, human-like text injection with natural jitter
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

    // Small natural delay (30-80ms)
    await new Promise((r) => setTimeout(r, 30 + Math.floor(Math.random() * 50)));

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

    // Natural human pause before clicking send (100-250ms)
    await new Promise((r) => setTimeout(r, 120 + Math.floor(Math.random() * 120)));

    return inserted;
  }

  /**
   * Humanized click send with realistic mouse hover/down/up events and Enter key
   */
  static async clickSend(): Promise<boolean> {
    const editor = this.getEditor();
    const sendBtn = this.getSendButton();

    if (sendBtn) {
      // Give Angular / Lit a natural moment to register the input and enable the button
      for (let i = 0; i < 12; i++) {
        if (!sendBtn.disabled && sendBtn.getAttribute('aria-disabled') !== 'true') break;
        await new Promise((r) => setTimeout(r, 35));
      }

      sendBtn.removeAttribute('disabled');
      sendBtn.setAttribute('aria-disabled', 'false');

      // Dispatch natural pointer/mouse interaction sequence
      const PointerCtor = typeof PointerEvent !== 'undefined' ? PointerEvent : MouseEvent;
      const pointerInit = { bubbles: true, cancelable: true, view: window, pointerType: 'mouse', isPrimary: true };
      const mouseInit = { bubbles: true, cancelable: true, view: window, button: 0 };

      try {
        sendBtn.dispatchEvent(new PointerCtor('pointerover', pointerInit));
        sendBtn.dispatchEvent(new PointerCtor('pointerenter', pointerInit));
        sendBtn.dispatchEvent(new PointerCtor('pointerdown', pointerInit));
      } catch {}

      sendBtn.dispatchEvent(new MouseEvent('mousedown', mouseInit));

      try {
        sendBtn.dispatchEvent(new PointerCtor('pointerup', pointerInit));
      } catch {}

      sendBtn.dispatchEvent(new MouseEvent('mouseup', mouseInit));
      sendBtn.click();
    }

    // 2. Dispatch Enter key with realistic keydown/keypress/keyup sequence
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
        new KeyboardEvent('keypress', {
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

    // 3. Poll for confirmation (isGenerating OR editor cleared)
    for (let i = 0; i < 20; i++) {
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
    // Wait for any previous turn to finish naturally
    for (let i = 0; i < 30; i++) {
      if (!this.isGenerating()) break;
      await new Promise((r) => setTimeout(r, 150));
    }

    // Natural human pause before interacting (200-450ms)
    await new Promise((r) => setTimeout(r, 200 + Math.floor(Math.random() * 250)));

    // Wait for editor element to appear in DOM
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
    timeoutMs: number = 60000,
    onChunk?: (fullText: string, chunk: string) => void
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      let generationDetected = false;
      let settleTimer: any = null;

      const getResponseElements = (): HTMLElement[] => {
        const els = Array.from(
          document.querySelectorAll<HTMLElement>(
            'message-content, model-response, .model-response-text'
          )
        );
        if (els.length > 0) return els;
        return Array.from(document.querySelectorAll<HTMLElement>('.markdown'));
      };

      const initialElements = getResponseElements();
      const initialCount = initialElements.length;
      const initialLastText = initialCount > 0 ? initialElements[initialCount - 1].innerText.trim() : '';

      let lastLength = 0;
      let isNewElementFound = false;

      const extractCurrentText = (): string => {
        const currentElements = getResponseElements();
        if (currentElements.length > initialCount) {
          isNewElementFound = true;
          const target = currentElements[currentElements.length - 1];
          return target ? target.innerText.trim() : '';
        }

        // If updated in place
        if (!isNewElementFound && currentElements.length === initialCount && initialCount > 0) {
          const target = currentElements[initialCount - 1];
          const text = target ? target.innerText.trim() : '';
          if (text !== initialLastText && text.startsWith(initialLastText)) {
            return text.slice(initialLastText.length).trim();
          } else if (text !== initialLastText) {
            return text;
          }
        }

        return '';
      };

      const emitChunkIfNew = (): string => {
        const current = extractCurrentText();
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

        if (generating || current.length > 0) {
          generationDetected = true;
        }

        if (generationDetected && !generating) {
          if (!settleTimer) {
            settleTimer = setTimeout(() => {
              observer.disconnect();
              clearInterval(watchdog);
              const text = emitChunkIfNew();
              resolve(text || current);
            }, 200);
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
          if (current.length > 0) {
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
