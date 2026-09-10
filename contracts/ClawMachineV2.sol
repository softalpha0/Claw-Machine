// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {
  ICasinoGameV2,
  SessionContext,
  StepResult,
  SessionPhase
} from "../../solidity/ICasinoGameV2.sol";

/**
 * CLAW — Chain Jam Vol. 1 entry. A provably-fair claw machine.
 *
 * One VRF word per play. Three risk modes chosen before the drop, carried in
 * `gameData` as `abi.encode(uint8 mode)` (0 = PLUSH PIT, 1 = GADGET GRAB,
 * 2 = JACKPOT VAULT).
 *
 * Decision tree (mode m, wager w), evaluated from the single `randomness` word:
 *
 *     u_i = uniformWad(randomness, i)          // [0, 1e18)
 *     u0 >= grab[m]                -> payout 0                    (whiff)
 *     u1 <  slip[m]               -> payout w * 0.2              (slip / near-miss)
 *     u2 <  bonusChance[m]        -> payout w * mult[m] * bonusFactor[m]  (double grab)
 *     else                       -> payout w * mult[m]           (clean grab)
 *
 * This is byte-identical to src/game/outcome.ts (guest preview) and
 * scripts/montecarlo.ts (RTP proof). Theoretical RTP ~95.5% per mode, house
 * edge ~4.5%, every mode inside the jam's 93–98% band. See MATH.md.
 *
 * Drop this file into the SDK's `simulator/contracts/` — it compiles, deploys
 * and registers automatically (it needs no constructor args and exposes
 * `quoteCaps` + `onPlayerAction`, the harness's game-detection markers).
 */
