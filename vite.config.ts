import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { mermaid: fileURLToPath(new URL("./src/lib/mermaidCompat.ts", import.meta.url)) },
  },
  assetsInclude: ["**/*.json.gz"],
  build: {
    rollupOptions: {
      external: ["/wails/runtime.js"],
    },
  },
  plugins: [react()],
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
});
