import { defineConfig } from 'wxt';

// See https://wxt.dev/api/reference/wxt/interfaces/inlineconfig.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Gemini Coding Agent',
    description: 'Personal AI Coding Agent powered by Gemini Web',
    host_permissions: [
      'https://gemini.google.com/app*',
      'http://localhost:*/*',
      'ws://localhost:*/*'
    ],
    permissions: ['storage', 'tabs', 'scripting'],
  },
});
