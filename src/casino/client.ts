/**
 * Every call that touches money or randomness goes through this interface, so
 * the game core never imports the SDK directly.
 *
 *   - MockClient   : standalone playable demo (its own seed + balance, localStorage)
 *   - ChainSdkClient: real @chain/casino-sdk bridge, used inside chain.wtf / the harness
 *
 * Both return an identical PlayResult so the reveal animation is shared code.
 */

import type { ModeId } from "../game/config.ts";
import type { Outcome } from "../game/outcome.ts";

export interface PlayResult {
  outcome: Outcome;
  /** Player balance in chUSD AFTER stake and payout have settled. */
  balance: number;
}

export interface CasinoClient {
  /** "mock" for the standalone demo, "chain" when wired to the SDK bridge. */
  readonly kind: "mock" | "chain";
  /** Resolves once the client is ready (session open, balance known). */
  ready(): Promise<void>;
  getBalance(): number;
  minBet(): number;
  maxBet(): number;
  /**
   * Stake `bet`, ask the chain for randomness, and resolve the play.
   * The Promise settles when the seed is known — the caller then animates the
   * reveal and calls `commitReveal()` when the animation has shown the payout.
   */
  play(mode: ModeId, bet: number): Promise<PlayResult>;
  /** Tell the host the reveal animation finished (SDK: revealOutcome). No-op for mock. */
  commitReveal(): void;
  /** Fired when the host pushes a new balance / session snapshot. */
  onBalanceChange(cb: (balance: number) => void): void;
}
