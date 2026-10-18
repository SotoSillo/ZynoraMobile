#!/bin/sh
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Installeer eerst Node.js via https://nodejs.org"; exit 1; }
npm install && npm run dist && echo "Klaar! Zie de map dist."
