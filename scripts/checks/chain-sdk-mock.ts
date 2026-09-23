/** In-memory SDK boundary for the regression runner, never imported by the game. */
import type { GuestApiV1, HostApiV1, HostSnapshotV1 } from "@chain/casino-sdk/guest";

type OpenInput = Parameters<HostApiV1["openSession"]>[0];
type OpenResult = Awaited<ReturnType<HostApiV1["openSession"]>>;

export const bridge = {
  guest: null as GuestApiV1 | null,
  opened: [] as OpenInput[],
  revealed: [] as string[],
  disconnected: 0,
  observerDisconnected: 0,
  async onOpen(_input: OpenInput): Promise<OpenResult> { throw new Error("Configure the mock session first"); },
  async push(snapshot: HostSnapshotV1 | null): Promise<void> {
    if (!this.guest) throw new Error("Mock bridge has not connected");
    await this.guest.setState(snapshot);
  },
};

export function connectGameToHost(guest: GuestApiV1) {
  bridge.guest = guest;
  const host: Pick<HostApiV1, "openSession" | "revealOutcome"> = {
    async openSession(input) { bridge.opened.push(input); return bridge.onOpen(input); },
    async revealOutcome({ sessionId }) { bridge.revealed.push(sessionId); },
  };
  return { promise: Promise.resolve(host), destroy: () => bridge.disconnected++ };
}

export function observeGameContentSize() {
  return { disconnect: () => bridge.observerDisconnected++ };
}
