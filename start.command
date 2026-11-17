#!/bin/zsh
# Doppelklick: startet LoAmp lokal und öffnet es im Browser.
cd "$(dirname "$0")"
python3 serve.py 8420 &
sleep 1
open "http://localhost:8420/"
wait
