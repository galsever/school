package com.galsever.school.net

import android.content.Context
import com.galsever.school.BuildConfig
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl

/** school.galsever.com: tailnet only, behind the Pocket ID gate. */
val ORIGIN: String = BuildConfig.ORIGIN

/** A path of the hub ("/api/...") or a full URL -> a full URL. */
fun absolute(url: String): String = if (url.startsWith("http")) url else ORIGIN + url

/**
 * The Pocket ID gate's session cookie (_oauth2_proxy), kept in SharedPreferences. OkHttp sends it with
 * every request to ORIGIN; a refreshed value from the gate replaces it.
 */
class Session(context: Context) : CookieJar {
    private val prefs = context.getSharedPreferences("session", Context.MODE_PRIVATE)
    private val host = ORIGIN.removePrefix("https://")

    var gateCookie: String?
        get() = prefs.getString("gate", null)
        set(v) = prefs.edit().apply { if (v == null) remove("gate") else putString("gate", v) }.apply()

    val loggedIn: Boolean get() = gateCookie != null

    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        val v = gateCookie ?: return emptyList()
        if (url.host != host) return emptyList()
        return listOf(Cookie.Builder().name(GATE_COOKIE).value(v).hostOnlyDomain(host).path("/").secure().httpOnly().build())
    }

    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        if (url.host != host) return
        cookies.firstOrNull { it.name == GATE_COOKIE }?.let {
            gateCookie = if (it.expiresAt < System.currentTimeMillis()) null else it.value
        }
    }

    companion object {
        const val GATE_COOKIE = "_oauth2_proxy"
    }
}
