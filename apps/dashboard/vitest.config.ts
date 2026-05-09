import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "happy-dom",
    setupFiles: ["./test/setup.ts"],
    globals: true,
    // Playwright specs under e2e/ are run by `playwright test`, not vitest.
    exclude: ["**/node_modules/**", "**/dist/**", "**/e2e/**"],
  },
  resolve: { alias: { "@": resolve(__dirname, ".") } },
});
