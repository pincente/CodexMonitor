#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

DEVICE="${ANDROID_DEVICE:-}"
RUN_MODE="run"
RELEASE_MODE=1
SKIP_INIT=0
SKIP_TV_PATCH=0
INIT_ONLY=0
OPEN_ANDROID_STUDIO=0
LIST_DEVICES=0

ANDROID_DIR="src-tauri/gen/android"
MANIFEST_PATH="${ANDROID_DIR}/app/src/main/AndroidManifest.xml"
BANNER_PATH="${ANDROID_DIR}/app/src/main/res/drawable/tv_banner.xml"

usage() {
  cat <<'EOF'
Usage: scripts/build_run_android_tv.sh [options]

Initializes the Tauri Android target when needed, applies Google TV manifest settings,
and runs CodexMonitor on a connected Android/Google TV target.

Options:
  --device <name>      ADB device name/id to run on (optional)
  --dev                Run in development mode (`tauri android dev`)
  --debug              Run production command without `--release`
  --skip-init          Skip `tauri android init` when android target is missing
  --skip-tv-patch      Skip automatic Google TV manifest/banner patching
  --init-only          Initialize + patch then exit
  --open               Open Android Studio instead of launching on a device
  --list-devices       Show `adb devices -l` and exit
  -h, --help           Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --device)
      DEVICE="${2:-}"
      shift 2
      ;;
    --dev)
      RUN_MODE="dev"
      shift
      ;;
    --debug)
      RELEASE_MODE=0
      shift
      ;;
    --skip-init)
      SKIP_INIT=1
      shift
      ;;
    --skip-tv-patch)
      SKIP_TV_PATCH=1
      shift
      ;;
    --init-only)
      INIT_ONLY=1
      shift
      ;;
    --open)
      OPEN_ANDROID_STUDIO=1
      shift
      ;;
    --list-devices)
      LIST_DEVICES=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

resolve_npm() {
  if command -v npm >/dev/null 2>&1; then
    command -v npm
    return
  fi

  for candidate in /opt/homebrew/bin/npm /usr/local/bin/npm; do
    if [[ -x "$candidate" ]]; then
      echo "$candidate"
      return
    fi
  done

  if [[ -n "${NVM_DIR:-}" && -s "${NVM_DIR}/nvm.sh" ]]; then
    # shellcheck source=/dev/null
    . "${NVM_DIR}/nvm.sh"
    if command -v npm >/dev/null 2>&1; then
      command -v npm
      return
    fi
  fi

  return 1
}

ensure_android_target() {
  local npm_bin="$1"
  if [[ -d "$ANDROID_DIR" ]]; then
    return
  fi
  if [[ "$SKIP_INIT" -eq 1 ]]; then
    echo "Android target is missing at ${ANDROID_DIR} and --skip-init was provided." >&2
    exit 1
  fi

  echo "Initializing Tauri Android target..."
  "$npm_bin" run tauri -- android init --ci
}

insert_manifest_line_before_application() {
  local line="$1"
  local tmp_file
  tmp_file="$(mktemp)"
  awk -v insertion="$line" '
    /<application/ && inserted == 0 {
      print insertion
      inserted = 1
    }
    { print }
  ' "$MANIFEST_PATH" > "$tmp_file"
  mv "$tmp_file" "$MANIFEST_PATH"
}

patch_google_tv_manifest() {
  if [[ ! -f "$MANIFEST_PATH" ]]; then
    echo "AndroidManifest.xml not found at ${MANIFEST_PATH}" >&2
    exit 1
  fi

  if ! grep -Fq 'android.software.leanback' "$MANIFEST_PATH"; then
    insert_manifest_line_before_application \
      '    <uses-feature android:name="android.software.leanback" android:required="true" />'
  fi

  if ! grep -Fq 'android.hardware.touchscreen' "$MANIFEST_PATH"; then
    insert_manifest_line_before_application \
      '    <uses-feature android:name="android.hardware.touchscreen" android:required="false" />'
  fi

  if ! grep -Fq 'android.intent.category.LEANBACK_LAUNCHER' "$MANIFEST_PATH"; then
    local tmp_file
    tmp_file="$(mktemp)"
    awk '
      /android.intent.category.LAUNCHER/ && inserted == 0 {
        print
        print "                <category android:name=\"android.intent.category.LEANBACK_LAUNCHER\" />"
        inserted = 1
        next
      }
      { print }
    ' "$MANIFEST_PATH" > "$tmp_file"
    mv "$tmp_file" "$MANIFEST_PATH"
  fi

  if ! grep -Fq 'android:banner=' "$MANIFEST_PATH"; then
    perl -0777 -i -pe \
      's/<application(?![^>]*android:banner=)([^>]*)>/<application$1 android:banner="\@drawable\/tv_banner">/s' \
      "$MANIFEST_PATH"
  else
    # Normalize banner value to avoid malformed replacements such as "/tv_banner".
    perl -0777 -i -pe 's/android:banner="[^"]*"/android:banner="\@drawable\/tv_banner"/g' "$MANIFEST_PATH"
  fi

  mkdir -p "$(dirname "$BANNER_PATH")"
  if [[ ! -f "$BANNER_PATH" ]]; then
    cat > "$BANNER_PATH" <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item>
        <shape android:shape="rectangle">
            <gradient
                android:angle="0"
                android:startColor="#0f172a"
                android:endColor="#1e293b" />
        </shape>
    </item>
    <item
        android:drawable="@mipmap/ic_launcher"
        android:gravity="center"
        android:width="96dp"
        android:height="96dp" />
</layer-list>
EOF
  fi
}

if [[ "$LIST_DEVICES" -eq 1 ]]; then
  if ! command -v adb >/dev/null 2>&1; then
    echo "adb is required for --list-devices (install Android platform-tools)." >&2
    exit 1
  fi
  adb devices -l
  exit 0
fi

NPM_BIN="$(resolve_npm || true)"
if [[ -z "$NPM_BIN" ]]; then
  echo "Unable to find npm in PATH or common install locations." >&2
  echo "Install Node/npm, or run from a shell where npm is available." >&2
  exit 1
fi

ensure_android_target "$NPM_BIN"

if [[ "$SKIP_TV_PATCH" -eq 0 ]]; then
  patch_google_tv_manifest
fi

if [[ "$INIT_ONLY" -eq 1 ]]; then
  echo "Android target ready for Google TV at ${ANDROID_DIR}."
  exit 0
fi

if [[ "$RUN_MODE" == "dev" ]]; then
  cmd=("$NPM_BIN" run tauri -- android dev)
  if [[ "$OPEN_ANDROID_STUDIO" -eq 1 ]]; then
    cmd+=("--open")
  fi
  if [[ -n "$DEVICE" ]]; then
    cmd+=("$DEVICE")
  fi
else
  cmd=("$NPM_BIN" run tauri -- android run)
  if [[ "$RELEASE_MODE" -eq 1 ]]; then
    cmd+=("--release")
  fi
  if [[ "$OPEN_ANDROID_STUDIO" -eq 1 ]]; then
    cmd+=("--open")
  fi
  if [[ -n "$DEVICE" ]]; then
    cmd+=("$DEVICE")
  fi
fi

"${cmd[@]}"
