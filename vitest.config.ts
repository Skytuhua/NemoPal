import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: Object.fromEntries(['contracts', 'api-client', 'project-ui', 'nemotron', 'codex-observer']
      .map(name => [`@living-playbooks/${name}`, fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url))])),
  },
  test: {
    environment: 'node',
    restoreMocks: true,
    testTimeout: 15000,
    projects: [
      { extends: true, test: { name: 'unit', include: ['tests/{contracts,cloud,desktop}/**/*.test.ts'] } },
      { extends: true, test: { name: 'ui', include: ['tests/ui/**/*.test.{ts,tsx}'], environment: 'jsdom', setupFiles: ['tests/ui/setup.ts'] } },
    ],
  },
});
