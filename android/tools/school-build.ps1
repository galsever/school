# Runs on the PC (ssh pc): unpack android/ from ~/school-native.tar, build, install the debug build on the connected device.
# Called by tools/pc-build.sh on the dev box. Args: gradle task (default assembleDebug), -run to start the app afterwards.
param([string]$task = "assembleDebug", [switch]$run)
$ErrorActionPreference = "Continue"
$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-17.0.14.7-hotspot"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$dir = "$HOME\school-native"
if (Test-Path "$dir\app\src") { Remove-Item -Recurse -Force "$dir\app\src" }
New-Item -ItemType Directory -Force $dir | Out-Null
tar -xf "$HOME\school-native.tar" -C $dir
Set-Content -Encoding ascii "$dir\local.properties" ("sdk.dir=" + ($env:ANDROID_HOME -replace '\\','\\'))
Set-Location $dir
& .\gradlew.bat $task --console=plain -q 2>&1 | ForEach-Object { "$_" }
"EXIT=$LASTEXITCODE"
if ($LASTEXITCODE -eq 0 -and $task -eq "assembleDebug") {
    & "$env:ANDROID_HOME\platform-tools\adb.exe" install -r "$dir\app\build\outputs\apk\debug\app-debug.apk"
    if ($run) { & "$env:ANDROID_HOME\platform-tools\adb.exe" shell monkey -p com.galsever.school -c android.intent.category.LAUNCHER 1 | Out-Null }
}
