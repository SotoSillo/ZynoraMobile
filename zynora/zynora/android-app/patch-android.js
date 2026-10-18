// Past het Android-manifest aan: http-verkeer, Spotify-terugkeer (zynora://callback) en rechten voor meldingen
const fs = require('fs');
const f = 'android/app/src/main/AndroidManifest.xml';
let m = fs.readFileSync(f, 'utf8');
if (!/usesCleartextTraffic/.test(m)) m = m.replace('<application', '<application android:usesCleartextTraffic="true"');
if (!/android:scheme="zynora"/.test(m)) m = m.replace('</activity>', '<intent-filter><action android:name="android.intent.action.VIEW"/><category android:name="android.intent.category.DEFAULT"/><category android:name="android.intent.category.BROWSABLE"/><data android:scheme="zynora" android:host="callback"/></intent-filter></activity>');
const perms = ['WAKE_LOCK', 'FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_MEDIA_PLAYBACK', 'POST_NOTIFICATIONS']
  .filter(p => !m.includes('android.permission.' + p)).map(p => '<uses-permission android:name="android.permission.' + p + '"/>').join('');
m = m.replace('</manifest>', perms + '</manifest>');
fs.writeFileSync(f, m);
console.log('manifest aangepast');
