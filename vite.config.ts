import { defineConfig } from "vite";

// Keep the bundle tiny so the game loads near-instantly inside the harness iframe.
export default defineConfig({
  base: "./",
  // @chain/casino-sdk is only present in the harness build. The standalone demo
  // never loads it (see main.ts) — keep it external so `vite build` of the demo
  // doesn't try to resolve it.
  optimizeDeps: { exclude: ["@chain/casino-sdk"] },
  build: {
    target: "es2022",
    assetsInlineLimit: 4096,
    rollupOptions: {
      external: [/^@chain\/casino-sdk/],
      output: { manualChunks: undefined },
    },
  },
});
