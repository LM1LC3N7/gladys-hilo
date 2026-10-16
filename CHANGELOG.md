# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [0.1.1] - 2026-10-16

### Added

- Sign-in to the Hilo account: "Connect" opens the Hilo sign-in page (OAuth 2
  with PKCE, as python-hilo and Home Assistant), the address of the last page
  is pasted in "Finish the sign-in"; the session is kept in `/data` and
  renewed; "Test the connection" and "Sign out" buttons.
- Live link with Hilo: the DeviceHub and ChallengeHub (SignalR) and the
  GraphQL digital twin stream, reconnected by themselves.
- One Gladys device per Hilo device: thermostats (temperature, setpoint,
  humidity), plugs and load controllers (on/off), water heater controllers
  (on/off, water temperature), switches, dimmers and bulbs (light,
  brightness), the smart meter, the Netatmo weather stations; power and an
  energy index computed from it; unreachable badge.
- Commands: setpoints, on/off and brightness.
- The "Hilo challenges" device: challenge text, announced, pre-heat,
  reduction and recovery flags, reduction start and end, estimated and last
  rewards, rewards of the season, reference and measured consumption.
- Scene triggers "Hilo challenge announced", "Hilo challenge phase started"
  (anticipation, pre-heat, reduction, recovery), "Hilo challenge ended" and
  "Hilo sign-in needed"; an optional anticipation phase hours before the
  pre-heat; an optional lock of the setpoints during a reduction.
- Documentation in French and English, with how it fits with the
  Hydro-Québec integration.

[Unreleased]: https://github.com/LM1LC3N7/gladys-hilo/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/LM1LC3N7/gladys-hilo/releases/tag/v0.1.1
