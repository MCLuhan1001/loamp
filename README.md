# LoAmp – Audio Player PWA (Model 30)

**LoAmp** ist eine schlanke Progressive Web App für macOS im Design klassischer britischer Röhrenverstärker (schwarzes Tolex, cremefarbene Keder, gebürstetes Chrom, goldener Schriftzug, warm beleuchtete analoge VU-Meter und Diamantgitter-Bespannung).

---

## Funktionen

- **Drag & Drop & Dateiauswahl:** Einzelne Dateien, mehrere Titel oder ganze Ordner (inkl. Unterordner-Traversierung per `webkitGetAsEntry`) aufs Fenster ziehen oder über „Dateien …“ / „Ordner …“ laden.
- **Unterstützte Formate:** `MP3`, `M4A/M4B/AAC`, `WAV`, `FLAC`, `OGG/OGA/OPUS`, `AIFF/AIFC`, `CAF`, `WEBA` (Decodierung über die Audio-Engine von Safari/Chrome auf macOS). Nicht abspielbare Titel werden durchgestrichen markiert und übersprungen.
- **Wiedergabe & Steuerung:** Play/Pause, Stopp, Vor/Zurück, Spulen (±10 s Klick, schnelles Spulen bei gedrückter Taste), Positions-Slider, Lautstärke-Slider (quadratische Kennlinie, Anzeige `0.0`–`10.0`), Zufallswiedergabe (Shuffle) und Wiederholen (`aus`, `alle`, `Titel`).
- **macOS-Integration:** Tastenkürzel (`Leertaste`, Pfeiltasten, `N`, `P`, `S`), Hardware-Medientasten über die `MediaSession`-API sowie PWA-Dateiverknüpfung (`file_handlers` / `launchQueue`).
- **Skalierbares Gehäuse:** Fließende Skalierung bis hinab zu kleinen Mini-Fenstern (`min-width: 240px`) sowie automatischer „Topteil“-Kompaktmodus bei niedriger Fensterhöhe, ohne den unteren Gehäuserahmen abzuschneiden.

---

## Rundfunkelektronische Pegelmessung (`meter-worklet.js`)

Die Pegelanzeige ist keine Dekoration, sondern arbeitet vollständig im Echtzeit-Audio-Thread (`AudioWorkletProcessor`, `meter-worklet.js`) **vor** dem Lautstärkeregler (`GainNode`), sodass stets der echte Programmpegel unabhängig von der Abhörlautstärke angezeigt wird:

1. **VU-Meter-Ballistik (ANSI C16.5 / IEC 60268-17):**
   - Vollweggleichrichtung des Signals und Skalierung mit `1,1107` (`π / (2√2)`), sodass ein reiner Sinuston seinen Effektivwert (RMS) anzeigt.
   - Modelliert als gedämpftes System 2. Ordnung (`ωn = 13,1 rad/s`, `ζ = 0,8`): ~300 ms Einschwingzeit auf 99 % und ~1–2 % Überschwingen.
2. **Schaltbare Bezugspegel (`0 VU`):**
   - `−18 dBFS` (EBU R68, Standard), `−20 dBFS` (SMPTE RP155), `−14 dBFS` (heißer gemasterte Musik).
3. **True-Peak-Warnung nach ITU-R BS.1770 / EBU R128:**
   - 4-fach überabgetastetes Polyphasen-FIR-Filter (49 Taps, Hann-gefensterter Sinc-Interpolator, DC-Verstärkung je Phase auf `1` normiert), das auch Zwischenabtastwerte-Spitzen (*Inter-Sample Peaks*) erkennt.
   - Die roten Clip-LEDs in beiden VU-Metern und die digitale Peak-Hold-Anzeige (`TP … dB`) im Display warnen ab **`−1,0 dBTP`** (EBU R128-Grenzwert; 1,5 s Haltezeit an den LEDs, Klick auf `TP` setzt den Peak-Hold zurück).
4. **Mono- & Ein-Kanal-Erkennung:**
   - Der `AudioWorkletNode` wird explizit mit `channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers'` betrieben.
   - Zusätzlich erkennt `LoAmpMeter`, wenn ein 2-Kanal-Stream auf dem rechten Kanal dauerhaft stumm ist (`|s| ≤ 1e-4`, z. B. Ein-Kanal-Aufnahme auf Spur 1), und spiegelt Kanal L auf R, bis R eigenes Signal führt.

---

## Installation & Nutzung (Mac & iPad)

### Online / Teilen über GitHub Pages (für alle Mac- & iPad-Nutzer)
- **Web-App-Link:** https://mcluhan1001.github.io/loamp/
- **Repository:** https://github.com/MCLuhan1001/loamp
- **iPad / iPhone (Safari):** Link öffnen → **Teilen** → **„Zum Home-Bildschirm“**. Startet im Vollbild ohne Safari-Leisten und funktioniert dank Service Worker (`loamp-v3`) auch offline. Audiodateien werden über **„Dateien …“** oder per Split-View-Drag-&-Drop aus der *Dateien*-App geladen.
- **Mac (Safari / Chrome):** Link öffnen → in Safari **„Ablage › Zum Dock hinzufügen“** bzw. in Chrome **„App installieren“**.
- **Datenschutz:** Audiodateien werden ausschließlich lokal per `URL.createObjectURL()` im Browser verarbeitet und verlassen niemals das Gerät.

