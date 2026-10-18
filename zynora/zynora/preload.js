const { contextBridge, ipcRenderer } = require('electron');
const c = (n) => (o) => ipcRenderer.invoke(n, o);
contextBridge.exposeInMainWorld('zy', {
  api: 5,
  pick: c('pick'), scan: c('scan'), tags: c('tags'), spotify: c('spotify'), audius: c('audius'), free: c('free'), cover: c('cover'),
  lget: c('lget'), lset: c('lset'), clearcache: c('clearcache'), pickbg: c('pickbg'),
  spLogin: c('sp-login'), spStatus: c('sp-status'), spLogout: c('sp-logout'), spCall: c('sp-call'),
  update: c('update'), updateReset: c('update-reset'),
  remoteGet: c('remote-get'), remoteSet: c('remote-set'), syncGet: c('sync-get'),
  remixSave: c('remix-save'), remixList: c('remix-list'), remixDel: c('remix-del'), remixShow: c('remix-show')
});
