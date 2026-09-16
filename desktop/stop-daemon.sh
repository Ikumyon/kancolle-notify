#!/bin/sh
cd "$(dirname "$0")"
if [ -f "./kancolle-daemon" ]; then
    ./kancolle-daemon stop
elif [ -f "./daemon/target/release/kancolle-daemon" ]; then
    ./daemon/target/release/kancolle-daemon stop
else
    echo "kancolle-daemon binary not found."
    exit 1
fi
