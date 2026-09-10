# CLAW — declared math

One VRF word per play — the `bytes32 randomness` the casino facet hands
`ICasinoGameV2.onRandomness`. It is expanded with SHA-256:

```
word_i       = sha256( randomness[32 bytes] ++ uint32_be(i) )
u_i (float)  = first 8 bytes of word_i, big-endian  /  2^64          -> [0, 1)     (display only)
uniformWad(i)= uint64(first 8 bytes of word_i) * 1e18  >>  64        -> [0, 1e18)  (decisions)
```

Every payout-affecting comparison uses `uniformWad(i)` against a 1e18-scaled
threshold — identical BigInt / uint256 integer math in `contracts/ClawMachineV2.sol`
(`_uniformWad`), `src/game/rng.ts` (`uniformWad`) and the Monte-Carlo, so the
on-chain payout is always exactly the one the guest animates.

Indices used: `0` = held?, `1` = slipped?, `2` = bonus?, `10` = which prize (flavour only).

## Decision tree (mode `m`, bet `B`)

| step | condition | result | payout |
|---|---|---|---|
| 1 | `u0 ≥ grab[m]` | **whiff** | `0` |
| 2 | `u1 < slip[m]` | **slip** (near miss) | `B · consolation` |
| 3 | `u2 < bonusChance[m]` | **double grab** | `B · mult[m] · bonusFactor[m]` |
| 4 | otherwise | **clean grab** | `B · mult[m]` |

`consolation = 0.20` for every mode. chUSD has 6 decimals; each multiplication
truncates to 6 dp (the contract truncates at every WAD division, the TS mirrors it).

## Mode parameters

| mode | `grab` | `slip` | `bonusChance` | `mult` | `bonusFactor` | max win | theoretical RTP |
|---|---|---|---|---|---|---|---|
| PLUSH PIT | 0.72 | 0.12 | 0.05 | 1.410 | 2.0 | 2.82× | **95.53 %** |
| GADGET GRAB | 0.48 | 0.15 | 0.06 | 2.175 | 2.0 | 4.35× | **95.50 %** |
| JACKPOT VAULT | 0.22 | 0.18 | 0.08 | 4.526 | 3.0 | 13.58× | **95.50 %** |

Declared house RTP: **95.5 %** (house edge 4.5 %). Every mode sits inside the
jam's 93–98 % band on its own.

## Closed form

```
RTP(m) = grab·(1−slip)·mult·(1 + bonusChance·(bonusFactor−1))   [clean + bonus]
       + grab·slip·consolation                                   [slip]
```

Outcome frequencies:

```
P(whiff) = 1 − grab
P(slip)  = grab · slip
P(grab)  = grab · (1 − slip) · (1 − bonusChance)
P(bonus) = grab · (1 − slip) · bonusChance
```

## Proof

`npm run montecarlo` runs millions of real seeds through the exact `resolve()`
the game and the contract use, and checks empirical return against the closed
form (must be within 3σ, and the theoretical value must be in 93–98 %).

Representative run (1.5M plays/mode):

```
PLUSH PIT      theoretical 95.5325 %   empirical 95.5395 % ± 0.0600   PASS
GADGET GRAB    theoretical 95.5044 %   empirical 95.6251 % ± 0.0956   PASS
JACKPOT VAULT  theoretical 95.5049 %   empirical 95.2462 % ± 0.1850   PASS
```

## If you change a number

1. edit `src/game/config.ts` (the only source of truth)
2. `npm run tune` to re-solve `mult` for the target RTP
3. `npm run montecarlo` to re-prove
4. update the constants in `contracts/ClawMachineV2.sol` and this file
