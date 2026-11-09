package com.galsever.school.ui.screens

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.provider.Settings as AndroidSettings
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.galsever.school.BuildConfig
import com.galsever.school.net.ApiException
import com.galsever.school.net.DeviceLogin
import com.galsever.school.ui.Avatar
import com.galsever.school.ui.Cache
import com.galsever.school.ui.CardBox
import com.galsever.school.ui.Files
import com.galsever.school.ui.LocalNav
import com.galsever.school.ui.LocalSnack
import com.galsever.school.ui.Routes
import com.galsever.school.ui.TopBar
import com.galsever.school.ui.act
import com.galsever.school.ui.app
import com.galsever.school.ui.rememberLoader
import com.galsever.school.ui.theme.Sc
import com.galsever.school.work.Checker
import kotlinx.coroutines.delay

@Composable
fun SettingsScreen() {
    val nav = LocalNav.current
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val snack = LocalSnack.current
    val ms = rememberLoader("ms") { app.api.msStatus() }

    Column(Modifier.fillMaxSize()) {
        TopBar("Settings")
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            CardBox {
                val me = ms.data?.me
                if (ms.data?.connected == true && me != null) Row(verticalAlignment = Alignment.CenterVertically) {
                    Avatar(me.name)
                    Column(Modifier.weight(1f).padding(start = 12.dp)) {
                        Text(me.name, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(me.mail, fontSize = 13.sp, color = Sc.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    OutlinedButton(onClick = {
                        scope.act(snack) {
                            app.api.msLogout()
                            Cache.drop("")
                            nav.navigate(Routes.CONNECT)
                        }
                    }) { Text("Sign out") }
                } else Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Microsoft", fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
                    Button(onClick = { nav.navigate(Routes.CONNECT) }) { Text("Connect") }
                }
            }
            NotificationsCard(ctx)
            UntisCard()
            MoodleCard()
            CardBox {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("App", fontWeight = FontWeight.Medium)
                        Text("Version ${BuildConfig.VERSION_NAME}", fontSize = 13.sp, color = Sc.mutedFg)
                    }
                    TextButton(onClick = { Files.openUrl(ctx, "https://school.galsever.com") }) { Text("Website") }
                    TextButton(onClick = {
                        app.session.gateCookie = null
                        Cache.drop("")
                        app.api.gateLogin.tryEmit(Unit)
                    }) { Text("Sign out") }
                }
            }
        }
    }
}

/** Which kinds the background check (every 15 min) may notify about. */
@Composable
private fun NotificationsCard(ctx: Context) {
    var prefs by remember { mutableStateOf(Checker.kinds(ctx)) }
    CardBox {
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Notifications", fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
                TextButton(onClick = {
                    ctx.startActivity(Intent(AndroidSettings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(AndroidSettings.EXTRA_APP_PACKAGE, ctx.packageName))
                }) { Text("System") }
            }
            Checker.KINDS.forEach { (kind, label) ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(label, modifier = Modifier.weight(1f))
                    Switch(
                        checked = kind in prefs,
                        onCheckedChange = { on ->
                            prefs = if (on) prefs + kind else prefs - kind
                            Checker.setKinds(ctx, prefs)
                        },
                        colors = SwitchDefaults.colors(checkedTrackColor = Sc.primary, checkedThumbColor = Sc.onPrimary),
                    )
                }
            }
            Text("Checked about every 15 minutes", fontSize = 12.sp, color = Sc.mutedFg)
        }
    }
}

@Composable
private fun UntisCard() {
    val scope = rememberCoroutineScope()
    val snack = LocalSnack.current
    val login = rememberLoader("untis-login") { app.api.untisLogin() }
    var form by remember { mutableStateOf<List<String>?>(null) } // server, school, user, password, place
    var saving by remember { mutableStateOf(false) }
    val l = login.data ?: return
    CardBox {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("WebUntis", fontWeight = FontWeight.Medium)
                    if (l.configured) Text(l.user, fontSize = 13.sp, color = Sc.mutedFg)
                }
                if (form == null) {
                    if (l.configured) OutlinedButton(onClick = { form = listOf(l.server, l.school, l.user, "", l.place) }) { Text("Edit") }
                    else Button(onClick = { form = listOf("spengergasse.webuntis.com", "", "", "", "Wien") }) { Text("Connect") }
                }
            }
            form?.let { f ->
                val labels = listOf("Server", "School (login name)", "User", if (l.configured) "Password (unchanged)" else "Password", "Place on the letter")
                f.forEachIndexed { i, v ->
                    Field(labels[i], v, password = i == 3) { nv -> form = f.toMutableList().also { it[i] = nv } }
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    TextButton(onClick = { form = null }) { Text("Cancel") }
                    Button(enabled = !saving, onClick = {
                        saving = true
                        scope.act(snack) {
                            try {
                                app.api.saveUntisLogin(f[0], f[1], f[2], f[3], f[4])
                                form = null
                                Cache.drop("absences")
                                login.reload()
                            } finally {
                                saving = false
                            }
                        }
                    }) { Text("Save") }
                }
            }
        }
    }
}

