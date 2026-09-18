/**
 * SINGLE SOURCE OF TRUTH for the game math.
 *
 * The frontend, the Monte-Carlo proof (scripts/montecarlo.ts) and the Solidity
 * contract (contracts/ClawMachineV2.sol) all encode THESE SAME numbers. If you
 * change a value here, re-run `npm run montecarlo` and update MATH.md + the
 * contract constants to match, or the entry fails eligibility ("declared math
 * matching the actual paytable").
 *
 * Outcome model for one play at mode M with bet B:
 *
 *   u1, u2, u3  <- three independent uniforms in [0,1) derived from the VRF seed
 *
 *   held    = u1 < grab
 *   if !held                       -> payout 0                      ("whiff")
 *   slipped = u2 < slip
 *   if held && slipped             -> payout B * consolation        ("so close")
 *   bonus   = u3 < bonusChance
 *   if held && !slipped && !bonus  -> payout B * mult
 *   if held && !slipped && bonus   -> payout B * mult * bonusFactor ("double grab")
 *
 * Closed-form RTP for a mode:
 *   RTP = grab*(1-slip)*mult*(1 + bonusChance*(bonusFactor-1)) + grab*slip*consolation
 */

export type ModeId = "plush" | "gadget" | "vault";

export interface ModeConfig {
  id: ModeId;
  label: string;
  blurb: string;
  /** P(claw grips the prize at all). */
  grab: number;
  /** P(prize slips out on the way up | gripped). */
  slip: number;
  /** Fraction of bet returned when the prize slips out. */
  consolation: number;
  /** Base payout multiplier on a clean grab. */
  mult: number;
  /** P(the claw yanks up a stuck-together bonus prize | clean grab). */
  bonusChance: number;
  /** Payout is multiplied by this on a bonus. */
  bonusFactor: number;
  /** Cosmetic only — accent colour for the mode. */
  accent: string;
}

export const MODES: Record<ModeId, ModeConfig> = {
  plush: {
    id: "plush",
    label: "PLUSH PIT",
    blurb: "friendly grabs, small prizes",
    grab: 0.72,
    slip: 0.12,
    consolation: 0.2,
    mult: 1.41,
    bonusChance: 0.05,
    bonusFactor: 2.0,
    accent: "#ff5a8a",
  },
  gadget: {
    id: "gadget",
    label: "GADGET GRAB",
    blurb: "trickier claw, chunkier payouts",
    grab: 0.48,
    slip: 0.15,
    consolation: 0.2,
    mult: 2.175,
    bonusChance: 0.06,
    bonusFactor: 2.0,
    accent: "#2fb8f0",
  },
  vault: {
    id: "vault",
    label: "JACKPOT VAULT",
    blurb: "rarely holds, pays big when it does",
    grab: 0.22,
    slip: 0.18,
    consolation: 0.2,
    mult: 4.526,
    bonusChance: 0.08,
    bonusFactor: 3.0,
    accent: "#ffc928",
  },
};

export const MODE_ORDER: ModeId[] = ["plush", "gadget", "vault"];
export const DEFAULT_MODE: ModeId = "plush";

export const BET_STEPS = [1, 2, 5, 10, 25, 50, 100] as const;
export const DEFAULT_BET = 5;

/** Declared, rounded RTP shown to players / judges. Verified by montecarlo. */
export const DECLARED_RTP = 0.955;

/** Closed-form RTP for a mode — used by the game UI and the proof script. */
export function theoreticalRtp(m: ModeConfig): number {
  const clean = m.grab * (1 - m.slip) * m.mult * (1 + m.bonusChance * (m.bonusFactor - 1));
  const consolation = m.grab * m.slip * m.consolation;
  return clean + consolation;
}

/** Largest multiple of the bet a mode can return. */
export function maxWinX(m: ModeConfig): number {
  return m.mult * m.bonusFactor;
}
