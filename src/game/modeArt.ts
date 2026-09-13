/**
 * One AI-generated thumbnail per risk mode (public/images/modes/) — the
 * flourish icon shown on each mode card. Purely cosmetic; never touches the
 * math in config.ts.
 */
import type { ModeId } from "./config.ts";

// Files under public/ are served as-is at the site root, so resolve them
// against the document's own URL (same pattern as music.ts), not import.meta.url.
const at = (rel: string) => new URL(rel, document.baseURI).href;

export const MODE_IMAGE: Record<ModeId, string> = {
  plush: at("images/modes/plush.jpg"),
  gadget: at("images/modes/gadget.jpg"),
  vault: at("images/modes/vault.jpg"),
};
