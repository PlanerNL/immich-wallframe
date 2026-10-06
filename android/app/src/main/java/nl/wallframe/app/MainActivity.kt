package nl.wallframe.app

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout

class MainActivity : Activity() {

    private var web: WebView? = null
    private val handler = Handler(Looper.getMainLooper())
    private var url = ""
    private val retry = Runnable { web?.loadUrl(url) }

    @SuppressLint("SetJavaScriptEnabled", "ClickableViewAccessibility")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        url = Prefs.url(this)
        if (url.isBlank()) {
            openSettings()
            finish()
            return
        }

        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        if (Build.VERSION.SDK_INT >= 28) {
            window.attributes = window.attributes.apply {
                layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            }
        }

        val webView = WebView(this).apply {
            setBackgroundColor(Color.BLACK)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.useWideViewPort = true
            settings.loadWithOverviewMode = true
            addJavascriptInterface(Bridge(), "WallframeApp")
            webViewClient = object : WebViewClient() {
                override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                    if (request.isForMainFrame) showError(error.description?.toString() ?: "onbekende fout")
                }

                override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                    // the page crashed or was killed for memory: start fresh instead of closing the app
                    recreate()
                    return true
                }
            }
        }
        web = webView

        // Hold the top-left corner for 2 seconds to open the settings.
        val density = resources.displayMetrics.density
        val corner = View(this)
        val openSettingsLater = Runnable { openSettings() }
        corner.setOnTouchListener { _, e ->
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> handler.postDelayed(openSettingsLater, 2000)
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> handler.removeCallbacks(openSettingsLater)
            }
            true
        }

        val root = FrameLayout(this)
        root.setBackgroundColor(Color.BLACK)
        root.addView(webView, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        val size = (72 * density).toInt()
        root.addView(corner, FrameLayout.LayoutParams(size, size, Gravity.TOP or Gravity.START))
        setContentView(root)

        webView.loadUrl(url)
    }

    private fun showError(message: String) {
        val html = """
            <html><body style="background:#000;color:#bbb;font-family:sans-serif;display:flex;
            align-items:center;justify-content:center;height:100vh;margin:0;text-align:center">
            <div><p style="font-size:22px;color:#eee">Kan de fotolijst niet bereiken</p>
            <p>$url<br>$message</p><p>Opnieuw proberen over 15 seconden…</p>
            <p style="font-size:13px">Houd de linkerbovenhoek 2 seconden ingedrukt voor instellingen.</p></div>
            </body></html>
        """.trimIndent()
        web?.loadDataWithBaseURL(null, html, "text/html", "utf-8", null)
        handler.removeCallbacks(retry)
        handler.postDelayed(retry, 15_000)
    }

    private fun openSettings() {
        startActivity(Intent(this, SettingsActivity::class.java))
    }

    /** Called from the web page: dims the backlight as far as possible during night mode. */
    inner class Bridge {
        @JavascriptInterface
        fun setNight(on: Boolean) {
            runOnUiThread {
                window.attributes = window.attributes.apply {
                    screenBrightness = if (on) 0f else WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE
                }
            }
        }
    }

    private fun hideSystemBars() {
        if (Build.VERSION.SDK_INT >= 30) {
            window.insetsController?.let {
                it.hide(WindowInsets.Type.systemBars())
                it.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                or View.SYSTEM_UI_FLAG_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN)
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()
    }

    override fun onResume() {
        super.onResume()
        web?.onResume()
        // the address may have been changed in the settings
        val saved = Prefs.url(this)
        if (saved.isNotBlank() && saved != url) {
            url = saved
            web?.loadUrl(url)
        }
    }

    override fun onPause() {
        web?.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        web?.destroy()
        web = null
        super.onDestroy()
    }

    // The back button does nothing, so the frame can't be closed by accident.
    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean =
        if (keyCode == KeyEvent.KEYCODE_BACK) true else super.onKeyDown(keyCode, event)
}
