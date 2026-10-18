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
    return (
      document.querySelector('button[aria-label="Send message"]') ||
      document.querySelector('button[aria-label*="Send"]') ||
      document.querySelector('button.send-button') ||
      document.querySelector('.send-button button')
    );
  }

  static isGenerating(): boolean {
    const stopBtn = document.querySelector(
      'button[aria-label="Stop response"], button[aria-label*="Stop"]'
    );
    return !!stopBtn;
  }

  static stopGenerating(): boolean {
    const stopBtn = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Stop response"], button[aria-label*="Stop"]'
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

    editor.dispatchEvent(new Event('beforeinput', { bubbles: true }));
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    editor.dispatchEvent(new Event('change', { bubbles: true }));

    return inserted;
  }

  /**
   * Click send button with low-latency polling & Enter key fallback
   */
  static async clickSend(): Promise<boolean> {
    for (let i = 0; i < 30; i++) {
      const sendBtn = this.getSendButton();
      if (sendBtn && !sendBtn.disabled && sendBtn.getAttribute('aria-disabled') !== 'true') {
        sendBtn.click();
        return true;
      }
      await new Promise((r) => setTimeout(r, 40));
    }

    // Fallback: Dispatch Enter key
    const editor = this.getEditor();
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
      await new Promise((r) => setTimeout(r, 200));
      if (this.isGenerating()) return true;
    }

    return false;
  }

  /**
   * Send prompt with smart auto-wait & recovery:
   * If Gemini is currently generating or locked from previous turns, stop it and wait.
   */
  static async sendPrompt(text: string): Promise<{ success: boolean; error?: string }> {
    // If Gemini is still generating from the previous turn, attempt to stop it
    if (this.isGenerating()) {
      this.stopGenerating();
      await new Promise((r) => setTimeout(r, 400));
    }

    for (let i = 0; i < 20; i++) {
      if (!this.isGenerating()) break;
      await new Promise((r) => setTimeout(r, 150));
    }

    if (this.isGenerating()) {
      return { success: false, error: 'Gemini took too long to finish previous response.' };
    }

    const typed = await this.setPromptText(text);
    if (!typed) return { success: false, error: 'Failed to type prompt into editor.' };

    const sent = await this.clickSend();
    if (!sent) return { success: false, error: 'Send button was not enabled or found.' };

    return { success: true };
  }

  /**
   * Instant response completion detection via MutationObserver
   */
  static async waitForResponse(
    timeoutMs: number = 180000,
    onChunk?: (fullText: string, chunk: string) => void
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      let generationDetected = false;
      let settleTimer: any = null;
      let lastLength = 0;

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

      const observer = new MutationObserver(() => {
        const generating = this.isGenerating();

        if (generating) {
          generationDetected = true;
          if (settleTimer) {
            clearTimeout(settleTimer);
            settleTimer = null;
          }
          emitChunkIfNew();
        } else if (generationDetected) {
          // Streaming has finished, debounce 150ms for final render
          if (!settleTimer) {
            settleTimer = setTimeout(() => {
              observer.disconnect();
              const text = emitChunkIfNew();
              resolve(text);
            }, 150);
          }
        }
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
          reject(new Error('Timeout waiting for Gemini response.'));
          return;
        }

        const generating = this.isGenerating();
        if (generating) {
          generationDetected = true;
          emitChunkIfNew();
        } else if (generationDetected) {
          clearInterval(watchdog);
          observer.disconnect();
          const text = emitChunkIfNew();
          resolve(text);
        }
      }, 200);
    });
  }
}
