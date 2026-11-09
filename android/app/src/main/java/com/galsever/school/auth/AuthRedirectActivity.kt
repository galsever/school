package com.galsever.school.auth

import android.app.Activity
import android.content.Intent
import android.os.Bundle

/** Receives the app-scheme redirect from the Chrome tab and hands it to LoginActivity
 *  (CLEAR_TOP closes the tab, which runs on top of LoginActivity in our task). */
class AuthRedirectActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        startActivity(
            Intent(this, LoginActivity::class.java)
                .setData(intent.data)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        )
        finish()
    }
}
