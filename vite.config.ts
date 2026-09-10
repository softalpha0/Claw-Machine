import { defineConfig } from "vite";

// Keep the bundle tiny so the game loads near-instantly inside the harness iframe.
export default defineConfig({
  base: "./",
  // The game runs in the host's iframe on another origin, and the host fetches
  // /game.manifest.json cross-origin — CORS must stay open (matches the SDK's
  // coinflip example).
  server: { port: 5173, cors: true },
  preview: { port: 5173, cors: true },
  build: {
    target: "es2022",
    assetsInlineLimit: 4096,
    rollupOptions: {
      output: { manualChunks: undefined },
    },
  },
});
