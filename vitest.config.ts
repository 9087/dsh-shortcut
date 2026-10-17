import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The client half imports the published ui-primitives, whose dist drags in
    // katex CSS. Inline the harness packages so their CSS goes through the
    // transform pipeline, and process CSS in tests.
    css: true,
    environment: 'jsdom',
    // The DOM-bridge spec drives MutationObserver + rAF batches, and the store
    // spec does real filesystem work; 20s keeps a load-sensitive machine from
    // turning a correct run red while a genuine hang still fails on time.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    include: ['tests/**/*.spec.{ts,tsx}'],
    server: {
      deps: {
        inline: [/@deepseek-ai/],
      },
    },
  },
})
