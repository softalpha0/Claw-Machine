import type { HostSnapshotV1 } from './types';

const BASIS_POINTS = 10_000n;

/**
 * - `limit`: the platform accepts wagers up to `maxWager`.
 * - `no-limit`: the host publishes its limits and none of them binds this bet
 *   (a ≤1x multiplier reserves no profit and no `maxBetAmount` is configured).
 * - `unknown`: the host publishes nothing to derive a limit from (older hosts,
 *   or a non-finite multiplier) — fall back to your own limits instead of
 *   treating it as unlimited.
 */
export type MaxWagerResult =
  | { kind: 'limit'; maxWager: bigint }
  | { kind: 'no-limit' }
  | { kind: 'unknown' };

const toBigIntOrUndefined = (value: string | undefined): bigint | undefined => {
  if (value === undefined) return undefined;
  try {
    return BigInt(value);
  } catch {
    return undefined;
  }
};

const limit = (maxWager: bigint): MaxWagerResult => ({ kind: 'limit', maxWager });

/**
 * The highest wager `openSession` accepts right now, in token base units, for
 * a game whose worst-case payout is `wager * maxMultiplierX` — the shape of
 * every linear `quoteCaps` implementation. Mirrors the casino facet's checks:
 * the round's reserved profit (`wager * (maxMultiplierX - 1)`) must fit in
 * `casino.maxAllowedReservedProfit`, and the wager itself must stay under
 * `casino.maxBetAmount` when the platform has configured one.
 *
 * Games whose reserved profit is not linear in the wager should invert their
 * own `quoteCaps` against `casino.maxAllowedReservedProfit` directly.
 */
export const computeMaxWager = (
  snapshot: Pick<HostSnapshotV1, 'casino'> | null | undefined,
  input: { maxMultiplierX: number },
): MaxWagerResult => {
  const casino = snapshot?.casino;
  if (!casino) return { kind: 'unknown' };

  const maxBetAmount = toBigIntOrUndefined(casino.maxBetAmount);
  const wagerCeiling = maxBetAmount && maxBetAmount > 0n ? maxBetAmount : undefined;

  if (!Number.isFinite(input.maxMultiplierX)) {
    return wagerCeiling === undefined ? { kind: 'unknown' } : limit(wagerCeiling);
  }
  // Ceil to a basis point: a coarser multiplier may only shrink the result,
  // so the returned wager is never one the facet would still reject.
  const multiplierBps = BigInt(Math.ceil(input.maxMultiplierX * Number(BASIS_POINTS)));
  const reservedProfitBps = multiplierBps - BASIS_POINTS;

  // A ≤1x multiplier reserves no profit, so the risk leg never binds.
  if (reservedProfitBps <= 0n) {
    return wagerCeiling === undefined ? { kind: 'no-limit' } : limit(wagerCeiling);
  }

  const maxAllowedReservedProfit = toBigIntOrUndefined(casino.maxAllowedReservedProfit);
  if (maxAllowedReservedProfit === undefined) {
    return wagerCeiling === undefined ? { kind: 'unknown' } : limit(wagerCeiling);
  }

  const riskBoundWager = (maxAllowedReservedProfit * BASIS_POINTS) / reservedProfitBps;
  if (wagerCeiling === undefined) return limit(riskBoundWager);
  return limit(riskBoundWager < wagerCeiling ? riskBoundWager : wagerCeiling);
};
