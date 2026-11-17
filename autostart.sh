#!/bin/zsh
# LoAmp als Hintergrunddienst: startet beim Login automatisch (nur localhost:8420).
#   ./autostart.sh install     installieren bzw. nach Änderungen aktualisieren
#   ./autostart.sh uninstall   wieder entfernen
SRC="$(cd "$(dirname "$0")" && pwd)"
APP="$HOME/Library/Application Support/LoAmp"
LABEL="com.loamp.server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"

case "$1" in
  install)
    mkdir -p "$APP" "$HOME/Library/LaunchAgents"
    # Kopie außerhalb von ~/Documents, damit macOS-Datenschutz den Dienst nicht blockiert
    rm -rf "$APP/icons"
    cp -R "$SRC/icons" "$SRC/index.html" "$SRC/styles.css" "$SRC/app.js" "$SRC/meter-worklet.js" \
          "$SRC/sw.js" "$SRC/manifest.webmanifest" "$SRC/serve.py" "$APP/"
    cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array>
    <string>/usr/bin/python3</string><string>$APP/serve.py</string><string>8420</string>
  </array>
  <key>WorkingDirectory</key><string>$APP</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardErrorPath</key><string>/tmp/loamp.err</string>
  <key>StandardOutPath</key><string>/tmp/loamp.out</string>
</dict></plist>
EOF
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null
    launchctl bootstrap "$DOMAIN" "$PLIST" && echo "LoAmp läuft: http://localhost:8420/"
    ;;
  uninstall)
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null
    rm -f "$PLIST"; rm -rf "$APP"
    echo "LoAmp-Dienst entfernt."
    ;;
  *) echo "Aufruf: $0 install|uninstall"; exit 1 ;;
esac
