import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['src/tests/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 40_000,
    // e2e 用真实子进程服务器，串行执行避免端口冲突
    fileParallelism: false,
  },
});
