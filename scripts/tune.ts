/**
 * Solve for the payout multiplier that hits a target RTP, holding the other
 * knobs fixed. Use it when you tweak grab/slip/bonus and need `mult` back in band.
 *
 *   node scripts/tune.ts            # solve for DECLARED_RTP
 *   node scripts/tune.ts 0.96       # solve for a different target
 */

import { MODES, MODE_ORDER, theoreticalRtp, DECLARED_RTP } from "../src/game/config.ts";

const target = Number(process.argv[2] ?? DECLARED_RTP);
console.log(`\nSolving each mode's mult for RTP = ${(target * 100).toFixed(3)} %\n`);

for (const id of MODE_ORDER) {
  const m = MODES[id];
  // RTP = grab*(1-slip)*mult*(1 + bonusChance*(bonusFactor-1)) + grab*slip*consolation
  const consolationPart = m.grab * m.slip * m.consolation;
  const perMult = m.grab * (1 - m.slip) * (1 + m.bonusChance * (m.bonusFactor - 1));
  const solved = (target - consolationPart) / perMult;
  const rounded = Math.round(solved * 1000) / 1000;
  const rtpAtRounded = theoreticalRtp({ ...m, mult: rounded });
  console.log(
    `${m.label.padEnd(14)} current mult ${m.mult.toFixed(3)}  ->  solved ${solved.toFixed(4)}  ` +
      `(use ${rounded.toFixed(3)} -> RTP ${(rtpAtRounded * 100).toFixed(4)} %)`,
  );
}
console.log();
