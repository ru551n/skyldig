import { defineConfig } from "vite";

/**
 * Builds the operator admin app and the database setup tool into build/admin/ as plain Node
 * modules, next to the main app's build. Dependencies stay external and are loaded from the
 * image's production node_modules — scripts/check-runtime-deps.mjs checks every one is a
 * runtime dependency.
 */
export default defineConfig({
  publicDir: false,
  resolve: { tsconfigPaths: true },
  build: {
    ssr: true,
    outDir: "build/admin",
    emptyOutDir: true,
    target: "node24",
    rollupOptions: {
      input: { main: "server/admin/main.ts", "setup-db": "server/tools/setup-db.ts" },
      output: { format: "es", entryFileNames: "[name].js", chunkFileNames: "chunks/[name]-[hash].js" },
    },
  },
});
