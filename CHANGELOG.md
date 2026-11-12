# Changelog

## 0.1.0-beta.1 (2026-11-12)

First pre-release: the stream probe. Adds nothing to HomeKit.

### Added

- Signs in to Ring with its own refresh token and its own client id, so it doesn't sign
  homebridge-ring out; the newer tokens Ring issues are saved in `ring-hksv/state.json`
  (readable by the Homebridge user only). A new token pasted into the settings takes over.
- Finds the doorbell (setting **Camera**, or the account's only doorbell) and lists the
  account's cameras with their ids at start.
- Logs the doorbell's motion and doorbell events, with how long after the camera saw them they
  reached the plugin (the part a recording will miss at its start).
- **Stream probe** (setting, off by default): one live call, measured as it arrives (picture
  size, profile, frame rate, keyframe gaps, how long the start takes, lost packets), with a
  verdict on whether HomeKit Secure Video can record the video as it is or must re-encode it.
  The call is saved as an MP4 (video untouched) in `ring-hksv`; the newest three are kept.
