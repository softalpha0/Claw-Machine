/**
 * THE outcome function. Pure, deterministic, seed-in / result-out.
 *
 * This exact logic is:
 *   - run by the frontend to drive the reveal animation
 *   - run by scripts/montecarlo.ts to prove the empirical RTP
 *   - mirrored 1:1 in contracts/ClawMachineV2.sol (onRandomness)
 *
 * Seed index map (keccak256(seed ++ index)):
 *   0  -> held?      1  -> slipped?      2  -> bonus?      10 -> which prize
 */

import { MODES, type ModeId, type ModeConfig } from "./config.ts";
import { PRIZES_BY_MODE } from "./prizes.ts";
import { toSeed, uniform, weightedPick, bytesToHex, type Seed } from "./rng.ts";

export type ResultKind = "whiff" | "slip" | "grab" | "bonus";

export interface Outcome {
  mode: ModeId;
  bet: number;
  /** Payout as a multiple of the bet (0, consolation, mult, or mult*bonusFactor). */
  payoutX: number;
  /** Absolute payout in chUSD, rounded to 6 dp. */
  payout: number;
  kind: ResultKind;
  /** Prize won on a clean grab, else null. Flavour only — never affects payout. */
  prizeKey: string | null;
  /** The raw uniforms, for the "verify" panel. */
  rolls: { held: number; slip: number; bonus: number };
  seedHex: string;
}

/** chUSD has 6 decimals; the contract truncates at each WAD division, so we do too. */
const floor6 = (n: number) => Math.floor(n * 1e6) / 1e6;

export function resolve(seedInput: string | Uint8Array, mode: ModeId, bet: number): Outcome {
  const seed: Seed = toSeed(seedInput);
  const m: ModeConfig = MODES[mode];

  const held = uniform(seed, 0);
  const slip = uniform(seed, 1);
  const bonus = uniform(seed, 2);
  const rolls = { held, slip, bonus };
  const seedHex = bytesToHex(seed);

  // 1. Did the claw grip anything?
  if (held >= m.grab) {
    return { mode, bet, payoutX: 0, payout: 0, kind: "whiff", prizeKey: null, rolls, seedHex };
  }

  // 2. Did it slip out on the lift?
  if (slip < m.slip) {
    return {
      mode, bet, payoutX: m.consolation, payout: floor6(bet * m.consolation),
      kind: "slip", prizeKey: null, rolls, seedHex,
    };
  }

  // 3. Clean grab — pick the prize, then check for the stuck-together bonus.
  const pool = PRIZES_BY_MODE[mode];
  const prizeKey = pool[weightedPick(seed, 10, pool.map((x) => x.weight))]!.key;
  const clean = floor6(bet * m.mult);

  if (bonus < m.bonusChance) {
    return {
      mode, bet, payoutX: m.mult * m.bonusFactor, payout: floor6(clean * m.bonusFactor),
      kind: "bonus", prizeKey, rolls, seedHex,
    };
  }

  return {
    mode, bet, payoutX: m.mult, payout: clean,
    kind: "grab", prizeKey, rolls, seedHex,
  };
}

/** Human sentence for the verify panel / logs. */
export function explain(o: Outcome): string {
  const m = MODES[o.mode];
  const lines = [
    `mode ${m.label}  bet ${o.bet}`,
    `held  u=${o.rolls.held.toFixed(6)}  < grab ${m.grab}?  ${o.rolls.held < m.grab ? "YES" : "no -> whiff"}`,
  ];
  if (o.rolls.held < m.grab) {
    lines.push(
      `slip  u=${o.rolls.slip.toFixed(6)}  < slip ${m.slip}?  ${o.rolls.slip < m.slip ? "YES -> consolation" : "no"}`,
    );
    if (o.rolls.slip >= m.slip) {
      lines.push(
        `bonus u=${o.rolls.bonus.toFixed(6)}  < ${m.bonusChance}?  ${o.rolls.bonus < m.bonusChance ? `YES -> x${m.bonusFactor}` : "no"}`,
      );
    }
  }
  lines.push(`payout ${o.payoutX}x = ${o.payout} chUSD  [${o.kind}]`);
  return lines.join("\n");
}
