/**
 * AI-generated photo for each prize (public/images/prizes/<key>.jpg), shown on
 * the collection shelf. The hand-authored vector glyph (prizeArt.ts) is still
 * drawn underneath every slot as a backing layer — if a photo is missing or
 * fails to load, the vector glyph simply shows through, so a bad or absent
 * generation never breaks the shelf.
 */
import { PRIZES } from "./prizes.ts";

const at = (rel: string) => new URL(rel, document.baseURI).href;

export const PRIZE_IMAGE: Record<string, string> = Object.fromEntries(
  PRIZES.map((p) => [p.key, at(`images/prizes/${p.key}.jpg`)]),
);
