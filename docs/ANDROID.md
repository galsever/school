# Android app

Native Android client for the hub, folder `android/`, app id `com.galsever.school`. Kotlin, Jetpack Compose, OkHttp, kotlinx.serialization, Coil, jsoup, WorkManager, Play services document scanner. Setup copied from Earworm (`galsever/earworm`, `android/`): same Gradle versions, login and PC build.

## State (2026-11-10, work in progress)

- Branch `android` (not merged to main). Worktree on the dev box: `~/scratch/school-android`.
- All screens are written and the debug build **compiles** on the PC (`EXIT=0`). It has **not run yet**: no screen has been seen in the emulator, nothing is tested against the hub.
- No CI workflow and no signing keystore yet, so no release APK.

Decisions he made (2026-11-09): full parity with the website in the first release (all seven tabs); notifications by a background check every 15 minutes (WorkManager, no Firebase); phone extra: camera pages to an assignment as one PDF. Look: the website's dark palette.

## Next steps

1. Run it in the emulator on the PC: AVD `earworm` (shared with Earworm). Over ssh the emulator dies when the session ends; start it through WMI so it survives (`android/tools` has no script for it yet; the last try was interrupted, so check `adb devices` first: an emulator may still be running on the PC).
2. Sign in: the app opens the Pocket ID gate in a Chrome tab. The emulator has no passkey, so first open a one-time login link in the emulator's browser (`docker exec pocket-id /app/pocket-id one-time-access-token <user>` on the Pocket ID host, link `https://auth.example.com/lc/<token>`, valid 1 h, one use), then start the app.
3. Go through every tab with screenshots (`adb shell screencap`), fix what is broken. Things most likely to need work: WebView height of mail and HTML in scrolling screens, the message list paging, the quote split of mails, the document scanner on the emulator (needs Play services).
4. CI: `.github/workflows/android.yml` like Earworm's (`SC_KEYSTORE`, `SC_KEYSTORE_PASSWORD`, `SC_VERSION_CODE`, `SC_VERSION_NAME` are already read in `app/build.gradle.kts`), a new keystore kept on the dev box under `~/.config/school/`, secrets `SC_KEYSTORE_B64` and `SC_KEYSTORE_PASSWORD` on galsever/school.
5. Merge `android` into main (rebase first: other sessions commit to main), APK to his phone.

## Build

```
android/tools/pc-build.sh          # the dev box: tar android/ to the PC, build the debug APK there, install with adb
android/tools/pc-build.sh --run    # and start it
```

the dev box has no Android SDK. The PC (`ssh pc`) has the SDK in `%LOCALAPPDATA%\Android\Sdk` and JDK 17 (Adoptium). The script copies `tools/school-build.ps1` to the PC and builds in `~\school-native` (Earworm uses `~\ew-native` and `pc-build.ps1`, so the two do not collide).

There is only one build type that talks to the hub: debug and release both use `https://school.galsever.com` behind the Pocket ID gate. On purpose there is no ungated dev host like Earworm's music-dev: the hub holds the real school accounts.

## Login

Same as Earworm: `LoginActivity` opens `ORIGIN/oauth2/start?rd=/api/app/handoff?state=..` in a Chrome Custom Tab (passkeys do not work in a WebView). After the Pocket ID login the hub's `/api/app/handoff` redirects to `com.galsever.school://auth?state=..&c=<gate cookie>` (route already in `server/school/main.py`); `AuthRedirectActivity` hands it to `LoginActivity`, `Session` keeps the cookie. OkHttp follows no redirects: a 3xx or an HTML answer on `/api/` means "sign in again" (`Api.gateLogin`).

Pocket ID client `personal` already has the callback for school.galsever.com.

## Code map (`app/src/main/java/com/galsever/school/`)

| File | What |
|---|---|
| `App.kt` | OkHttp client with the gate cookie, Coil image loader, starts the background check |
| `net/Api.kt`, `net/Models.kt` | every route of docs/API.md and its shapes |
| `net/Session.kt` | gate cookie, `ORIGIN` |
| `auth/` | Pocket ID login (copied from Earworm) |
| `ui/MainActivity.kt` | navigation, bottom bar with all seven tabs and unread badges, login trigger, notification taps |
| `ui/Common.kt` | `rememberLoader` / `Content` (data with cache, spinner, error with retry), top bar, pills, cards, avatars, date texts like the website |
| `ui/Html.kt` | untrusted HTML: chat messages to text with links plus their images; mail and rich text cleaned like the website's `mailHtml` (colors and hidden parts gone, remote images only on request, quoted older mails split off) and shown in a locked WebView |
| `ui/Files.kt` | download and open files (FileProvider), file picker, document scanner (camera pages -> one PDF) |
| `ui/screens/Chats.kt` | chat list with search, a conversation (polled every 4 s, older pages while scrolling up, send, mark read, cards with assignment links, files) |
| `ui/screens/Teams.kt` | teams and channels, long press = rename and hide, channel with Posts / Files / Assignments, folder browser |
| `ui/screens/Assignments.kt` | Open / All, assignment with instructions, material, my work (file, scan, remove), turn in, undo, feedback |
| `ui/screens/Mail.kt` | Inbox / Sent / Archive, search, paging, reader (show images, earlier mails, attachments, reply, reply all), new mail with address suggestions |
| `ui/screens/Absences.kt` | days with reasons (saved after typing), PDF of selected days, attendance with ranges, own date range, subject groups |
| `ui/screens/Moodle.kt` | due, courses, search over all courses, course sections and grades, page activities, assignment with upload, scan, text and submit |
| `ui/screens/Settings.kt` | Microsoft account and the device code sign-in, notification kinds, WebUntis and Moodle logins, app sign-out |
| `work/Checker.kt` | background check every 15 min: unread chats, new open assignments, new inbox mail; the first run only remembers; nothing is notified while the app is on screen; one "sign in again" notice when the gate session ran out |
