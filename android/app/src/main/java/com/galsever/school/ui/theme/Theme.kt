package com.galsever.school.ui.theme

import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/** The website's palette (web/src/index.css, dark only). */
object Sc {
    val background = Color(0xFF08080A)
    val bar = Color(0xFF050506)
    val card = Color(0xFF111114)
    val popover = Color(0xFF161619)
    val muted = Color(0xFF1F1F22)
    val accent = Color(0xFF242328)
    val bubble = Color(0xFF1A1A1F)
    val mine = Color(0xFF2A2240)
    val fg = Color(0xFFF5F5F5)
    val sub = Color(0xFFAAAAAA)
    val mutedFg = Color(0xFF97979E)
    val primary = Color(0xFFA684FF)
    val onPrimary = Color(0xFF0D0C15)
    val amber = Color(0xFFFBBF24)
    val green = Color(0xFF34D399)
    val sky = Color(0xFF38BDF8)
    val destructive = Color(0xFFFF6467)
    val divider = Color(0x17FFFFFF)
}

private val scheme = darkColorScheme(
    primary = Sc.primary,
    onPrimary = Sc.onPrimary,
    secondary = Sc.accent,
    onSecondary = Sc.fg,
    background = Sc.background,
    onBackground = Sc.fg,
    surface = Sc.background,
    onSurface = Sc.fg,
    surfaceVariant = Sc.muted,
    onSurfaceVariant = Sc.mutedFg,
    surfaceContainer = Sc.popover,
    surfaceContainerLow = Sc.card,
    surfaceContainerHigh = Sc.popover,
    surfaceContainerHighest = Sc.accent,
    surfaceContainerLowest = Sc.bar,
    outline = Color(0x33FFFFFF),
    outlineVariant = Sc.divider,
    error = Sc.destructive,
    inverseSurface = Sc.fg,
    inverseOnSurface = Sc.background,
)

private val type = Typography().run {
    copy(
        headlineMedium = headlineMedium.copy(fontWeight = FontWeight.Bold, letterSpacing = (-0.5).sp),
        headlineSmall = headlineSmall.copy(fontWeight = FontWeight.Bold, letterSpacing = (-0.3).sp),
        titleLarge = titleLarge.copy(fontWeight = FontWeight.Bold, letterSpacing = (-0.3).sp),
        titleMedium = titleMedium.copy(fontWeight = FontWeight.Medium),
    )
}

@Composable
fun SchoolTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = scheme, typography = type) {
        CompositionLocalProvider(LocalContentColor provides Sc.fg, content = content)
    }
}

val SubtitleStyle = TextStyle(color = Sc.sub, fontSize = 14.sp)
