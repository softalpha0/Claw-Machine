/**
 * Real bridge to chain.wtf / the local simulator via @chain/casino-sdk/guest.
 *
 * Reconciled against the SDK (v0.2.0): src/guest.ts, src/types.ts, the coinflip
 * example (examples/coinflip-public/src/lib/useCasinoHost.ts + App.tsx) and
 * simulator/contracts/LocalCasinoHost.sol.
 *
 * Lifecycle:
 *   1. connectGameToHost({ setState })  -> penpal Connection
 *   2. await connection.promise         -> HostApiV1  (openSession / revealOutcome …)
 *   3. host pushes setState(snapshot) repeatedly; balance + settled sessions
 *      arrive there, never by polling.
 *   4. openSession({ wager, gameData }) -> { sessionKey }
 *   5. watch snapshot.sessions.items for that sessionKey going terminal, read
 *      the VRF word from raw.gameState / raw.randomness, resolve() locally for
 *      the reveal, show the host's reported payout.
 *   6. revealOutcome({ sessionId }) once the animation has shown the result.
 *
 * The contract (contracts/ClawMachineV2.sol) computes the identical payout on
 * chain — resolve() here only needs the word for kind + prize + animation.
 *
 * Types come from the SDK once it is installed/linked; until then
 * src/casino/chain-sdk.d.ts keeps this `any`-typed so the repo still builds.
 */

import { resolve, type Outcome } from "../game/outcome.ts";
import { MODE_ORDER, type ModeId } from "../game/config.ts";
import type { CasinoClient, PlayResult } from "./client.ts";

// SessionPhase enum (solidity/ICasinoGameV2.sol)
const PHASE_SETTLED = 3;
const PHASE_FORFEITED = 4;
const PHASE_CANCELLED = 5;
const isTerminalPhase = (p: number | undefined): boolean =>
  p === PHASE_SETTLED || p === PHASE_FORFEITED || p === PHASE_CANCELLED;

type SessionRow = {
  sessionId: string;
  sessionKey: string;
  phase?: number;
  wager?: string;
  payout?: string;
  isSettled: boolean;
  raw: { gameState?: string; randomness?: string };
};
type Snapshot = {
  token?: { decimals?: number; symbol?: string };
  balances?: { smartVaultBalance?: string };
  casino?: { maxBetAmount?: string };
  sessions?: { items?: SessionRow[] };
} | null;

/** gameData = abi.encode(uint8 mode) — a single 32-byte big-endian word. */
function encodeGameData(modeIndex: number): `0x${string}` {
  return ("0x" + modeIndex.toString(16).padStart(64, "0")) as `0x${string}`;
}

const UI_MAX_BET = 100;

export class ChainSdkClient implements CasinoClient {
  readonly kind = "chain" as const;

  private host: { openSession: Function; revealOutcome: Function } | null = null;
  private destroyConn: (() => void) | null = null;
  private connReady: Promise<void>;

  private snapshot: Snapshot = null;
  private decimals = 18;
  private balance = 0;
  private listeners: Array<(b: number) => void> = [];
  private pending = new Map<string, (row: SessionRow) => void>();
  private lastSessionId: string | null = null;

  constructor() {
    this.connReady = this.connect();
  }

  private async connect(): Promise<void> {
    const sdk: any = await import(/* @vite-ignore */ "@chain/casino-sdk/guest");
    const connection = sdk.connectGameToHost({
      setState: async (snap: Snapshot) => this.onSnapshot(snap),
    });
    this.host = await connection.promise;
    // keep the harness iframe sized to our content
    const sizeObserver = sdk.observeGameContentSize?.(this.host);
    this.destroyConn = () => {
      sizeObserver?.disconnect?.();
      connection.destroy();
    };
  }

  private onSnapshot(snap: Snapshot): void {
    this.snapshot = snap;
    if (!snap) return;

    this.decimals = snap.token?.decimals ?? 18;
    const raw = snap.balances?.smartVaultBalance;
    if (raw !== undefined) {
      const next = Number(BigInt(raw)) / 10 ** this.decimals;
      if (next !== this.balance) {
        this.balance = next;
        for (const cb of this.listeners) cb(next);
      }
    }

    const rows = snap.sessions?.items ?? [];
    for (const [key, doneFn] of [...this.pending]) {
      const row = rows.find((r) => r.sessionKey === key);
      if (row && (row.isSettled || isTerminalPhase(row.phase))) {
        this.pending.delete(key);
        doneFn(row);
      }
    }
  }

  ready(): Promise<void> {
    return this.connReady;
  }

  getBalance(): number {
    return this.balance;
  }

  minBet(): number {
    return 1;
  }

  maxBet(): number {
    const cap = this.snapshot?.casino?.maxBetAmount;
    if (cap && cap !== "0") {
      const asWhole = Number(BigInt(cap)) / 10 ** this.decimals;
      if (asWhole > 0) return Math.min(UI_MAX_BET, Math.floor(asWhole));
    }
    return UI_MAX_BET;
  }

  async play(mode: ModeId, bet: number): Promise<PlayResult> {
    await this.connReady;
    if (!this.host) throw new Error("host bridge not connected");

    const modeIndex = MODE_ORDER.indexOf(mode);
    const wager = (BigInt(Math.round(bet)) * 10n ** BigInt(this.decimals)).toString();

    const { sessionKey } = await this.host.openSession({
      wager,
      gameData: encodeGameData(modeIndex),
    });

    const row = await this.waitForSettle(sessionKey);
    this.lastSessionId = row.sessionId;

    if (isTerminalPhase(row.phase) && row.phase !== PHASE_SETTLED && !row.raw.gameState) {
      throw new Error("round did not settle normally (forfeited / cancelled)");
    }

    const seedHex =
      row.raw.gameState && row.raw.gameState.length === 66
        ? row.raw.gameState
        : row.raw.randomness;
    if (!seedHex) throw new Error("settled session carries no randomness word");

    const local = resolve(seedHex, mode, bet);

    // The contract is authoritative for the number; keep our kind + prize.
    const reported =
      row.payout !== undefined ? Number(BigInt(row.payout)) / 10 ** this.decimals : local.payout;
    if (Math.abs(reported - local.payout) > 1e-6 * Math.max(1, bet)) {
      console.warn(
        `[claw] payout mismatch — contract ${reported}, local ${local.payout}; showing contract value`,
      );
    }
    const outcome: Outcome = { ...local, payout: reported };

    return { outcome, balance: this.balance };
  }

  private waitForSettle(sessionKey: string): Promise<SessionRow> {
    const existing = (this.snapshot?.sessions?.items ?? []).find((r) => r.sessionKey === sessionKey);
    if (existing && (existing.isSettled || isTerminalPhase(existing.phase))) {
      return Promise.resolve(existing);
    }
    return new Promise<SessionRow>((res, rej) => {
      const timer = setTimeout(() => {
        this.pending.delete(sessionKey);
        rej(new Error("timed out waiting for the round to settle"));
      }, 90_000);
      this.pending.set(sessionKey, (r) => {
        clearTimeout(timer);
        res(r);
      });
    });
  }

  commitReveal(): void {
    if (this.host && this.lastSessionId) {
      void Promise.resolve(this.host.revealOutcome({ sessionId: this.lastSessionId })).catch(() => {
        /* reveal is display-only on the host; settlement is already final */
      });
    }
  }

  onBalanceChange(cb: (b: number) => void): void {
    this.listeners.push(cb);
  }

  destroy(): void {
    this.destroyConn?.();
  }
}
