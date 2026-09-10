/**
 * Real bridge to chain.wtf / the local harness via @chain/casino-sdk.
 *
 * ┌─ RECONCILE WITH THE SDK ────────────────────────────────────────────────┐
 * │ The method names below come from the public SDK docs (sdk.chain.wtf):   │
 * │   connectGameToHost(), hostApi.openSession(), submitAction(),           │
 * │   revealOutcome().                                                      │
 * │ Once you `npm install` the SDK from your forked coinflip example, open  │
 * │ examples/coinflip-public/ and match the exact call shapes / payload     │
 * │ field names. Everything the rest of the game needs is behind the        │
 * │ CasinoClient interface, so only THIS file changes.                      │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * Contract side: contracts/ClawMachineV2.sol. `onRandomness` there must return
 * the exact same payout as resolve() here — that equality is the whole game.
 */

import { resolve } from "../game/outcome.ts";
import { MODES, type ModeId } from "../game/config.ts";
import type { CasinoClient, PlayResult } from "./client.ts";

// The SDK is only present when built for the harness; keep the import soft so the
// standalone demo bundle never needs it.
type HostApi = {
  openSession(args: { wager: bigint | number; action: unknown }): Promise<{
    seed: string;
    payout?: bigint | number;
    balance?: bigint | number;
  }>;
  revealOutcome?(): void | Promise<void>;
  submitAction?(action: unknown): Promise<unknown>;
  on?(event: "snapshot" | "balance", cb: (snap: { balance: bigint | number }) => void): void;
  caps?: { minWager: bigint | number; maxWager: bigint | number };
  balance?: bigint | number;
};

const asNumber = (v: bigint | number | undefined, fallback = 0): number =>
  v == null ? fallback : typeof v === "bigint" ? Number(v) / 1e6 /* chUSD 6dp */ : v;

export class ChainSdkClient implements CasinoClient {
  readonly kind = "chain" as const;
  private host!: HostApi;
  private balance = 0;
  private listeners: Array<(b: number) => void> = [];
  private started: Promise<void>;

  constructor() {
    this.started = this.connect();
  }

  private async connect(): Promise<void> {
    const sdk: any = await import(/* @vite-ignore */ "@chain/casino-sdk");
    // docs: guest-side initialiser for the iframe
    this.host = (await sdk.connectGameToHost()) as HostApi;
    this.balance = asNumber(this.host.balance, 0);
    this.host.on?.("snapshot", (snap) => this.setBalance(asNumber(snap.balance, this.balance)));
    this.host.on?.("balance", (snap) => this.setBalance(asNumber(snap.balance, this.balance)));
  }

  ready(): Promise<void> {
    return this.started;
  }
  getBalance(): number {
    return this.balance;
  }
  minBet(): number {
    return asNumber(this.host?.caps?.minWager, 1);
  }
  maxBet(): number {
    return asNumber(this.host?.caps?.maxWager, 100);
  }

  async play(mode: ModeId, bet: number): Promise<PlayResult> {
    await this.started;
    // The action payload is what the contract's onSessionStart / onPlayerAction
    // decodes. Keep it minimal: this is a one-shot game, the only choice is mode.
    const res = await this.host.openSession({
      wager: bet,
      action: { game: "claw", mode, modeIndex: Object.keys(MODES).indexOf(mode) },
    });

    // Resolve locally from the VRF seed for the animation. The contract has
    // already computed (or will settle) the identical payout on-chain.
    const outcome = resolve(res.seed, mode, bet);

    if (res.balance != null) this.setBalance(asNumber(res.balance, this.balance));
    else this.setBalance(this.balance - bet + outcome.payout);

    return { outcome, balance: this.balance };
  }

  commitReveal(): void {
    void this.host.revealOutcome?.();
  }

  onBalanceChange(cb: (b: number) => void): void {
    this.listeners.push(cb);
  }

  private setBalance(n: number): void {
    this.balance = n;
    for (const cb of this.listeners) cb(n);
  }
}
