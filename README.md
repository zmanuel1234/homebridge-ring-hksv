# homebridge-ring-hksv

HomeKit Secure Video recording for a Ring video doorbell, as a Homebridge plugin. It is meant to
run **alongside [homebridge-ring](https://github.com/dgreif/ring)**, which keeps the Ring Alarm,
sensors and modes; this plugin takes over only the doorbell's camera.

> **Status: 0.1 beta, the stream probe.** This version adds nothing to HomeKit. It signs in to
> Ring with its own token, logs the doorbell's motion and doorbell events (with how late each
> arrives), and can measure one live call to tell whether the doorbell's video can be recorded
> as it is or must be re-encoded. Recording comes in later versions.

## How recording will work (and its limits)

Ring cameras have no local video: every picture comes through Ring's cloud as a live call, and
a battery doorbell isn't made to stream all the time. So recordings are triggered by Ring's own
motion and doorbell events: when one arrives, the plugin starts a live call and HomeKit records
it. There is no prebuffer, so **the first seconds of each event are missed** (the time Ring
takes to report the event, plus the call's start). Each recording is a live call, which uses
the battery like Live View in the Ring app and shows in the Ring app's history.

## Setup (0.1)

1. **A token of its own.** On the Pi:

   ```
   npx -p ring-client-api ring-auth-cli
   ```

   Sign in (with the 2FA code) and copy the token. Don't reuse homebridge-ring's: two apps
   sharing one token sign each other out. The plugin saves the newer tokens Ring issues in its
   own folder, so the one you paste is only used once; it shows in the Ring app as
   **homebridge-ring-hksv** under Control Center → Authorized Client Devices.

2. **Install** the beta from the Homebridge UI (search for `homebridge-ring-hksv`, choose the
   beta version), or `npm install homebridge-ring-hksv@beta`.

3. **Settings:** paste the token; set **Camera** if the account has more than one doorbell.
   Put the plugin on its own **child bridge**.

4. **Stream probe** (optional): turn it on and restart the child bridge. 15 s after start, the
   plugin makes one live call (30 s by default) and logs the result, for example:

   ```
   Stream probe: result
     video: 1920x1080, 15.0 fps, 451 frames in 30.0 s
     keyframes: 16, gaps 2.00-2.00 s (average 2.00 s)
     start: first video 1.8 s, first keyframe 1.9 s after the live call was requested
     network: 9123 RTP packets, 0 lost
     H.264: 1920x1080, Main profile, level 4.0
     verdict: the video can likely be recorded as it is (no re-encoding, little CPU)
   ```

   HomeKit Secure Video records in 4 s pieces that must each start with a keyframe, so with
   keyframes at most 4 s apart the video can be passed through; otherwise it must be
   re-encoded. The call is also saved, video untouched, as
   `ring-hksv/probe-<date>-<time>.mp4` in Homebridge's storage folder (the newest three are
   kept). Turn the probe off afterwards: it runs at every start while on.

## Files

Everything the plugin keeps is in `ring-hksv` inside Homebridge's storage folder (usually
`/var/lib/homebridge/ring-hksv`): `state.json` (the current Ring token and the plugin's client
id, readable by the Homebridge user only) and the probe recordings.

## Development

```
npm ci
npm run check
npm run build
npm test
```

Releases are published from GitHub: a version PR, then a GitHub release tagged `v<version>`
(**Set as a pre-release** for a `-beta` version, which goes to npm's `beta` tag).

## License

Apache-2.0. Uses [ring-client-api](https://github.com/dgreif/ring) (MIT).