contract ClawMachineV2 is ICasinoGameV2 {
  uint256 internal constant WAD = 1e18;

  uint8 internal constant MODE_PLUSH = 0;
  uint8 internal constant MODE_GADGET = 1;
  uint8 internal constant MODE_VAULT = 2;

  uint256 internal constant CONSOLATION_WAD = 0.2e18;

  // ----------------------------------------------------- per-mode params (WAD)
  function _grab(uint8 m) internal pure returns (uint256) {
    if (m == MODE_PLUSH) return 0.72e18;
    if (m == MODE_GADGET) return 0.48e18;
    return 0.22e18; // VAULT
  }

  function _slip(uint8 m) internal pure returns (uint256) {
    if (m == MODE_PLUSH) return 0.12e18;
    if (m == MODE_GADGET) return 0.15e18;
    return 0.18e18;
  }

  function _bonusChance(uint8 m) internal pure returns (uint256) {
    if (m == MODE_PLUSH) return 0.05e18;
    if (m == MODE_GADGET) return 0.06e18;
    return 0.08e18;
  }

  function _mult(uint8 m) internal pure returns (uint256) {
    if (m == MODE_PLUSH) return 1.41e18;
    if (m == MODE_GADGET) return 2.175e18;
    return 4.526e18;
  }

  function _bonusFactor(uint8 m) internal pure returns (uint256) {
    if (m == MODE_VAULT) return 3e18;
    return 2e18; // PLUSH + GADGET
  }

  /// @dev Expected return per unit wager (WAD), closed form from MATH.md. Feeds
  ///      the risk model's `expectedPayout`; not on the payout path.
  function _rtpWad(uint8 m) internal pure returns (uint256) {
    if (m == MODE_PLUSH) return 955_325_000_000_000_000;
    if (m == MODE_GADGET) return 955_044_000_000_000_000;
    return 955_049_000_000_000_000;
  }

  /// @dev Largest multiple of the wager a mode can return (mult * bonusFactor).
  function _maxMultWad(uint8 m) internal pure returns (uint256) {
    return (_mult(m) * _bonusFactor(m)) / WAD;
  }

  // ----------------------------------------- randomness (mirror of src/game/rng.ts)
  /// @dev uniformWad(r, i) = uint64(first 8 bytes of sha256(r ++ uint32be(i))) * 1e18 / 2^64
  function _uniformWad(bytes32 r, uint32 i) internal pure returns (uint256) {
    uint64 top = uint64(bytes8(sha256(abi.encodePacked(r, i))));
    return (uint256(top) * WAD) >> 64;
  }

  // ------------------------------------- paytable (mirror of outcome.ts resolve())
  /// @return payout  absolute payout in wager base units
  /// @return kind    0 whiff, 1 slip, 2 grab, 3 bonus
  function _play(bytes32 r, uint8 mode, uint256 wager)
    internal
    pure
    returns (uint256 payout, uint8 kind)
  {
    if (_uniformWad(r, 0) >= _grab(mode)) return (0, 0); // whiff

    if (_uniformWad(r, 1) < _slip(mode)) {
      return ((wager * CONSOLATION_WAD) / WAD, 1); // slip / consolation
    }

    uint256 clean = (wager * _mult(mode)) / WAD;
    if (_uniformWad(r, 2) < _bonusChance(mode)) {
      return ((clean * _bonusFactor(mode)) / WAD, 3); // double grab
    }
    return (clean, 2); // clean grab
  }

  function _mode(bytes calldata gameData) internal pure returns (uint8 m) {
    m = abi.decode(gameData, (uint8));
    require(m <= MODE_VAULT, "claw: bad mode");
  }

  // ================================================================ ICasinoGameV2

  function quoteCaps(uint256 wager, bytes calldata gameData)
    external
    pure
    returns (uint256 maxEscrowStake, uint256 maxReservedProfit)
  {
    uint8 m = _mode(gameData);
    maxEscrowStake = wager; // escrow never grows mid-round
    uint256 maxPayout = (wager * _maxMultWad(m)) / WAD;
    maxReservedProfit = maxPayout > wager ? maxPayout - wager : 0;
  }

  function quoteRiskParams(uint256 wager, bytes calldata gameData)
    external
    pure
    returns (
      uint256 maxPayout,
      uint256 probabilityWad,
      uint256 expectedPayout,
      uint256 subJackpotVarianceScaled
    )
  {
    uint8 m = _mode(gameData);
    maxPayout = (wager * _maxMultWad(m)) / WAD;
    // Probability of a real win (clean grab or better) = grab * (1 - slip).
    // A conservative binary-VaR input; not heavy-tail (max mult 13.578x < 100x).
    probabilityWad = (_grab(m) * (WAD - _slip(m))) / WAD;
    expectedPayout = (wager * _rtpWad(m)) / WAD;
    subJackpotVarianceScaled = 0;
  }

  function onSessionStart(SessionContext calldata ctx)
    external
    pure
    returns (StepResult memory)
  {
    uint8 m = _mode(ctx.gameData);
    uint256 maxPayout = (ctx.wagerBase * _maxMultWad(m)) / WAD;
    return
      StepResult({
        newGameState: bytes(""),
        escrowDelta: int256(0), // the host already escrowed the wager
        reservedProfitDelta: int256(maxPayout > ctx.wagerBase ? maxPayout - ctx.wagerBase : 0),
        nextPhase: SessionPhase.WAITING_RANDOMNESS,
        requestRandomnessNow: true,
        payout: 0
      });
  }

  function onRandomness(SessionContext calldata ctx, bytes32 randomness)
    external
    pure
    returns (StepResult memory)
  {
    uint8 m = _mode(ctx.gameData);
    (uint256 payout, ) = _play(randomness, m, ctx.wagerBase);
    return
      StepResult({
        newGameState: abi.encode(randomness), // guest reads the word back from gameState
        escrowDelta: int256(0),
        reservedProfitDelta: int256(0), // reserve is released when the session finalizes
        nextPhase: SessionPhase.SETTLED,
        requestRandomnessNow: false,
        payout: payout
      });
  }

  function onPlayerAction(SessionContext calldata, bytes calldata)
    external
    pure
    returns (StepResult memory)
  {
    revert("claw: no player actions");
  }

  function quoteForfeitPayout(SessionContext calldata)
    external
    pure
    returns (uint256)
  {
    return 0; // one randomness step, nothing cashable mid-round
  }

  /// @notice View helper for tooling / tests — verify any outcome off the money path.
  function previewPayout(bytes32 randomness, uint8 mode, uint256 wager)
    external
    pure
    returns (uint256 payout, uint8 kind)
  {
    require(mode <= MODE_VAULT, "claw: bad mode");
    return _play(randomness, mode, wager);
  }
}
