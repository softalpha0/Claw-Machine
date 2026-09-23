# Audio sources

The collector redesign uses four existing recordings/effects. No new audio was
generated. The earlier arcade-room candidates and background track are not played
by the new runtime. Audio starts after a user gesture; movement follows the arm's
animation and fades when it stops. Muting or hiding the tab stops active voices.

## Selected effects

| Event | Source | License | Game file |
| --- | --- | --- | --- |
| Button / mode selection | [Select click, Mixkit 1109](https://mixkit.co/free-sound-effects/interface/) | [Mixkit Sound Effects Free License](https://mixkit.co/license/modal/sfxFree/) | `public/audio/collector/select-click.mp3` |
| Arm movement | [Zoom Camera, sheepfilms, Freesound 154795](https://freesound.org/people/sheepfilms/sounds/154795/) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | `public/audio/collector/move-camera.mp3` |
| Claw closure | [Small servo (arduino), gpag1, Freesound 520514](https://freesound.org/people/gpag1/sounds/520514/) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | `public/audio/collector/grip-servo.mp3` |
| Prize / double grab | [Small win, Mixkit 2020](https://mixkit.co/free-sound-effects/win/) | [Mixkit Sound Effects Free License](https://mixkit.co/license/modal/sfxFree/) | `public/audio/collector/small-win.wav` |

Source and license records were checked on 2026-09-23. Creator credit is retained
here even though CC0 does not require attribution. The mechanical effects are
camera and servo recordings adapted to the machine, not recordings of this
particular claw cabinet.

## Source-file handling

The two CC0 derivatives, `move-camera.mp3` and `grip-servo.mp3`, are included in
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

- Camera: source 2.035–3.165 seconds, 100 Hz high-pass and 5200 Hz low-pass,
  +4.2 dB gain, 65 ms fade-in and 135 ms fade-out. The 1.13-second derivative
  loops only while the arm travels; the runtime fades the voice on stop.
- Servo: source 3.79–4.32 seconds, 160 Hz high-pass and 4200 Hz low-pass,
  +12 dB gain, 25 ms fade-in and 100 ms fade-out. One 0.53-second closure cue.
- Click: the unchanged Mixkit source is limited to 0.34 seconds at playback,
  with a final 50 ms fade and reduced gain.
- Win: the unchanged Mixkit source is limited to 1.32 seconds at playback,
  with a final 190 ms fade and reduced gain. A double grab uses the same cue
  slightly louder; collection updates do not stack another reward sound.

Timing and gain are defined in [`src/game/audio.ts`](../src/game/audio.ts).
CC0 derivative checksums:

```text
b0836927b736a35ee56ab0aea4f27f2a04b8c2d4ca4561237c84af81e32fb7bc  move-camera.mp3
cf27cc91334e6ffe6b29e521a61bf68f210688ab42584431f38ca8ab3f9381e9  grip-servo.mp3
```

The Mixkit source checksums are pinned in the preparation script.
