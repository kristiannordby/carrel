#!/bin/bash
# Double-click to install Carrel on a Mac (or run: bash install.command)
cd "$(dirname "$0")"
if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 is not installed. Install it from https://www.python.org/downloads/ and run this again."
  read -r -p "Press Enter to close."
  exit 1
fi
python3 install.py "$@"
read -r -p "Press Enter to close."
