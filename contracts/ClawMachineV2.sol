// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/*
 * CLAW — Chain Jam Vol. 1 entry.
 *
 * ┌─ RECONCILE WITH THE SDK ───────────────────────────────────────────────────┐
 * │ This implements the DOCUMENTED shape of ICasinoGameV2 (quoteCaps,          │
 * │ quoteRiskParams, onSessionStart, onRandomness, onPlayerAction). Once you   │
 * │ `npm install` the SDK from your forked coinflip example, copy the real     │
 * │ `ICasinoGameV2.sol` into ./contracts, make this `is ICasinoGameV2`, and    │
 * │ line up the exact struct/param names + phase/timeout rules. The MATH in    │
 * │ `_payoutWad` below is the part that must never drift — it is byte-for-byte  │
 * │ the same model as src/game/outcome.ts and scripts/montecarlo.ts.           │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * One VRF seed per play. Randomness derivation (identical to the TS):
 *     word_i  = sha256(abi.encodePacked(seed, uint32(i)))
 *     u_i     = (uint64(bytes8(word_i)) * WAD) >> 64        // [0, WAD)
 *
 * Decision tree (mode m, wager w):
 *     if u0 >= grab[m]                 -> payout 0                       (whiff)
 *     if u1 <  slip[m]                 -> payout w * CONSOLATION / WAD   (slip)
 *     if u2 <  bonusChance[m]          -> payout w * mult[m] * bonusFactor[m] / WAD^2   (bonus)
 *     else                            -> payout w * mult[m] / WAD       (clean grab)
 *
 * Theoretical RTP per mode ~95.5% (see MATH.md, proven by `npm run montecarlo`).
 */

contract ClawMachineV2 {
    // ------------------------------------------------------------------ constants
    uint256 internal constant WAD = 1e18;

    uint8 internal constant MODE_PLUSH  = 0;
    uint8 internal constant MODE_GADGET = 1;
    uint8 internal constant MODE_VAULT  = 2;

    uint256 internal constant MIN_WAGER = 1e6;    // 1 chUSD (6dp)
    uint256 internal constant MAX_WAGER = 100e6;  // 100 chUSD

    // per-mode params, indexed by mode id. WAD-scaled probabilities/multipliers.
    // plush, gadget, vault
    function _grab(uint8 m) internal pure returns (uint256) {
        if (m == MODE_PLUSH)  return 0.72e18;
        if (m == MODE_GADGET) return 0.48e18;
        return 0.22e18; // vault
    }
    function _slip(uint8 m) internal pure returns (uint256) {
        if (m == MODE_PLUSH)  return 0.12e18;
        if (m == MODE_GADGET) return 0.15e18;
        return 0.18e18;
    }
    function _bonusChance(uint8 m) internal pure returns (uint256) {
        if (m == MODE_PLUSH)  return 0.05e18;
        if (m == MODE_GADGET) return 0.06e18;
        return 0.08e18;
    }
    function _mult(uint8 m) internal pure returns (uint256) {
        if (m == MODE_PLUSH)  return 1.41e18;
        if (m == MODE_GADGET) return 2.175e18;
        return 4.526e18;
    }
    function _bonusFactor(uint8 m) internal pure returns (uint256) {
        if (m == MODE_VAULT) return 3e18;
        return 2e18; // plush + gadget
    }
    uint256 internal constant CONSOLATION = 0.2e18;

    // ------------------------------------------------------------------ randomness
    /// @dev u_i in [0, WAD). Mirrors src/game/rng.ts `uniform`.
    function _uniformWad(bytes32 seed, uint32 i) internal pure returns (uint256) {
        bytes32 h = sha256(abi.encodePacked(seed, i));
        uint64 top = uint64(bytes8(h)); // first 8 bytes, big-endian
        return (uint256(top) * WAD) >> 64;
    }

    // ------------------------------------------------------------------ the math
    /// @notice Payout for one play, WAD-relative to the wager unit.
    /// @return payout absolute payout in wager units (same decimals as `wager`).
    /// @return kind 0 whiff, 1 slip, 2 grab, 3 bonus
    function _resolve(bytes32 seed, uint8 mode, uint256 wager)
        internal
        pure
        returns (uint256 payout, uint8 kind)
    {
        require(mode <= MODE_VAULT, "bad mode");

        uint256 u0 = _uniformWad(seed, 0);
        if (u0 >= _grab(mode)) {
            return (0, 0); // whiff
        }

        uint256 u1 = _uniformWad(seed, 1);
        if (u1 < _slip(mode)) {
            return (wager * CONSOLATION / WAD, 1); // slip / consolation
        }

        uint256 u2 = _uniformWad(seed, 2);
        if (u2 < _bonusChance(mode)) {
            // wager * mult * bonusFactor  (two WAD divisions)
            uint256 p = wager * _mult(mode) / WAD;
            p = p * _bonusFactor(mode) / WAD;
            return (p, 3); // bonus
        }

        return (wager * _mult(mode) / WAD, 2); // clean grab
    }

    /// @notice Public, view-only helper so tooling / the harness can cross-check
    ///         a payout without opening a session. Not part of the money path.
    function previewPayout(bytes32 seed, uint8 mode, uint256 wager)
        external
        pure
        returns (uint256 payout, uint8 kind)
    {
        return _resolve(seed, mode, wager);
    }

    // =================================================================
    //  ICasinoGameV2 surface  (names per sdk.chain.wtf docs — verify shapes)
    // =================================================================

    struct Caps { uint256 minWager; uint256 maxWager; }

    /// @dev Betting limits the host enforces before opening a session.
    function quoteCaps() external pure returns (Caps memory) {
        return Caps({ minWager: MIN_WAGER, maxWager: MAX_WAGER });
    }

    /// @dev Max exposure the game can create for a given wager = the largest
    ///      multiple any mode can pay (VAULT: 4.526 * 3 = 13.578x).
    function quoteRiskParams(uint256 wager) external pure returns (uint256 maxPayout) {
        uint256 p = wager * _mult(MODE_VAULT) / WAD;
        p = p * _bonusFactor(MODE_VAULT) / WAD;
        return p;
    }

    /// @dev Decode + validate the player's pre-draw choice. `action` is the
    ///      payload the frontend sends via hostApi.openSession({ action }).
    ///      Layout here: abi.encode(uint8 mode). One-shot game: no further moves.
    function onSessionStart(uint256 wager, bytes calldata action)
        external
        pure
        returns (bool needsRandomness, bool needsPlayerAction)
    {
        require(wager >= MIN_WAGER && wager <= MAX_WAGER, "wager out of caps");
        uint8 mode = abi.decode(action, (uint8));
        require(mode <= MODE_VAULT, "bad mode");
        return (true, false); // needs one VRF draw, no multi-step actions
    }

    /// @dev No mid-round moves in CLAW. Present to satisfy the interface.
    function onPlayerAction(bytes calldata) external pure returns (bool stillNeedsRandomness) {
        revert("claw: no player actions");
    }

    /// @dev The VRF callback. `seed` is the verifiable randomness for this play,
    ///      `wager` the locked stake, `context` carries the chosen mode
    ///      (abi.encode(uint8)). Returns the amount to pay the player.
    function onRandomness(bytes32 seed, uint256 wager, bytes calldata context)
        external
        pure
        returns (uint256 payout)
    {
        uint8 mode = abi.decode(context, (uint8));
        (payout, ) = _resolve(seed, mode, wager);
        return payout;
    }
}
