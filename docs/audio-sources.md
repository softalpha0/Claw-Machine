# Audio sources

The collector redesign uses four existing recordings/effects and the creator's
original arcade background track. No new audio was generated. Audio starts after
a user gesture; movement follows the arm's animation and fades when it stops.
Muting or hiding the tab stops effects and fades out the background track.

## Original background track

`public/audio/arcade-loop.mp3` is the creator-supplied track already present in
commit `3660425`, restored at the user's request. Its duration is 2:16.307.
The repository provides no external source or license attribution for this file;
it is not one of the CC0 effects listed below.

The original gain was 0.32. The restored track uses 0.035 (about 19 dB lower),
with a gentle fade rather than an abrupt start. It streams independently from
the short effects, so loading music never delays a click or claw movement.
Web Audio controls the music level, including on mobile devices. Muting and tab
visibility are shared with the game, and returning resumes the same position
instead of restarting the song. See [`src/game/ambience.ts`](../src/game/ambience.ts).

## Selected effects

| Event | Source | License | Game file |
| --- | --- | --- | --- |
| Button / mode selection | [Select click, Mixkit 1109](https://mixkit.co/free-sound-effects/interface/) | [Mixkit Sound Effects Free License](https://mixkit.co/license/modal/sfxFree/) | `public/audio/collector/select-click.mp3` |
| Arm movement | [Zoom Camera, sheepfilms, Freesound 154795](https://freesound.org/people/sheepfilms/sounds/154795/) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | `public/audio/collector/move-soft-loop.wav` |
| Claw closure | [Small servo (arduino), gpag1, Freesound 520514](https://freesound.org/people/gpag1/sounds/520514/) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | `public/audio/collector/grip-close.wav` |
| Prize / double grab | [Small win, Mixkit 2020](https://mixkit.co/free-sound-effects/win/) | [Mixkit Sound Effects Free License](https://mixkit.co/license/modal/sfxFree/) | `public/audio/collector/small-win.wav` |

Source and license records were checked on 2026-09-23. Creator credit is retained
here even though CC0 does not require attribution. The mechanical effects are
camera and servo recordings adapted to the machine, not recordings of this
particular claw cabinet.

## Source-file handling

The two CC0 derivatives, `move-soft-loop.wav` and `grip-close.wav`, are included in
the repository. They were made from the sources' public high-quality previews:

- [Camera preview](https://cdn.freesound.org/previews/154/154795_1027757-hq.mp3)
- [Servo preview](https://cdn.freesound.org/previews/520/520514_3268195-hq.mp3)

The Mixkit license permits incorporation into video games and prohibits
redistribution as standalone stock or with source files. The downloaded Mixkit
files are therefore ignored by Git and acquired directly from Mixkit for local
development and production builds. They are game assets in the built website,
not a downloadable sound pack.

[`scripts/prepare-audio.mjs`](../scripts/prepare-audio.mjs) is run automatically
by `predev` and `prebuild`. It downloads these sources, verifies their SHA-256
hashes, and reuses a matching local copy:

- [1109 MP3 preview](https://assets.mixkit.co/active_storage/sfx/1109/1109-preview.mp3)
- [2020 original WAV](https://assets.mixkit.co/active_storage/sfx/2020/2020.wav)

On a clean checkout, the first `npm run dev` or `npm run build` needs network
access. No Mixkit account, API key or FFmpeg installation is required. A failed
download or changed checksum stops preparation; review the source before
changing its expected hash. You can also run `node scripts/prepare-audio.mjs`
directly. Do not force-add the ignored source files to Git.

## Editing and playback

- Camera: source 2.12–2.96 seconds, 150 Hz high-pass, 3100 Hz low-pass,
  and Q=3 bell cuts at 2000 Hz (−7 dB) and 4497 Hz (−9 dB). An 80 ms cosine
  wrap crossfade blends the end with the beginning; removing the overlap gives
  a 0.76-second loop. DC is removed and RMS set to −28 dBFS. It is stored as
  mono 48 kHz PCM16 WAV to avoid codec padding at the loop point.
- Servo: a different single source movement at 4.68–4.95 seconds, 180 Hz
  high-pass and 3200 Hz low-pass, 1.2× tempo preserving pitch, +16 dB gain,
  12 ms fade-in and 75 ms fade-out starting at 0.15 seconds. The resulting
  0.238-second cue replaces the previous two-burst 0.53-second excerpt.
- Click: the unchanged Mixkit source is limited to 0.34 seconds at playback,
  with a final 50 ms fade and reduced gain.
- Win: the unchanged Mixkit source is limited to 1.32 seconds at playback,
  with a final 190 ms fade and reduced gain. A double grab uses the same cue
  slightly louder; collection updates do not stack another reward sound.

Timing and gain are defined in [`src/game/audio.ts`](../src/game/audio.ts).
`startMovement(phase)` accepts `aim`, `descend`, `lift`, `carry`, `park` or
`whiff`. Adjacent movement phases reuse one active source instead of restarting
it. Phase changes ramp level and playback rate, then soften towards the next
stop. Returning to park is quieter. `stopMovement()` uses a 100 ms fade; grip
and reward calls also stop any travel voice. Numeric arguments remain supported
for older callers. The click and win recordings are retained. The latest mix
reduces click gain from 0.642 to 0.46, grip from 0.8 to 0.44 and win from 0.365
to 0.28. Motor phase levels are roughly halved. Gentle low-pass filters at
1800 Hz for movement and 2400 Hz for grip soften the mechanical whine further.
The shared effects bus is set to 0.62 instead of 0.78, a further 2 dB reduction
across clicks, movement, grip and prizes. The independent background track stays
at 0.035, including after muting and re-enabling sound.

## Technical validation of the revised mechanical cues

These are measured properties, not a claim that an automated agent listened to
the sounds. Final tone and balance should be judged in the running game.

| Measurement | Earlier movement | Revised movement | Earlier grip | Revised grip |
| --- | --- | --- | --- | --- |
| Duration | 1.13 s | 0.76 s loop | 0.53 s | 0.238 s |
| Sample peak | −7.51 dBFS | −14.40 dBFS | −9.62 dBFS | −14.04 dBFS |
| RMS | −25.34 dBFS | −28.00 dBFS | −27.37 dBFS | −29.36 dBFS |
| Spectral energy above 3 kHz | 51.71% | 20.51% | 72.78% | 58.48% |

The motor's wrap sample discontinuity is reduced from −30.01 dBFS at the old
runtime loop boundaries to −43.00 dBFS. Both revised files fully decode without
errors or clipped samples. Grip starts and ends at zero. Playback tests cover
continuous phase transitions, smooth ramp scheduling, one motor voice after
deferred loading, closure stopping travel, mute, hidden tabs, stale events and
individual file failures.

Current CC0 derivative checksums:

```text
86f93a2dc4c4f2a513b8d924d270cfb2ecbdc38b2a744cd9e218b893590fd748  move-soft-loop.wav
3485cae0503a2db663e9d06754ebb1c2d7bbf139ee079feea5875426ef9820a5  grip-close.wav
```

The Mixkit source checksums are pinned in the preparation script.
