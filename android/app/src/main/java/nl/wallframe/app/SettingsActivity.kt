package nl.wallframe.app

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.text.InputType
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast

class SettingsActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val pad = (24 * resources.displayMetrics.density).toInt()

        val title = TextView(this).apply {
            text = "Wallframe"
            textSize = 26f
        }
        val intro = TextView(this).apply {
            text = "Adres van de fotolijst op je Unraid-server, bijvoorbeeld http://192.168.1.10:3050"
            setPadding(0, pad / 2, 0, pad / 2)
        }
        val urlInput = EditText(this).apply {
            hint = "http://192.168.1.10:3050"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            setSingleLine()
            setText(Prefs.url(this@SettingsActivity))
        }
        val homeBox = CheckBox(this).apply {
            text = "Gebruiken als startscherm (start automatisch na een herstart)"
            isChecked = Prefs.isHome(this@SettingsActivity)
        }
        val tip = TextView(this).apply {
            text = "Tip: open dit scherm later weer door de linkerbovenhoek van de fotolijst 2 seconden ingedrukt te houden."
            setPadding(0, pad / 2, 0, pad / 2)
        }
        val save = Button(this).apply {
            text = "Opslaan en starten"
            setOnClickListener {
                val url = Prefs.normalize(urlInput.text.toString())
                if (url.isEmpty()) {
                    urlInput.error = "Vul een adres in"
                    return@setOnClickListener
                }
                Prefs.setUrl(this@SettingsActivity, url)
                val wasHome = Prefs.isHome(this@SettingsActivity)
                Prefs.setHome(this@SettingsActivity, homeBox.isChecked)
                if (homeBox.isChecked && !wasHome) {
                    Toast.makeText(this@SettingsActivity,
                        "Druk op de thuisknop en kies Wallframe → Altijd", Toast.LENGTH_LONG).show()
                }
                startActivity(Intent(this@SettingsActivity, MainActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP))
                finish()
            }
        }
        val exit = Button(this).apply {
            text = "App afsluiten"
            setOnClickListener { finishAffinity() }
        }

        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad, pad, pad)
            listOf(title, intro, urlInput, homeBox, tip, save, exit).forEach {
                addView(it, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
            }
        }
        setContentView(ScrollView(this).apply { addView(column) })
    }
}
