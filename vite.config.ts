import { defineConfig } from "vite";

// Keep the bundle tiny so the game loads near-instantly inside the harness iframe.
export default defineConfig({
  base: "./",
  optimizeDeps: { exclude: ["@chain/casino-sdk", "@chain/casino-sdk/guest"] },
  build: {
    target: "es2022",
    assetsInlineLimit: 4096,
    rollupOptions: {
      // The standalone demo never loads the SDK (main.ts only dynamic-imports
      // chainClient inside the harness iframe), so mark it external and the
      // demo build resolves fine without the package installed.
      //
      // WHEN WIRING THE HARNESS: `npm link @chain/casino-sdk` (or add it to
      // package.json pointing at the unzipped SDK), then DELETE the `external`
      // line below so Vite bundles guest.ts + penpal into the chainClient chunk.
      external: [/^@chain\/casino-sdk/],
      output: { manualChunks: undefined },
    },
  },
});
