# [0.21.0](https://github.com/B1anker/harness-switch/compare/v0.20.1...v0.21.0) (2026-08-27)


### Bug Fixes

* **log:** keep an error and its errno on one line ([12bcba7](https://github.com/B1anker/harness-switch/commit/12bcba72077ec4cbc0fe19c6a0a5a4d05f488172))
* **users:** check the manager data dir before the selected user's home ([9c5fd24](https://github.com/B1anker/harness-switch/commit/9c5fd24a9bb31e984338810fda55285f4d51e9e8))
* **users:** test CAP_CHOWN and group membership instead of assuming root ([9d41b49](https://github.com/B1anker/harness-switch/commit/9d41b49c908166fa433f376df767f17e8c50b9c2))


### Features

* **users:** probe permissions and refuse unmanageable user switches ([3e088ce](https://github.com/B1anker/harness-switch/commit/3e088ce7185fa223cd10754cb3d6df42645c005a))

## [0.20.1](https://github.com/B1anker/harness-switch/compare/v0.20.0...v0.20.1) (2026-08-24)


### Bug Fixes

* **web:** improve transfer dialog Codex cache UX ([53663e9](https://github.com/B1anker/harness-switch/commit/53663e9ee6103ee762b41517aaf1cdc5eee6dfd3))

# [0.20.0](https://github.com/B1anker/harness-switch/compare/v0.19.0...v0.20.0) (2026-08-24)


### Features

* add provider connectivity test and model catalog ([c3163cb](https://github.com/B1anker/harness-switch/commit/c3163cb1c966f84c8235c7ed619fa72ac174451c))

# [0.19.0](https://github.com/B1anker/harness-switch/compare/v0.18.0...v0.19.0) (2026-08-24)


### Bug Fixes

* **doctor:** report unreadable configs instead of failing the whole run ([30307f2](https://github.com/B1anker/harness-switch/commit/30307f283a2cf5d2d87bea58baf8d8efa1464d3f))


### Features

* **runtime:** support Node.js and Bun ([f1f8d8f](https://github.com/B1anker/harness-switch/commit/f1f8d8fcf6fed88516b2eb41681e3ff062b0fb05))
* **transfer:** migrate provider vault entries ([3387796](https://github.com/B1anker/harness-switch/commit/33877968276469f75b92a58ed0c2d3a7ce97a693))
* **web:** group user switching into account menu ([819ecbc](https://github.com/B1anker/harness-switch/commit/819ecbc2ac15247f6a5ba9a6fd500720bf8405f5))

# [0.18.0](https://github.com/B1anker/harness-switch/compare/v0.17.0...v0.18.0) (2026-08-23)


### Features

* **cli:** expand commands and harden daemon lifecycle ([0fb63f1](https://github.com/B1anker/harness-switch/commit/0fb63f1362f6daf0eb0972a9864ac4ea2703d6a8))

# [0.17.0](https://github.com/B1anker/harness-switch/compare/v0.16.1...v0.17.0) (2026-08-22)


### Features

* harden backup restore, add schema validation, operation journal, scan import, and i18n ([659fe90](https://github.com/B1anker/harness-switch/commit/659fe9051dcac2493469d0b0634e95b06e799228))

## [0.16.1](https://github.com/B1anker/harness-switch/compare/v0.16.0...v0.16.1) (2026-08-21)


### Bug Fixes

* prompt only for changed Codex auth cache ([1d2bad1](https://github.com/B1anker/harness-switch/commit/1d2bad18f6c06080000f11cb0c14b6091e26319b))

# [0.16.0](https://github.com/B1anker/harness-switch/compare/v0.15.0...v0.16.0) (2026-08-21)


### Features

* add English web interface ([81aef0f](https://github.com/B1anker/harness-switch/commit/81aef0f60eacc3a9dd0640d5a1ec217a15cc19aa))

# [0.15.0](https://github.com/B1anker/harness-switch/compare/v0.14.0...v0.15.0) (2026-08-20)


### Features

* migrate Codex login cache safely ([e4bcb41](https://github.com/B1anker/harness-switch/commit/e4bcb415bac6c15d15e74b260e1957fba010f184))
* refine user config sync and align form controls ([df79afd](https://github.com/B1anker/harness-switch/commit/df79afd8f9ca72d3ec4915ba2af53db789777849))

# [0.14.0](https://github.com/B1anker/harness-switch/compare/v0.13.0...v0.14.0) (2026-08-20)


### Features

* refine harness configuration workflow ([84bbe43](https://github.com/B1anker/harness-switch/commit/84bbe43fd904f3772336045e9e33ad3d60e6aa15))

# [0.13.0](https://github.com/B1anker/harness-switch/compare/v0.12.0...v0.13.0) (2026-08-20)


### Features

* support local user switching and config sync ([6e4d17d](https://github.com/B1anker/harness-switch/commit/6e4d17d54a846b99a0e2925b8e29552eba82e51c))

# [0.12.0](https://github.com/B1anker/harness-switch/compare/v0.11.1...v0.12.0) (2026-08-20)


### Bug Fixes

* **server:** cache failed update checks for the TTL ([c5e6494](https://github.com/B1anker/harness-switch/commit/c5e6494a7fd57f8ac5ae15e26706c5fe713a2a37))


### Features

* **cli:** add automation commands with --json output ([7dd571f](https://github.com/B1anker/harness-switch/commit/7dd571f7ff629e91c4c79692fc9a2eb995ac7e14))
* **server:** add configuration drift detection and repair ([299b704](https://github.com/B1anker/harness-switch/commit/299b704824595aa56a37064880ce178c8bcd5904))
* **server:** add doctor diagnostics ([f5cff93](https://github.com/B1anker/harness-switch/commit/f5cff93dba1fbca4d7fbec778d6d72294abb180d))
* **server:** add Provider Vault with profile references ([5e0ae29](https://github.com/B1anker/harness-switch/commit/5e0ae29299851c0ff5680decfc3672ad2f8eec55))
* **shared:** add Provider Vault, drift and doctor types ([a077a85](https://github.com/B1anker/harness-switch/commit/a077a851e04ea1ad90ec91647de36cd59ffa3a14))
* **web:** add Provider Vault, Doctor and drift UI ([150a34a](https://github.com/B1anker/harness-switch/commit/150a34ab49eb9730716e66d0ca9c231d76a703ee))

## [0.11.1](https://github.com/B1anker/harness-switch/compare/v0.11.0...v0.11.1) (2026-08-19)


### Bug Fixes

* keep the dashboard header tidy on small screens ([38e1540](https://github.com/B1anker/harness-switch/commit/38e1540876c2b282207efeabdaa03c6a6ad82051))

# [0.11.0](https://github.com/B1anker/harness-switch/compare/v0.10.0...v0.11.0) (2026-08-19)


### Features

* confirm profile activation with a diff against live files ([a7cfaa8](https://github.com/B1anker/harness-switch/commit/a7cfaa84903d5834ff8674ef94dc16e6be49cb11))

# [0.10.0](https://github.com/B1anker/harness-switch/compare/v0.9.0...v0.10.0) (2026-08-19)


### Features

* one-click update from the dashboard when a new version is out ([febaedf](https://github.com/B1anker/harness-switch/commit/febaedf824ce57620182ce58c5342941d5853987))

# [0.9.0](https://github.com/B1anker/harness-switch/compare/v0.8.0...v0.9.0) (2026-08-19)


### Features

* add a favicon matching the app brand ([71ade9a](https://github.com/B1anker/harness-switch/commit/71ade9a318022a0929e8359a1e922a9cff569f79))

# [0.8.0](https://github.com/B1anker/harness-switch/compare/v0.7.0...v0.8.0) (2026-08-19)


### Features

* show the server version in the dashboard header ([0075386](https://github.com/B1anker/harness-switch/commit/0075386800c980bb628e27560269cc9843062b27))

# [0.7.0](https://github.com/B1anker/harness-switch/compare/v0.6.1...v0.7.0) (2026-08-19)


### Features

* run the CLI as a background daemon via bunx/npx ([923cb28](https://github.com/B1anker/harness-switch/commit/923cb28b4ef250927a240cc1f2b4b98056bb73fb))

## [0.6.1](https://github.com/B1anker/harness-switch/compare/v0.6.0...v0.6.1) (2026-08-19)


### Bug Fixes

* harden config stores and make active-profile edits transactional ([d4071cf](https://github.com/B1anker/harness-switch/commit/d4071cf22827600040d52869c457576b4b89496d))

# [0.6.0](https://github.com/B1anker/harness-switch/compare/v0.5.0...v0.6.0) (2026-08-19)


### Features

* persist web sessions, add profile transfer and refresh the UI ([e338147](https://github.com/B1anker/harness-switch/commit/e338147c762fa5b366004e2f9c7e41a62276047d))

# [0.5.0](https://github.com/B1anker/harness-switch/compare/v0.4.0...v0.5.0) (2026-08-18)


### Features

* write official Pi configs and turn backups into config history ([f20a7c4](https://github.com/B1anker/harness-switch/commit/f20a7c47b2ebd6087c42efc1599f934c7b3b0077))

# [0.4.0](https://github.com/B1anker/harness-switch/compare/v0.3.0...v0.4.0) (2026-08-14)


### Features

* add DeepSeek Harness support ([fd6b4bb](https://github.com/B1anker/harness-switch/commit/fd6b4bbd54b493b7b333b7ee6f692798cad9a536))

# [0.3.0](https://github.com/B1anker/harness-switch/compare/v0.2.0...v0.3.0) (2026-08-14)


### Features

* switch harnesses by writing their native config files ([d0a9576](https://github.com/B1anker/harness-switch/commit/d0a9576caee30a3a7a55e5f0fd6ad90840c06bd0))

# [0.2.0](https://github.com/B1anker/harness-switch/compare/v0.1.0...v0.2.0) (2026-08-13)


### Bug Fixes

* bump version without npm so workspace protocol is safe ([e546cf2](https://github.com/B1anker/harness-switch/commit/e546cf29f98c62783a08d706ef3353ba63702d84))
* run workspace tests instead of bun test in CI ([1a1899a](https://github.com/B1anker/harness-switch/commit/1a1899abf12a4326003c2701d86368c6460bc573))


### Features

* rebuild as a Bun workspace with Hono and React ([f80d893](https://github.com/B1anker/harness-switch/commit/f80d89371d9fd1545d584c8def1806ed1c19870a))
