/**
 * Kenney "Game Icons" (CC0, kenney.nl) — the HUD glyphs. White art; CSS flips
 * them dark where they sit on the yellow (vault) header band. Imported so Vite
 * hashes + bundles them.
 */
import audioOn from "../assets/icons/audioOn-w.png";
import audioOff from "../assets/icons/audioOff-w.png";
import minus from "../assets/icons/minus-w.png";
import plus from "../assets/icons/plus-w.png";
import target from "../assets/icons/target-w.png";
import trophy from "../assets/icons/trophy-w.png";
import star from "../assets/icons/star-w.png";
import bars from "../assets/icons/barsVertical-w.png";
import medal from "../assets/icons/medal1-w.png";
import back from "../assets/icons/return-w.png";

export const ICON = { audioOn, audioOff, minus, plus, target, trophy, star, bars, medal, back } as const;
export type IconName = keyof typeof ICON;