@Composable
private fun MoodleCard() {
    val scope = rememberCoroutineScope()
    val snack = LocalSnack.current
    val login = rememberLoader("moodle-login") { app.api.moodleLogin() }
    var user by remember { mutableStateOf<String?>(null) }
    var password by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }
    val l = login.data ?: return
    CardBox {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Moodle", fontWeight = FontWeight.Medium)
                    if (l.configured) Text(l.user + if (l.blocked) "  ·  rejected" else "", fontSize = 13.sp, color = if (l.blocked) Sc.destructive else Sc.mutedFg)
                }
                if (user == null) {
                    if (l.configured) OutlinedButton(onClick = { user = l.user; password = "" }) { Text("Edit") }
                    else Button(onClick = { user = ""; password = "" }) { Text("Connect") }
                }
            }
            user?.let { u ->
                Field("User", u) { user = it }
                Field(if (l.configured) "Password (unchanged)" else "Password", password, password = true) { password = it }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    TextButton(onClick = { user = null }) { Text("Cancel") }
                    Button(enabled = !saving && u.isNotBlank(), onClick = {
                        saving = true
                        scope.act(snack) {
                            try {
                                app.api.saveMoodleLogin(u.trim(), password)
                                user = null
                                Cache.drop("moodle")
                                login.reload()
                            } finally {
                                saving = false
                            }
                        }
                    }) { Text("Save") }
                }
            }
        }
    }
}

@Composable
private fun Field(label: String, value: String, password: Boolean = false, onChange: (String) -> Unit) {
    TextField(
        value = value,
        onValueChange = onChange,
        singleLine = true,
        label = { Text(label) },
        visualTransformation = if (password) PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
        keyboardOptions = KeyboardOptions(keyboardType = if (password) KeyboardType.Password else KeyboardType.Text, autoCorrectEnabled = false),
        colors = fieldColors(),
        shape = RoundedCornerShape(10.dp),
        modifier = Modifier.fillMaxWidth(),
    )
}

// ---- Microsoft sign-in with a device code (the website's /connect) --------------------------------------

@Composable
fun ConnectScreen() {
    val nav = LocalNav.current
    val ctx = LocalContext.current
    var device by remember { mutableStateOf<DeviceLogin?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var attempt by remember { mutableStateOf(0) }

    LaunchedEffect(attempt) {
        error = null
        try {
            device = app.api.msDevice()
            while (true) {
                delay(3_000)
                val s = app.api.msDeviceState()
                device = device?.copy(state = s.state) ?: s
                when (s.state) {
                    "done" -> {
                        Cache.drop("")
                        nav.navigate(Routes.CHATS) { popUpTo(0) }
                        return@LaunchedEffect
                    }
                    "failed", "expired" -> return@LaunchedEffect
                }
            }
        } catch (e: ApiException) {
            error = e.message
        }
    }

    Column(Modifier.fillMaxSize()) {
        TopBar("Connect Microsoft", back = true)
        Column(Modifier.fillMaxSize().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
            val d = device
            when {
                error != null -> {
                    Text(error!!, color = Sc.destructive)
                    OutlinedButton(onClick = { attempt++ }) { Text("Retry") }
                }
                d == null -> Text("Starting", color = Sc.mutedFg)
                d.state == "failed" || d.state == "expired" -> {
                    Text(if (d.state == "expired") "The code expired" else "Sign-in failed", color = Sc.mutedFg)
                    Button(onClick = { attempt++ }) { Text("New code") }
                }
                else -> {
                    Text("Sign in with the school account and enter this code", color = Sc.mutedFg)
                    Text(d.userCode ?: "", fontSize = 34.sp, fontWeight = FontWeight.SemiBold, fontFamily = FontFamily.Monospace)
                    Button(onClick = {
                        val clip = ctx.getSystemService(ClipboardManager::class.java)
                        clip.setPrimaryClip(ClipData.newPlainText("code", d.userCode ?: ""))
                        Files.openUrl(ctx, d.url ?: "https://microsoft.com/devicelogin")
                    }) { Text("Copy code and open Microsoft") }
                }
            }
        }
    }
}
