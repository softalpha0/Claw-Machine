/**
 * THE outcome function. Pure, deterministic, seed-in / result-out.
 *
 * This exact logic is:
 *   - run by the frontend to drive the reveal animation
 *   - run by scripts/montecarlo.ts to prove the empirical RTP
 *   - mirrored 1:1 in contracts/ClawMachineV2.sol (onRandomness)
 *
 * The `seed` is the on-chain VRF word (bytes32) the facet hands `onRandomness`.
 * Index map — sha256(seed ++ uint32be(index)):
 *   0  -> held?      1  -> slipped?      2  -> bonus?      10 -> which prize
 * The held/slipped/bonus checks compare `uniformWad(i)` (BigInt) against a
 * 1e18-scaled threshold, identical integer math to the contract. The prize
 * pick is flavour and never affects payout, so it stays float.
 */

import { MODES, type ModeId, type ModeConfig } from "./config.ts";
import { PRIZES_BY_MODE, PRIZE_BY_KEY, type Prize } from "./prizes.ts";
import { toSeed, uniformWad, toWad, weightedPick, bytesToHex, type Seed } from "./rng.ts";

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

/** Cosmetic collection rewards. Index 11 never participates in payout math. */
export function getWonPrizes(o: Outcome): Prize[] {
  if (!o.prizeKey || (o.kind !== "grab" && o.kind !== "bonus")) return [];
  const first = PRIZE_BY_KEY[o.prizeKey];
  if (!first) return [];
  if (o.kind !== "bonus") return [first];
  const pool = PRIZES_BY_MODE[o.mode].filter(p => p.key !== first.key);
  const second = pool[weightedPick(toSeed(o.seedHex), 11, pool.map(p => p.weight))];
  return second ? [first, second] : [first];
}

export function resolve(seedInput: string | Uint8Array, mode: ModeId, bet: number): Outcome {
  const seed: Seed = toSeed(seedInput);
  const m: ModeConfig = MODES[mode];
  const seedHex = bytesToHex(seed);

  // Payout-affecting draws — WAD integers, identical to the contract.
  const heldW = uniformWad(seed, 0);
  const slipW = uniformWad(seed, 1);
  const bonusW = uniformWad(seed, 2);
  // Float mirrors for the verify panel only.
  const rolls = { held: Number(heldW) / 1e18, slip: Number(slipW) / 1e18, bonus: Number(bonusW) / 1e18 };

  // 1. Did the claw grip anything?
  if (heldW >= toWad(m.grab)) {
    return { mode, bet, payoutX: 0, payout: 0, kind: "whiff", prizeKey: null, rolls, seedHex };
  }

  // 2. Did it slip out on the lift?
  if (slipW < toWad(m.slip)) {
    return {
      mode, bet, payoutX: m.consolation, payout: floor6(bet * m.consolation),
      kind: "slip", prizeKey: null, rolls, seedHex,
    };
  }

  // 3. Clean grab — pick the prize, then check for the stuck-together bonus.
  const pool = PRIZES_BY_MODE[mode];
  const prizeKey = pool[weightedPick(seed, 10, pool.map((x) => x.weight))]!.key;
  const clean = floor6(bet * m.mult);

  if (bonusW < toWad(m.bonusChance)) {
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
