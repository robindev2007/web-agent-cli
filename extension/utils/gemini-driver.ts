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
      'button[aria-label="Stop response"], button[aria-label*="Stop" i], button.stop-button, mat-icon[fonticon="stop"], mat-icon[data-mat-icon-name="stop"]'
    );
    if (stopBtn) return true;

    // Check for thinking / search in progress / loading indicators
    const loading = document.querySelector(
      '.loading-spinner, .sparkle-animation, .generating, [aria-label*="Thinking" i], [aria-label*="Searching" i]'
    );
    if (loading) return true;

    return false;
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

  static getResponseElements(): HTMLElement[] {
    const messageContents = Array.from(
      document.querySelectorAll<HTMLElement>('message-content')
    );
    if (messageContents.length > 0) return messageContents;

    const markdowns = Array.from(
      document.querySelectorAll<HTMLElement>('model-response .markdown, .model-response-text .markdown, .model-response-text')
    );
    if (markdowns.length > 0) return markdowns;

    return Array.from(document.querySelectorAll<HTMLElement>('.markdown'));
  }

  static extractPureText(el: HTMLElement | null): string {
    if (!el) return '';
    const clone = el.cloneNode(true) as HTMLElement;
    const junk = clone.querySelectorAll(
      '.search-queries, .grounding-carousel, .attribution-container, .citation, button, mat-icon, .actions-container, .code-block-decoration, .code-header, [class*="code-header"], [class*="code-block-decoration"]'
    );
    junk.forEach((j) => j.remove());
    let text = clone.innerText.trim();
    // Strip UI code block header artifacts if any leaked into text
    text = text.replace(/^Code snippet\s*/gim, '').replace(/^Copy code\s*/gim, '').trim();
    return text;
  }

  static lastResponseCount: number = 0;

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

    // Anchor the baseline response count BEFORE injecting and clicking send
    GeminiDriver.lastResponseCount = this.getResponseElements().length;

    const typed = await this.setPromptText(text);
    if (!typed) return { success: false, error: 'Failed to type prompt into editor.' };

    await this.clickSend();
    return { success: true };
  }

  /**
   * Precise response detection isolating only markdown message content
   */
  static async waitForResponse(
    timeoutMs: number = 90000,
    onChunk?: (fullText: string, chunk: string) => void
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      let generationDetected = false;
      let settleTimer: any = null;

      const initialCount = GeminiDriver.lastResponseCount;
      let lastLength = 0;

      const extractCurrentText = (): string => {
        const currentElements = GeminiDriver.getResponseElements();
        if (currentElements.length > initialCount) {
          const target = currentElements[currentElements.length - 1];
          return GeminiDriver.extractPureText(target);
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

        if (generationDetected && !generating && current.length > 0) {
          if (!settleTimer) {
            // Wait 1200ms quiet period without new tokens before declaring finish
            settleTimer = setTimeout(() => {
              observer.disconnect();
              clearInterval(watchdog);
              const text = emitChunkIfNew();
              resolve(text || current);
            }, 1200);
          }
        } else if ((generating || current.length > lastLength) && settleTimer) {
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
      }, 150);
    });
  }
}
