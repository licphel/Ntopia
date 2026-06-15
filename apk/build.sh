#!/bin/bash
# Build Ntopia APK — bare metal, no Docker
# Prerequisites: Java 17+ and Android SDK (or let this script install them)
set -e
cd "$(dirname "$0")"
SCRIPT_DIR="$PWD"

echo "=== Ntopia APK Builder ==="

# ── Java ────────────────────────────────────────────────────────
if ! command -v java &>/dev/null; then
  echo "Installing Java 17..."
  sudo apt update -qq && sudo apt install -y openjdk-17-jdk
fi
echo "Java: $(java -version 2>&1 | head -1)"

# ── Android SDK ──────────────────────────────────────────────────
ANDROID_SDK="${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}"
if [ ! -f "$ANDROID_SDK/cmdline-tools/latest/bin/sdkmanager" ]; then
  echo "Installing Android SDK to $ANDROID_SDK..."
  mkdir -p "$ANDROID_SDK/cmdline-tools"
  wget -qO /tmp/sdk.zip https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
  unzip -qo /tmp/sdk.zip -d "$ANDROID_SDK/cmdline-tools"
  mv "$ANDROID_SDK/cmdline-tools/cmdline-tools" "$ANDROID_SDK/cmdline-tools/latest"
  rm /tmp/sdk.zip

  # Accept licenses and install build tools
  yes | "$ANDROID_SDK/cmdline-tools/latest/bin/sdkmanager" --licenses > /dev/null 2>&1
  "$ANDROID_SDK/cmdline-tools/latest/bin/sdkmanager" \
    "platform-tools" "platforms;android-34" "build-tools;34.0.0" > /dev/null 2>&1
fi

# ── Local properties ─────────────────────────────────────────────
echo "sdk.dir=$ANDROID_SDK" > local.properties

# ── Debug keystore ──────────────────────────────────────────────
KEYSTORE="$HOME/.android/debug.keystore"
if [ ! -f "$KEYSTORE" ]; then
  mkdir -p "$HOME/.android"
  keytool -genkey -v -keystore "$KEYSTORE" \
    -storepass android -alias androiddebugkey -keypass android \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=Debug,O=Ntopia,C=US" 2>/dev/null
fi

# ── Gradle wrapper ───────────────────────────────────────────────
if [ ! -f gradle/wrapper/gradle-wrapper.jar ]; then
  echo "Downloading Gradle wrapper..."
  mkdir -p gradle/wrapper
  wget -qO gradle/wrapper/gradle-wrapper.jar \
    https://raw.githubusercontent.com/gradle/gradle/v8.5.0/gradle/wrapper/gradle-wrapper.jar
  echo "distributionUrl=https\\://services.gradle.org/distributions/gradle-8.5-bin.zip" > gradle/wrapper/gradle-wrapper.properties
fi

# ── Build ───────────────────────────────────────────────────────
echo "Building APK..."
chmod +x gradlew 2>/dev/null || true
./gradlew assembleRelease 2>&1 | tail -5

APK="app/build/outputs/apk/release/app-release.apk"
if [ -f "$APK" ]; then
  cp "$APK" "$SCRIPT_DIR/ntopia.apk"
  echo ""
  echo "=== Done: ntopia.apk ($(du -h "$SCRIPT_DIR/ntopia.apk" | cut -f1)) ==="
else
  echo "Build failed. Check logs above."
  exit 1
fi
