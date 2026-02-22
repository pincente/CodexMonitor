# CodexMonitor Android/Google TV Blueprint

This document is the canonical runbook for running CodexMonitor on Android TV / Google TV.

## Scope

- Android TV app runs in remote backend mode.
- Desktop CodexMonitor hosts the TCP daemon.
- Google TV app connects to desktop using remote host + token.
- This blueprint focuses on direct desktop connectivity (same LAN or Tailscale).

## Current Architecture

1. Desktop CodexMonitor runs local workspaces and hosts the daemon.
2. Google TV CodexMonitor connects to the desktop daemon over TCP.
3. Mobile defaults are remote on Android/iOS builds.
4. Google TV manifest requirements are applied from `scripts/build_run_android_tv.sh`.

## Prerequisites

- Android SDK + platform tools installed (`adb` available in `PATH`).
- Rust Android targets installed:

```bash
rustup target add aarch64-linux-android x86_64-linux-android
```

- A connected target:
  - Android TV emulator, or
  - Physical Google TV device with ADB debugging enabled.
- Desktop CodexMonitor configured with a non-empty remote backend token.

## One-Time Setup

Run once to initialize Android project files and apply TV manifest/banner defaults:

```bash
./scripts/build_run_android_tv.sh --init-only
```

What this does:

- Runs `tauri android init --ci` if `src-tauri/gen/android` is missing.
- Adds Leanback and non-touchscreen manifest features.
- Adds `LEANBACK_LAUNCHER` category to the launcher intent filter.
- Adds `android:banner="@drawable/tv_banner"` to the application.
- Creates a fallback drawable banner at `src-tauri/gen/android/app/src/main/res/drawable/tv_banner.xml`.

## Run Commands

List available ADB targets:

```bash
./scripts/build_run_android_tv.sh --list-devices
```

Run production mode on default device:

```bash
./scripts/build_run_android_tv.sh
```

Run production mode on a specific device:

```bash
./scripts/build_run_android_tv.sh --device "<adb-device-id>"
```

Run development mode with hot-reload:

```bash
./scripts/build_run_android_tv.sh --dev --device "<adb-device-id>"
```

Open Android Studio project instead of launching:

```bash
./scripts/build_run_android_tv.sh --open
```

## Connectivity Setup (TV App -> Desktop Daemon)

1. On desktop CodexMonitor, open `Settings > Server`.
2. Set `Remote backend token`.
3. Start daemon in `Mobile access daemon`.
4. Note the host/port (or use Tailscale host if applicable).
5. On Google TV app, enter host + token in `Settings > Server`.
6. Run `Connect & test` and confirm workspace list loads.

## Known Mobile Limits

- Terminal tooling is unavailable on mobile builds.
- Dictation is unavailable on mobile builds.

## Troubleshooting

- App does not appear in TV launcher:
  - Re-run `./scripts/build_run_android_tv.sh --init-only` to re-apply Leanback manifest settings.
- `adb` command not found:
  - Install Android platform tools and ensure `adb` is in `PATH`.
- Remote connection fails:
  - Verify desktop daemon is running.
  - Verify host/token match desktop settings.
  - Verify network path (LAN/Tailscale) between device and desktop.
