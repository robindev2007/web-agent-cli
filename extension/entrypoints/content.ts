import { GeminiDriver } from '../utils/gemini-driver';

export default defineContentScript({
  matches: ['https://gemini.google.com/app*'],
  runAt: 'document_idle',
  main() {
    console.log('%c[Gemini Agent] Content script loaded with GeminiDriver!', 'background: #1a73e8; color: #fff; padding: 4px 8px; border-radius: 4px; font-weight: bold;');

    // Expose driver globally on window for instant testing in Console
    (window as any).GeminiDriver = GeminiDriver;

    // Listen for messages from extension popup / side panel / background
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.type === 'PING') {
        sendResponse({ success: true, pong: true });
        return false;
      }

      if (message.type === 'SEND_PROMPT') {
        GeminiDriver.sendPrompt(message.prompt).then(res => {
          sendResponse(res);
        }).catch(err => {
          sendResponse({ success: false, error: err.message });
        });
        return true; // async response
      }

      if (message.type === 'GET_RESPONSE') {
        const timeoutMs = message.timeoutMs || 120000;
        sendResponse({ success: true, started: true });

        GeminiDriver.waitForResponse(timeoutMs, (fullText, chunk) => {
          chrome.runtime.sendMessage({
            type: 'GEMINI_STREAM_CHUNK',
            requestId: message.requestId,
            chunk,
            fullText,
          }).catch(() => {});
        })
          .then((text) => {
            chrome.runtime.sendMessage({
              type: 'GEMINI_RESPONSE_COMPLETE',
              requestId: message.requestId,
              text,
            }).catch(() => {});
          })
          .catch((err) => {
            chrome.runtime.sendMessage({
              type: 'GEMINI_RESPONSE_ERROR',
              requestId: message.requestId,
              error: err.message,
            }).catch(() => {});
          });
        return false;
      }
    });
  },
});

