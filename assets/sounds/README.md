# assets/sounds

This folder is intentionally empty: **RIDGE RUSH ships no audio files.**

Every sound in the game is synthesized at runtime with the Web Audio API by `js/core/audio.js`
(`RR.Audio`). So there is nothing to download, nothing is licensed, and the game works from `file://`.

## What is generated

| Part | How it's made |
|------|---------------|
| **Sound effects** (`RR.Audio.play(name, {pitch, volume})`) | Each of the 27 names (`click coin coinBig fuel powerup crash jump land landHard flip perfect combo upgrade unlock mission record levelup warning whoosh boost shield error tick thruster explosion lava wind`) is a small recipe of oscillators, envelopes and filtered noise. Noise comes from white/pink/brown buffers that are generated once and cached. Coins climb in pitch during rapid pickup streaks. At most 24 voices play at once (the oldest is stolen), and each name has its own rate limit. |
| **Engine** (`engineStart/engineUpdate/engineStop`) | One continuous synth voice: 2 detuned oscillators + a sub + band-passed noise rasp → waveshaper → lowpass. The filter cutoff follows throttle and load, pitch follows rpm, and an LFO adds idle lope. Six timbres match the vehicle `style`: `buggy dirt truck rally crawler storm`. Rally adds a turbo whine and a blow-off "pssh" when you lift off the throttle; storm is a clean electric turbine. |
| **Music** (`RR.Audio.music(style)`) | Original generative music from a lookahead step sequencer (25 ms timer, 0.12 s scheduled ahead on the audio clock). Ten styles (`menu valley highland desert ice volcanic space synthwave storm boss`) each set their own tempo, mode, chord progressions, instrument patches, drum grooves and bass patterns. A seeded RNG builds a new phrase every 4–8 bars: a new progression, motif, arp shape, groove and layer mix. Melodies develop a one-bar motif through variation, sequencing and cadences. Switching styles crossfades over 1.2 s. One shared tempo-synced feedback delay gives the space/ice echoes. |

Signal chain: `SFX bus (+ engine sub-bus) + music bus → DynamicsCompressor → master gain → speakers`.
`setSound` / `setMusic` ramp the bus gains smoothly. `duck(true)` drops the music to about 35 % (pause menu).
`suspend()` / `resume()` pause the whole context. It also suspends automatically while the tab is hidden.

## Adding or tweaking a sound

- **SFX:** add a recipe to the `SFX` table in `js/core/audio.js`, plus its level (`LEVEL`) and rate limit (`RATE`).
- **Music:** styles are pure data in the `MUSIC` table (patterns are 16-step strings). Instruments are in `PATCHES`.
- **Check your change:** `NODE_PATH=/opt/node22/lib/node_modules node tests/audio.test.js`. This renders every
  sound through an `OfflineAudioContext` in Chromium and checks that each one is audible and never clips.
  `RR.Audio.renderOffline({...})` is also available from the browser console for quick loudness checks.
