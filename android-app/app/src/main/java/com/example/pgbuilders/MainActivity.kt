package com.example.pgbuilders

import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.browser.customtabs.CustomTabColorSchemeParams
import androidx.browser.customtabs.CustomTabsIntent

class MainActivity : ComponentActivity() {
  private var launched = false

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    launchCustomTab()
  }

  override fun onResume() {
    super.onResume()
    // If we have already launched the custom tab and the user returns here, close the app.
    if (launched) {
      finish()
    }
  }

  private fun launchCustomTab() {
    val url = "https://pgbuilderss.online"
    
    // Configure Custom Tabs UI to match PG Builders theme
    val colorParams = CustomTabColorSchemeParams.Builder()
      .setToolbarColor(Color.parseColor("#6C5CE7")) // Brand primary color
      .setSecondaryToolbarColor(Color.parseColor("#12122A")) // Dark theme card/surface color
      .build()

    val customTabsIntent = CustomTabsIntent.Builder()
      .setDefaultColorSchemeParams(colorParams)
      .setShowTitle(true) // Show web title
      .setUrlBarHidingEnabled(true) // Automatically hide address bar on scroll
      .setShareState(CustomTabsIntent.SHARE_STATE_OFF) // Remove share option for native feel
      .build()

    // Launch Custom Tabs loading the PWA securely
    customTabsIntent.launchUrl(this, Uri.parse(url))
    launched = true
  }
}
