/** Run with `node scripts/checks/run.mjs`; esbuild is supplied by Vite. */
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

for (const check of ["outcome-collection-check.ts", "machine-check.ts", "audio-check.ts", "chain-client-check.ts"]) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(check, import.meta.url))],
    bundle: true, platform: "node", format: "esm", write: false,
    define: { "import.meta.env.BASE_URL": '"/"' },
    plugins: [{ name: "mock-host-bridge", setup(bundler) {
      bundler.onResolve({filter: /^@chain\/casino-sdk\/guest$/}, () => ({
        path: fileURLToPath(new URL("chain-sdk-mock.ts", import.meta.url)),
      }));
    } }],
    logLevel: "silent",
  });
  const compiled = result.outputFiles[0].text;
  try {
    await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
  } catch (error) {
    console.error(`${check}: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    break;
  }
}
