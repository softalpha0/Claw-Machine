/**
 * RTP proof. Runs millions of real seeds through the SAME resolve() the game and
 * contract use, and checks the empirical return against the closed-form RTP.
 *
 *   node scripts/montecarlo.ts            # 5,000,000 plays per mode
 *   node scripts/montecarlo.ts 20000000   # more, for a tighter interval
 *
 * Eligibility bar: theoretical RTP in [0.93, 0.98] and declared == actual.
 */

import { randomBytes } from "node:crypto";
import { MODES, MODE_ORDER, theoreticalRtp, maxWinX, DECLARED_RTP } from "../src/game/config.ts";
import { resolve, type ResultKind } from "../src/game/outcome.ts";

const N = Math.max(1, Number(process.argv[2] ?? 2_000_000) | 0);
const BET = 1;
const KINDS: ResultKind[] = ["whiff", "slip", "grab", "bonus"];

console.log(`\nCLAW — Monte-Carlo RTP proof   (${N.toLocaleString()} plays / mode)\n`);

let allOk = true;

for (const id of MODE_ORDER) {
  const m = MODES[id];
  let sumPayout = 0;
  let sumSq = 0;
  const kindCount: Record<ResultKind, number> = { whiff: 0, slip: 0, grab: 0, bonus: 0 };
  let maxSeen = 0;

  for (let i = 0; i < N; i++) {
    const o = resolve(randomBytes(32), id, BET);
    sumPayout += o.payout;
    sumSq += o.payout * o.payout;
    kindCount[o.kind]++;
    if (o.payoutX > maxSeen) maxSeen = o.payoutX;
  }

  const empirical = sumPayout / N;
  const variance = sumSq / N - empirical * empirical;
  const stderr = Math.sqrt(variance / N);
  const theo = theoreticalRtp(m);
  const drift = empirical - theo;
  const within3sigma = Math.abs(drift) <= 3 * stderr + 1e-9;
  const inBand = theo >= 0.93 && theo <= 0.98;
  const ok = within3sigma && inBand;
  allOk &&= ok;

  console.log(`${m.label}`);
  console.log(`  theoretical RTP : ${(theo * 100).toFixed(4)} %   (in 93-98 band: ${inBand ? "yes" : "NO"})`);
  console.log(`  empirical  RTP : ${(empirical * 100).toFixed(4)} %  ± ${(stderr * 100).toFixed(4)} (1σ)`);
  console.log(`  drift          : ${(drift * 100).toFixed(4)} pp   (within 3σ: ${within3sigma ? "yes" : "NO"})`);
  console.log(`  house edge     : ${((1 - theo) * 100).toFixed(4)} %`);
  console.log(`  max win        : ${maxWinX(m).toFixed(2)}x  (largest seen this run: ${maxSeen.toFixed(2)}x)`);
  console.log(
    `  outcome mix    : ` +
      KINDS.map((k) => `${k} ${((kindCount[k] / N) * 100).toFixed(2)}%`).join("  "),
  );
  // Closed-form frequency cross-check
  const fWhiff = 1 - m.grab;
  const fSlip = m.grab * m.slip;
  const fBonus = m.grab * (1 - m.slip) * m.bonusChance;
  const fGrab = m.grab * (1 - m.slip) * (1 - m.bonusChance);
  console.log(
    `  expected mix   : whiff ${(fWhiff * 100).toFixed(2)}%  slip ${(fSlip * 100).toFixed(2)}%  ` +
      `grab ${(fGrab * 100).toFixed(2)}%  bonus ${(fBonus * 100).toFixed(2)}%`,
  );
  console.log(`  -> ${ok ? "PASS" : "FAIL"}\n`);
}

const blended = MODE_ORDER.reduce((a, id) => a + theoreticalRtp(MODES[id]), 0) / MODE_ORDER.length;
console.log(`equal-weight blended theoretical RTP : ${(blended * 100).toFixed(4)} %`);
console.log(`declared RTP (config.DECLARED_RTP)   : ${(DECLARED_RTP * 100).toFixed(2)} %`);
console.log(`\n${allOk ? "ALL MODES PASS ✅" : "SOMETHING FAILED ❌"}\n`);
process.exit(allOk ? 0 : 1);
