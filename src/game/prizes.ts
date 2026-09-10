/**
 * The prize catalogue. 30 collectibles, 10 per mode.
 *
 * IMPORTANT: prize identity is pure flavour. It is chosen from the seed but it
 * NEVER affects the payout — payout is entirely the multiplier math in
 * config.ts / outcome.ts. This keeps the declared RTP exact while still giving
 * players a "gotta grab 'em all" shelf to chase.
 */

import type { ModeId } from "./config.ts";

export type Rarity = "common" | "uncommon" | "rare" | "chase";

export interface Prize {
  key: string;
  name: string;
  mode: ModeId;
  rarity: Rarity;
  /** Draw weight within its mode's pool. */
  weight: number;
  /** Simple vector glyph drawn on the canvas + shelf. */
  shape: "bear" | "star" | "ghost" | "heart" | "duck" | "robot" | "cassette" | "cam" | "controller" | "chip" | "gem" | "crown" | "trophy" | "coinbag" | "diamond";
  color: string;
}

export const RARITY_COLOR: Record<Rarity, string> = {
  common: "#9aa7b4",
  uncommon: "#4ade80",
  rare: "#60a5fa",
  chase: "#f472b6",
};

export const RARITY_WEIGHT: Record<Rarity, number> = {
  common: 40,
  uncommon: 18,
  rare: 6,
  chase: 1.5,
};

function p(
  key: string,
  name: string,
  mode: ModeId,
  rarity: Rarity,
  shape: Prize["shape"],
  color: string,
): Prize {
  return { key, name, mode, rarity, weight: RARITY_WEIGHT[rarity], shape, color };
}

export const PRIZES: Prize[] = [
  // PLUSH PIT
  p("plush-bandit-bear", "Bandit Bear", "plush", "common", "bear", "#c08457"),
  p("plush-sad-duck", "Melancholy Duck", "plush", "common", "duck", "#f4d35e"),
  p("plush-heart", "Squish Heart", "plush", "common", "heart", "#ff6b9d"),
  p("plush-ghosty", "Lil' Ghosty", "plush", "uncommon", "ghost", "#e8e8f0"),
  p("plush-star-buddy", "Star Buddy", "plush", "uncommon", "star", "#ffd166"),
  p("plush-bear-king", "Bear King", "plush", "uncommon", "bear", "#a3672f"),
  p("plush-void-duck", "Void Duck", "plush", "rare", "duck", "#5b5b7a"),
  p("plush-glow-ghost", "Glowghost", "plush", "rare", "ghost", "#a0ffe6"),
  p("plush-supernova", "Supernova Star", "plush", "rare", "star", "#ff8c42"),
  p("plush-goldbear", "Solid Gold Bear", "plush", "chase", "bear", "#ffcf40"),

  // GADGET GRAB
  p("gad-cassette", "Mixtape '87", "gadget", "common", "cassette", "#8b9dc3"),
  p("gad-webcam", "Potato Cam", "gadget", "common", "cam", "#b0b8c1"),
  p("gad-chip", "Mystery Chip", "gadget", "common", "chip", "#6ee7b7"),
  p("gad-pad", "Bootleg Pad", "gadget", "uncommon", "controller", "#7dd3fc"),
  p("gad-cam-pro", "Cam Pro X", "gadget", "uncommon", "cam", "#94a3b8"),
  p("gad-cassette-clear", "Clear Cassette", "gadget", "uncommon", "cassette", "#a7f3d0"),
  p("gad-pad-elite", "Elite Pad", "gadget", "rare", "controller", "#38bdf8"),
  p("gad-chip-x", "Overclock Chip", "gadget", "rare", "chip", "#34d399"),
  p("gad-cam-ghost", "Ghost Cam", "gadget", "rare", "cam", "#c4b5fd"),
  p("gad-goldpad", "Golden Gamepad", "gadget", "chase", "controller", "#ffcf40"),

  // JACKPOT VAULT
  p("vault-chip-stack", "Chip Stack", "vault", "common", "chip", "#d4af37"),
  p("vault-coinbag", "Coin Sack", "vault", "common", "coinbag", "#e0b64a"),
  p("vault-gem-shard", "Gem Shard", "vault", "common", "gem", "#7fd4ff"),
  p("vault-ruby", "Cut Ruby", "vault", "uncommon", "gem", "#ff5470"),
  p("vault-emerald", "Cut Emerald", "vault", "uncommon", "gem", "#3ddc84"),
  p("vault-trophy", "Silver Trophy", "vault", "uncommon", "trophy", "#cbd5e1"),
  p("vault-crown", "Tin Crown", "vault", "rare", "crown", "#fcd34d"),
  p("vault-trophy-gold", "Gold Trophy", "vault", "rare", "trophy", "#ffd93d"),
  p("vault-sapphire", "Star Sapphire", "vault", "rare", "diamond", "#5b8cff"),
  p("vault-hope", "The Hope Rock", "vault", "chase", "diamond", "#8ef6ff"),
];

export const PRIZES_BY_MODE: Record<ModeId, Prize[]> = {
  plush: PRIZES.filter((x) => x.mode === "plush"),
  gadget: PRIZES.filter((x) => x.mode === "gadget"),
  vault: PRIZES.filter((x) => x.mode === "vault"),
};

export const PRIZE_BY_KEY: Record<string, Prize> = Object.fromEntries(
  PRIZES.map((x) => [x.key, x]),
);

export const TOTAL_PRIZES = PRIZES.length;
