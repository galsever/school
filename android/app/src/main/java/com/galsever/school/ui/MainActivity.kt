package com.galsever.school.ui

import android.Manifest
import android.content.Intent
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Assignment
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.EventBusy
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.MailOutline
import androidx.compose.material.icons.outlined.School
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.galsever.school.auth.LoginActivity
import com.galsever.school.net.ApiException
import com.galsever.school.ui.screens.AbsencesScreen
import com.galsever.school.ui.screens.AssignmentScreen
import com.galsever.school.ui.screens.AssignmentsScreen
import com.galsever.school.ui.screens.ChannelScreen
import com.galsever.school.ui.screens.ChatsScreen
import com.galsever.school.ui.screens.ComposeMailScreen
import com.galsever.school.ui.screens.ConnectScreen
import com.galsever.school.ui.screens.ConversationScreen
import com.galsever.school.ui.screens.CourseScreen
import com.galsever.school.ui.screens.FolderScreen
import com.galsever.school.ui.screens.MailReaderScreen
import com.galsever.school.ui.screens.MailScreen
import com.galsever.school.ui.screens.MoodleAssignmentScreen
import com.galsever.school.ui.screens.MoodlePageScreen
import com.galsever.school.ui.screens.MoodleScreen
import com.galsever.school.ui.screens.SettingsScreen
import com.galsever.school.ui.screens.TeamsScreen
import com.galsever.school.ui.theme.Sc
import com.galsever.school.ui.theme.SchoolTheme
import kotlinx.coroutines.flow.collectLatest

/** Unread counts for the bottom bar, kept fresh by the shell and by the screens that load the same data. */
object Badges {
    var chats by mutableIntStateOf(0)
    var mail by mutableIntStateOf(0)
}

class MainActivity : ComponentActivity() {
    private var loginOpen = false
    private var nav: NavHostController? = null

    private val login = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        loginOpen = false
        if (r.resultCode == RESULT_OK) {
            Cache.drop("")
            recreate()
        }
    }

    private val notifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) {}

    private fun startLogin() {
        if (loginOpen) return
        loginOpen = true
        login.launch(Intent(this, LoginActivity::class.java))
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(Sc.bar.toArgb()),
        )
        if (!app.session.loggedIn) startLogin()
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED
        ) notifications.launch(Manifest.permission.POST_NOTIFICATIONS)

        setContent {
            SchoolTheme {
                val navController = rememberNavController()
                nav = navController
                val snack = remember { SnackbarHostState() }
                LaunchedEffect(Unit) { app.api.gateLogin.collectLatest { startLogin() } }
                LaunchedEffect(Unit) { intent?.getStringExtra(EXTRA_ROUTE)?.let { navController.navigate(it) } }
                CompositionLocalProvider(LocalNav provides navController, LocalSnack provides snack) {
                    Shell(navController, snack)
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        com.galsever.school.work.Checker.visible = true
    }

    override fun onPause() {
        super.onPause()
        com.galsever.school.work.Checker.visible = false
    }

    /** A tap on a notification while the app is open. */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intent.getStringExtra(EXTRA_ROUTE)?.let { nav?.navigate(it) }
    }

    companion object {
        const val EXTRA_ROUTE = "route"
    }
}

private data class Tab(val route: String, val label: String, val icon: ImageVector)

private val tabs = listOf(
    Tab(Routes.CHATS, "Chats", Icons.Outlined.ChatBubbleOutline),
    Tab(Routes.TEAMS, "Teams", Icons.Outlined.Groups),
    Tab(Routes.ASSIGNMENTS, "Tasks", Icons.Outlined.Assignment),
    Tab(Routes.MAIL, "Mail", Icons.Outlined.MailOutline),
    Tab(Routes.ABSENCES, "Absences", Icons.Outlined.EventBusy),
    Tab(Routes.MOODLE, "Moodle", Icons.Outlined.School),
    Tab(Routes.SETTINGS, "Settings", Icons.Outlined.Settings),
)

