package com.galsever.school.auth

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.browser.customtabs.CustomTabsIntent
import com.galsever.school.App
import com.galsever.school.net.ORIGIN
import java.security.SecureRandom

/**
 * Pocket ID login through the gate in a Chrome tab (passkeys and password managers do not work in a
 * WebView). After the login the gate lets the tab through to the server's /api/app/handoff, which
 * redirects to <appId>://auth with our state and the gate cookie (AuthRedirectActivity -> onNewIntent).
 */
class LoginActivity : Activity() {
    private var state: String? = null
    private var left = false

    override fun onCreate(saved: Bundle?) {
        super.onCreate(saved)
        if (saved != null) {
            state = saved.getString("state")
            left = saved.getBoolean("left")
            return
        }
        val bytes = ByteArray(16).also { SecureRandom().nextBytes(it) }
        state = bytes.joinToString("") { "%02x".format(it) }
        val rd = "/api/app/handoff?state=$state"
        val url = Uri.parse("$ORIGIN/oauth2/start?rd=" + Uri.encode(rd))
        CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(this, url)
    }

    override fun onSaveInstanceState(out: Bundle) {
        super.onSaveInstanceState(out)
        out.putString("state", state)
        out.putBoolean("left", left)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        val data = intent.data
        val cookie = data?.getQueryParameter("c")
        if (cookie == null || state == null || state != data.getQueryParameter("state")) {
            done(RESULT_CANCELED)
            return
        }
        App.instance.session.gateCookie = cookie
        done(RESULT_OK)
    }

    override fun onPause() {
        super.onPause()
        left = true
    }

    /** Back from the tab without the redirect (closed it): give up; the app asks again on the next request. */
    override fun onResume() {
        super.onResume()
        if (left && !isFinishing) done(RESULT_CANCELED)
    }

    private fun done(code: Int) {
        setResult(code)
        finish()
    }
}
