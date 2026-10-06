package nl.wallframe.app

import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager

object Prefs {
    private fun prefs(c: Context) = c.getSharedPreferences("wallframe", Context.MODE_PRIVATE)

    fun url(c: Context): String = prefs(c).getString("url", "") ?: ""

    fun setUrl(c: Context, value: String) = prefs(c).edit().putString("url", value).apply()

    /** Adds http:// when the scheme is missing, so "192.168.1.10:3050" just works. */
    fun normalize(input: String): String {
        val t = input.trim()
        if (t.isEmpty()) return t
        return if (t.startsWith("http://", true) || t.startsWith("https://", true)) t else "http://$t"
    }

    private fun homeAlias(c: Context) = ComponentName(c, "nl.wallframe.app.HomeAlias")

    fun isHome(c: Context): Boolean =
        c.packageManager.getComponentEnabledSetting(homeAlias(c)) ==
            PackageManager.COMPONENT_ENABLED_STATE_ENABLED

    fun setHome(c: Context, on: Boolean) {
        c.packageManager.setComponentEnabledSetting(
            homeAlias(c),
            if (on) PackageManager.COMPONENT_ENABLED_STATE_ENABLED else PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
            PackageManager.DONT_KILL_APP
        )
    }
}
