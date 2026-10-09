const { contextBridge, ipcRenderer, webUtils } = require('electron');

const invoke = (ch) => (...args) => ipcRenderer.invoke(ch, ...args);

contextBridge.exposeInMainWorld('wf', {
  init: invoke('app:init'),
  setSettings: invoke('settings:set'),
  setOverlay: invoke('window:overlay'),
  setMica: invoke('window:mica'),

  list: invoke('fs:list'),
  drives: invoke('fs:drives'),
  diskFree: invoke('fs:diskFree'),
  exists: invoke('fs:exists'),
  open: invoke('fs:open'),
  reveal: invoke('fs:reveal'),
  trash: invoke('fs:trash'),
  rename: invoke('fs:rename'),
  newFolder: invoke('fs:newFolder'),
  newFile: invoke('fs:newFile'),
  paste: invoke('fs:paste'),
  readText: invoke('fs:readText'),
  folderSize: invoke('fs:folderSize'),
  icon: invoke('fs:icon'),
  thumb: invoke('fs:thumb'),

  searchStart: invoke('search:start'),
  searchCancel: invoke('search:cancel'),
  onSearchResults: (cb) => ipcRenderer.on('search:results', (_e, d) => cb(d)),

  watch: invoke('watch:set'),
  onWatch: (cb) => ipcRenderer.on('watch:changed', (_e, d) => cb(d)),

  organizePreview: invoke('organize:preview'),
  organizeRun: invoke('organize:run'),
  organizeUndo: invoke('organize:undo'),

  pickImage: invoke('dialog:pickImage'),
  pickFolder: invoke('dialog:pickFolder'),
  copyText: invoke('clipboard:text'),
  terminal: invoke('app:terminal'),
  openWith: invoke('app:openWith'),
  properties: invoke('app:properties'),
  startDrag: (paths) => ipcRenderer.send('drag:start', paths),
  archiveTemp: invoke('archive:temp'),
  archiveExtract: invoke('archive:extract'),
  spaceScan: invoke('space:scan'),
  spaceCancel: invoke('space:cancel'),
  spaceView: invoke('space:view'),
  onSpaceProgress: (cb) => ipcRenderer.on('space:progress', (_e, d) => cb(d)),
  updateStatus: invoke('update:status'),
  updateCheck: invoke('update:check'),
  updateInstall: invoke('update:install'),
  onNotice: (cb) => ipcRenderer.on('app:notice', (_e, d) => cb(d)),
  onUpdate: (cb) => ipcRenderer.on('update:status', (_e, d) => cb(d)),
  takeTargets: invoke('app:takeTargets'),
  onOpen: (cb) => ipcRenderer.on('app:open', (_e, d) => cb(d)),
  explorer: invoke('app:explorer'),
  integrationStatus: invoke('integration:status'),
  setExplorer: invoke('integration:setExplorer'),
  defaultBrowser: invoke('integration:defaultBrowser'),
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch { return ''; } },

  // built-in browser
  web: {
    create: invoke('web:create'),
    navigate: invoke('web:navigate'),
    back: invoke('web:back'),
    forward: invoke('web:forward'),
    reload: invoke('web:reload'),
    stop: invoke('web:stop'),
    zoom: invoke('web:zoom'),
    find: invoke('web:find'),
    stopFind: invoke('web:stopFind'),
    devtools: invoke('web:devtools'),
    print: invoke('web:print'),
    savePage: invoke('web:savePage'),
    focus: invoke('web:focus'),
    show: invoke('web:show'),
    hideAll: invoke('web:hideAll'),
    destroy: invoke('web:destroy'),
    lastFolder: invoke('web:lastFolder'),
    searchUrl: invoke('web:searchUrl'),
    preconnect: invoke('web:preconnect'),
    blockerStatus: invoke('web:blockerStatus'),
    history: invoke('web:history'),
    topSites: invoke('web:topSites'),
    clearData: invoke('web:clearData'),
    cancelDownload: invoke('web:cancelDownload'),
    on: (ch, cb) => {
      const allowed = ['web:state', 'web:open', 'web:hover', 'web:found', 'web:key', 'web:download', 'web:fullscreen', 'web:blocker', 'web:resync'];
      if (allowed.includes(ch)) ipcRenderer.on(ch, (_e, d) => cb(d));
    }
  }
});
