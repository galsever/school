#!/bin/bash
# the dev box -> PC: build the app on the PC (Android SDK, JDK 17) and install it into the running emulator or phone (adb).
# Usage: android/tools/pc-build.sh [--run]   (see docs/ANDROID.md)
set -e
cd "$(dirname "$0")/.."
tmp=$(mktemp -d)
tar -cf "$tmp/school-native.tar" --exclude=build --exclude=.gradle --exclude=.kotlin .
scp -q "$tmp/school-native.tar" tools/school-build.ps1 pc:
rm -rf "$tmp"
args=""; [ "$1" = "--run" ] && args="-run"
ssh pc "powershell -File school-build.ps1 $args" 2>&1 | grep -vE "RemoteException|^\s*$" | sed 's|file:///C:/Users/[^/]*/school-native/||'
