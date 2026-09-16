#!/bin/sh
cd "$(dirname "$0")"
if [ -f "./kancolle-gui" ]; then
    ./kancolle-gui
else
    python3 gui/main.py
fi
