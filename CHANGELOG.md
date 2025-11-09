# 🧾 Changelog — Latency Logger

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),  
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---
## [0.10.0] – 2025-11-09
### Added
- Support for per-measurement `input_carrier` and `output_carrier` fields  
  (stored, displayed, and included in chain validation)
- Enhanced `/api/chain-validate-structured` response now returns `dut_config`  
  with I/O carrier and mode for banner display
- Validation banner now clearly shows `(I/O: X → Y)` for DUT
- Devices table toggled via button; Add/Edit modal now overlays cleanly

### Fixed
- Duplicate measurement handling corrected to consider I/O carriers  
- Removed redundant declarations and overlapping `testers` variable
- Cleaned legacy code paths and ensured schema auto-migration for new columns

## [0.9.0] — 2025-11-08
### Added
- Initial public GitHub release 🎉  
- Full Express + SQLite backend (`index.js`) handling:
  - Device management (`GET/POST/PUT /api/devices`)
  - Measurement storage + duplicate filtering (`/api/measurements`)
  - Chain creation + validation (`/api/chains`, `/api/chain-validate-structured`)
- React frontend:
  - Guided chain builder (auto-detects tester → converter → DUT → display)
  - Per-device mode selector with persistent `localStorage` list
  - Auto mean calculation from three entered tests
  - Inline validation messages (`✅` or `❌`)  
  - DUT manual selection with radio button
  - Auto-validation when all prerequisites met (format, rate, chain complete)
  - Linear workflow for test entry → validation → save
- Systemd service definition for persistent web app (`latencylogger.service`)
- Code-Server integration for remote LXC-based editing environment

### Fixed
- DUT detection now correctly serialised and retained across validation steps  
- Chains no longer fail validation when DUT has no prior measurements  
- Display (sink) correctly determined by last display in *chain order*  
- Prevented duplicate measurement insertion when re-running tests  
- Normalised boolean fields (`is_dut`, `genlock_used`) after JSON serialisation  
- Fixed timestamp field defaulting to 1970-01-01 UTC (SQLite default bug)

### Changed
- Unified `/api/chain-validate` → `/api/chain-validate-structured` endpoint  
- Simplified React frontend state management  
- Removed redundant validation button; replaced with automatic validation  
- Mean latency displayed inline (`🧮 Mean = X ms (not yet saved)`)

### Known Issues
- Validation fails if sink display has no measurement at chosen rate/format  
- No field validation for duplicate device names yet  
- Device editing does not refresh UI automatically after update  

---

## [0.1.0] — 2025-11-01
- Proof-of-concept implementation with manual DUT entry and fixed chain validation.

---