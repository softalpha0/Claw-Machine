# `@chain/casino-sdk`

Bridge SDK + on-chain interface for building **casino games** (single player vs. the house
liquidity pool) that embed inside the Chain.wtf host application as sandboxed iframes.

This package is the monorepo home of what was previously vendored as `@chain-protocol/games-sdk`.

## Usage

- **Guest (iframe)**: import from `@chain/casino-sdk/guest` — `connectGameToHost`, types.
- **Host (parent app)**: import from `@chain/casino-sdk/host` — `connectHostToGame`.
- **Types + manifest**: import from `@chain/casino-sdk` — `validateCasinoGameManifest`,
  `canonicalCasinoGameId`, `resolveManifestMetadata`, and all shared types.

## Layout

| Path                                          | What it is                                                                                                                                                                                                                                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/types.ts`                                | `HostSnapshotV1`, `HostApiV1`, `GuestApiV1`, manifest types.                                                                                                                                                                                                                         |
| `src/manifest.ts`                             | Manifest validation + `gameId` canonicalization.                                                                                                                                                                                                                                     |
| `src/host.ts` / `src/guest.ts`                | Penpal `postMessage` connectors.                                                                                                                                                                                                                                                     |
| `simulator/contracts/ICasinoGameV2.sol`       | Canonical on-chain game interface.                                                                                                                                                                                                                                                   |
| `examples/coinflip-public/game.manifest.json` | Example `game.manifest.json` the host validates.                                                                                                                                                                                                                                     |
| `docs/`                                       | Full integration guide, contract constraints, slots risk/reserves, visual/UX notes.                                                                                                                                                                                                  |
| `docs/CHANGELOG.md`                           | Date-versioned SDK release notes.                                                                                                                                                                                                                                                    |
| `docs/RANDOMNESS_DICE.md`                     | **Agents:** unbiased d6 from `bytes32` RNG (rejection sampling; never raw `byte % 6`).                                                                                                                                                                                               |
| `local-verify-network/`                       | Local Verify Network VRF simulator (real router + fulfilling node) for testing games against a local chain. In-repo it is a gitignored mirror of `tools/local-verify-network` — edit the tool, not the copy.                                                                         |
| `simulator/`                                  | Standalone local test setup: a Vite harness replicating the Chain.wtf host frame (optimistic sessions, flashblock push + lagged indexed feed, balance ledger) plus a one-command local backend (in-memory Hardhat node + minimal casino host + VRF node). See `simulator/README.md`. |

## Local testing

This package is an npm workspace. One install covers the simulator, the local VRF node and the
example game; one command runs the whole local stack (chain + VRF node + casino deployment +
simulator harness + example game):

```sh
npm install
npm start
```

See [`simulator/README.md`](./simulator/README.md).

Start with [`docs/CHAIN_WTF_CASINO_GAMES.md`](./docs/CHAIN_WTF_CASINO_GAMES.md).
See [`docs/CHANGELOG.md`](./docs/CHANGELOG.md) for date-versioned SDK changes.

## Dependency

- **`penpal`** `^7.0.4` — promise-based `postMessage` RPC.

## Distribution

The TypeScript sources are also published through the `@chain/ui` shadcn registry, so external game
developers can install them with `shadcn add @chain/casino-sdk` (see `packages/ui`).