@Composable
private fun Shell(nav: NavHostController, snack: SnackbarHostState) {
    val entry by nav.currentBackStackEntryAsState()
    val route = entry?.destination?.route
    val onTab = tabs.any { it.route == route }

    // bottom bar badges: unread chats and inbox mail
    Every(15_000) { runCatching { Badges.chats = app.api.chats().count { it.unread } } }
    Every(60_000) { runCatching { Badges.mail = app.api.mailUnread().count } }
    LaunchedEffect(Unit) {
        try {
            Badges.chats = app.api.chats().count { it.unread }
            Badges.mail = app.api.mailUnread().count
        } catch (_: ApiException) {
        }
    }

    Box(Modifier.fillMaxSize().background(Sc.background)) {
        Column(Modifier.fillMaxSize()) {
            Box(Modifier.weight(1f).statusBarsPadding().let { if (onTab) it else it.navigationBarsPadding() }.imePadding()) {
                NavHost(nav, startDestination = Routes.CHATS) {
                    composable(Routes.CHATS) { ChatsScreen() }
                    composable("chat/{id}", listOf(navArgument("id") { type = NavType.StringType })) {
                        ConversationScreen(it.arguments!!.getString("id")!!)
                    }
                    composable(Routes.TEAMS) { TeamsScreen() }
                    composable("channel/{team}/{id}", listOf(navArgument("team") {}, navArgument("id") {})) {
                        ChannelScreen(it.arguments!!.getString("team")!!, it.arguments!!.getString("id")!!)
                    }
                    composable(
                        "folder/{drive}/{item}?name={name}",
                        listOf(navArgument("drive") {}, navArgument("item") {}, navArgument("name") { defaultValue = "" }),
                    ) {
                        val a = it.arguments!!
                        FolderScreen(a.getString("drive")!!, a.getString("item")!!, a.getString("name").orEmpty())
                    }
                    composable(Routes.ASSIGNMENTS) { AssignmentsScreen() }
                    composable("assignment/{classId}/{id}", listOf(navArgument("classId") {}, navArgument("id") {})) {
                        AssignmentScreen(it.arguments!!.getString("classId")!!, it.arguments!!.getString("id")!!)
                    }
                    composable(Routes.MAIL) { MailScreen() }
                    composable("mail/{id}", listOf(navArgument("id") {})) { MailReaderScreen(it.arguments!!.getString("id")!!) }
                    composable(Routes.COMPOSE) { ComposeMailScreen() }
                    composable(Routes.ABSENCES) { AbsencesScreen() }
                    composable(Routes.MOODLE) { MoodleScreen() }
                    composable("course/{id}", listOf(navArgument("id") { type = NavType.LongType })) {
                        CourseScreen(it.arguments!!.getLong("id"))
                    }
                    composable(
                        "moodle-assignment/{cmid}/{course}",
                        listOf(navArgument("cmid") { type = NavType.LongType }, navArgument("course") { type = NavType.LongType }),
                    ) { MoodleAssignmentScreen(it.arguments!!.getLong("cmid"), it.arguments!!.getLong("course")) }
                    composable(
                        "moodle-page?url={url}&name={name}",
                        listOf(navArgument("url") { defaultValue = "" }, navArgument("name") { defaultValue = "" }),
                    ) { MoodlePageScreen(it.arguments!!.getString("url")!!, it.arguments!!.getString("name")!!) }
                    composable(Routes.SETTINGS) { SettingsScreen() }
                    composable(Routes.CONNECT) { ConnectScreen() }
                }
                SnackbarHost(snack, Modifier.align(Alignment.BottomCenter).padding(12.dp))
            }
            if (onTab) BottomBar(nav, route)
        }
    }
}

/** The website's phone bar: all tabs, icon over a small label, badges on Chats and Mail. */
@Composable
private fun BottomBar(nav: NavHostController, current: String?) {
    Row(Modifier.fillMaxWidth().background(Sc.bar).navigationBarsPadding()) {
        tabs.forEach { tab ->
            val active = tab.route == current
            val badge = when (tab.route) {
                Routes.CHATS -> Badges.chats
                Routes.MAIL -> Badges.mail
                else -> 0
            }
            Column(
                Modifier
                    .weight(1f)
                    .clickable {
                        if (!active) nav.navigate(tab.route) {
                            popUpTo(nav.graph.findStartDestination().id) { saveState = true }
                            launchSingleTop = true
                            restoreState = true
                        }
                    }
                    .padding(top = 8.dp, bottom = 6.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Box {
                    Icon(tab.icon, tab.label, tint = if (active) Sc.primary else Sc.mutedFg, modifier = Modifier.size(22.dp))
                    if (badge > 0) {
                        Box(
                            Modifier.align(Alignment.TopEnd).offset(x = 8.dp, y = (-4).dp)
                                .clip(RoundedCornerShape(50)).background(Sc.primary).padding(horizontal = 4.dp),
                        ) {
                            Text(if (badge > 99) "99+" else "$badge", color = Sc.onPrimary, fontSize = 9.sp)
                        }
                    }
                }
                Text(tab.label, fontSize = 10.sp, color = if (active) Sc.primary else Sc.mutedFg, maxLines = 1)
            }
        }
    }
}
