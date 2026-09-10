// Ambient shims so `tsc --noEmit` passes before @chain/casino-sdk is installed.
// After you `npm link @chain/casino-sdk` (or add it to package.json pointing at
// the unzipped SDK), delete this file and use the SDK's published types
// (`HostApiV1`, `HostSnapshotV1`, `GuestApiV1` from "@chain/casino-sdk/guest").
declare module "@chain/casino-sdk";
declare module "@chain/casino-sdk/guest";
declare module "@chain/casino-sdk/host";