### Lokaler Hintergrunddienst auf diesem Mac (optional)
Der lokale Server wird als macOS-`LaunchAgent` (`com.loamp.server`) nach `~/Library/Application Support/LoAmp` installiert (damit macOS-Ordnerschutzregeln für `~/Documents` den Hintergrunddienst nicht blockieren) und lauscht ausschließlich lokal auf `127.0.0.1:8420`:

```zsh
./autostart.sh install     # Dienst installieren bzw. nach Code-Änderungen aktualisieren
./autostart.sh uninstall   # Dienst und Kopie wieder entfernen
```

Anschließend `http://localhost:8420/` in **Google Chrome** („Als App installieren“) oder **Safari** („Ablage › Zum Dock hinzufügen“) als eigenständiges App-Fenster installieren.

### Manueller Start
Alternativ per Doppelklick auf `start.command` oder im Terminal:

```zsh
python3 serve.py 8420
```

---

## Dateistruktur

| Datei | Zweck |
|---|---|
| `index.html` | Semantisches Markup für Kopfzeile, Chrom-Bedienfeld, Display, VU-Canvas und Playlist |
| `styles.css` | Tolex-/Chrom-/Diamantgitter-Optik, `clamp()`-Skalierung, Container-Queries (`cabinet`) |
| `app.js` | Wiedergabe-Engine, Playlist/Drop-Logik, Web-Audio-Graph, Canvas-VU-Zeichnung, Shortcuts |
| `meter-worklet.js` | `AudioWorkletProcessor` für VU-Ballistik (2. Ordnung) und 4×-True-Peak-Messung |
| `manifest.webmanifest` | PWA-Metadaten, Icons, `file_handlers` |
| `sw.js` | Service Worker (`loamp-v3`, Network-First mit Offline-Cache-Fallback) |
| `serve.py` / `start.command` | Lokaler Python-HTTP-Server (nur `127.0.0.1`) und Doppelklick-Starter |
| `autostart.sh` | macOS-LaunchAgent-Installer (`~/Library/LaunchAgents/com.loamp.server.plist`) |
| `make_icons.py` / `icons/` | Generiert App-Icons (`icon.svg`, `192`, `512`, `maskable`, `apple-touch-icon`) via Headless-Chrome |
| `tests/meter.test.js` | Automatisierte Unit-Tests für `meter-worklet.js` (`node --test`) |

---

## Tests

Die DSP-Logik des `AudioWorkletProcessor` wird mit dem eingebauten Node-Testrunner ohne Browser geprüft:

```zsh
node --test tests/meter.test.js
```

Geprüft werden: Sinus-RMS-Kalibrierung, 300 ms VU-Ballistik und Überschwingen, Mono-Spiegelung, Kanal-Unabhängigkeit bei Stereo, stummer rechter Kanal mit Reset-Verhalten, Inter-Sample-True-Peak bei `fs/4` (+45° Phase) sowie Stille-Erkennung.

---

## Entwicklungsverlauf

1. **Grundaufbau (v1):** Umsetzung der PWA ohne externe Laufzeitabhängigkeiten (`index.html`, `styles.css`, `app.js`, `sw.js`, `manifest.webmanifest`, `serve.py`, `start.command`) im Vox-Design inkl. Icon-Generator (`make_icons.py` mit Headless-Chrome auf Apple Silicon).
2. **Lokale Node/npx-Einrichtung & Autostart:** Nachrüstung von Node v24 LTS (`~/.local/node`) und Einrichtung des macOS-`LaunchAgent` über `autostart.sh`, um LoAmp ohne manuelles Terminal-Starten auf `http://localhost:8420/` als Dock-/App-Fenster zu betreiben.
3. **Pegelmessung & Bugfixes (v2):**
   - Ersetzen von `ChannelSplitterNode` + einfachem `AnalyserNode` durch ein dediziertes `AudioWorklet` (`meter-worklet.js`) mit echter ANSI/IEC-VU-Ballistik, 4×-Oversampling-True-Peak (ITU-R BS.1770 / EBU R128 `−1 dBTP`-Warnung), umschaltbaren Bezugspegeln (`−18 / −20 / −14 dBFS`) und Reparatur des rechten VU-Meters bei Mono- sowie einseitig stummen Quellen.
   - Behebung des abgeschnittenen unteren Gehäuserahmens bei flach zusammengeschobenen Fenstern durch Entfernen von `min-height: 30rem` / `min-height: 8rem`, Umstellung auf `container: cabinet / size`, Topteil-Kompaktmodus bei niedriger Höhe und Erweiterung der fließenden Skalierung nach unten (`8px`–`20px`).
   - Ergänzung der Unit-Tests (`tests/meter.test.js`), Bereinigung von `unloadAudio()`/`resetPeak()` und Aktualisierung von `sw.js` sowie `autostart.sh`.
4. **GitHub Pages & iPadOS-Unterstützung (v3):**
   - Einrichtung der GitHub CLI (`gh` 2.104.0 unter `~/.local/gh`), Anlegen des öffentlichen GitHub-Repositories `MCLuhan1001/loamp` und Aktivierung von **GitHub Pages** (`https://mcluhan1001.github.io/loamp/`).
   - Ergänzung der Apple-PWA-Meta-Tags (`apple-mobile-web-app-capable`, `black-translucent`) in `index.html`, `touch-action: none` für Slider in `styles.css`, automatisches Ausblenden des auf iPadOS nicht unterstützten „Ordner …“-Buttons in `app.js` sowie Cache-Bump auf `loamp-v3` in `sw.js`.
