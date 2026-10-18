#!/bin/sh
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Installeer eerst Node.js via https://nodejs.org"; exit 1; }
npm install --no-audit --no-fund --loglevel=error
npm start
