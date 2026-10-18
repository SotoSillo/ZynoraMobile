// Maakt de map www: dezelfde interface als op de pc, plus de Android-koppeling
const fs = require('fs'), path = require('path');
const src = path.join(__dirname, '..');
fs.rmSync('www', { recursive: true, force: true });
fs.mkdirSync('www', { recursive: true });
let h = fs.readFileSync(path.join(src, 'index.html'), 'utf8');
h = h.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '');
h = h.replace(/<link rel="manifest"[^>]*>/, '');
if (!h.includes('<script>')) throw new Error('script niet gevonden');
h = h.replace('<script>', '<script src="android-shim.js"></script>\n<script>');
fs.writeFileSync('www/index.html', h);
fs.cpSync(path.join(src, 'assets'), 'www/assets', { recursive: true });
fs.copyFileSync('android-shim.js', 'www/android-shim.js');
console.log('www klaar');
