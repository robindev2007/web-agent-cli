import React, { useState, useEffect } from 'react';
import './App.css';
import { Send, Bot, CheckCircle2, AlertCircle, Loader2, Wifi, WifiOff, RefreshCw } from 'lucide-react';

function App() {
  const [prompt, setPrompt] = useState('Hello! Can you help me write code for my project?');
  const [status, setStatus] = useState<string>('Ready to test');
  const [statusType, setStatusType] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [bridgeStatus, setBridgeStatus] = useState<'CONNECTING' | 'CONNECTED' | 'DISCONNECTED'>('DISCONNECTED');
  const [geminiTabOpen, setGeminiTabOpen] = useState<boolean>(false);

  // Check connection status when popup opens
  const checkStatus = async () => {
    // 1. Check Gemini tab
    try {
      const tabs = await chrome.tabs.query({ url: 'https://gemini.google.com/app*' });
      setGeminiTabOpen(tabs && tabs.length > 0);
    } catch {
      setGeminiTabOpen(false);
    }

    // 2. Check bridge socket via background worker
    try {
      chrome.runtime.sendMessage({ type: 'CHECK_BRIDGE_STATUS' }, (res) => {
        if (res && res.state) {
          setBridgeStatus(res.state);
        }
      });
    } catch {
      setBridgeStatus('DISCONNECTED');
    }
  };

  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 1500);
    return () => clearInterval(interval);
  }, []);

  const handleSend = async () => {
    if (!prompt.trim()) return;

    setStatusType('loading');
    setStatus('Looking for Gemini tab...');

    try {
      const tabs = await chrome.tabs.query({ url: 'https://gemini.google.com/app*' });
      if (!tabs || tabs.length === 0) {
        setStatusType('error');
        setStatus('No Gemini tab found! Open https://gemini.google.com/app');
        return;
      }

      const geminiTab = tabs[0];
      setStatus('Injecting prompt into Gemini...');
      const response = await chrome.tabs.sendMessage(geminiTab.id!, {
        type: 'SEND_PROMPT',
        prompt: prompt.trim(),
      });

      if (response && response.success) {
        setStatusType('success');
        setStatus('Prompt successfully sent to Gemini!');
      } else {
        setStatusType('error');
        setStatus(response?.error || 'Failed to send prompt to Gemini.');
      }
    } catch (err: any) {
      setStatusType('error');
      setStatus(err.message || 'Error communicating with Gemini tab.');
    }
  };

  return (
    <div className="agent-container">
      <div className="header">
        <Bot className="bot-icon" size={24} />
        <div className="title-area">
          <h2>Gemini Coding Agent</h2>
          <span className="subtitle">Browser Automation Tester</span>
        </div>
      </div>

      {/* Connection Indicator Bar */}
      <div className="connection-bar">
        <div className="conn-item">
          <span className="conn-label">Terminal Bridge:</span>
          {bridgeStatus === 'CONNECTED' ? (
            <span className="badge badge-online">
              <Wifi size={12} /> Connected (3000)
            </span>
          ) : bridgeStatus === 'CONNECTING' ? (
            <span className="badge badge-warn">
              <Loader2 className="spin" size={12} /> Connecting...
            </span>
          ) : (
            <span className="badge badge-offline">
              <WifiOff size={12} /> Offline
            </span>
          )}
        </div>

        <div className="conn-item">
          <span className="conn-label">Gemini Tab:</span>
          {geminiTabOpen ? (
            <span className="badge badge-online">
              <CheckCircle2 size={12} /> Open
            </span>
          ) : (
            <span className="badge badge-offline">
              <AlertCircle size={12} /> Not Open
            </span>
          )}
        </div>
      </div>

      <div className="body">
        <label className="input-label" htmlFor="prompt-input">
          Test Prompt
        </label>
        <textarea
          id="prompt-input"
          className="prompt-textarea"
          rows={3}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Enter a prompt to send to Gemini..."
        />

        <button
          className="send-btn"
          onClick={handleSend}
          disabled={statusType === 'loading' || !prompt.trim()}
        >
          {statusType === 'loading' ? (
            <>
              <Loader2 className="spin" size={16} />
              <span>Sending...</span>
            </>
          ) : (
            <>
              <Send size={16} />
              <span>Send to Gemini</span>
            </>
          )}
        </button>

        <div className={`status-box status-${statusType}`}>
          {statusType === 'success' && <CheckCircle2 size={16} />}
          {statusType === 'error' && <AlertCircle size={16} />}
          {statusType === 'loading' && <Loader2 className="spin" size={16} />}
          <span className="status-text">{status}</span>
        </div>
      </div>
    </div>
  );
}

export default App;
