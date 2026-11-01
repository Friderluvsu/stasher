const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  requestFolderAccess: () => ipcRenderer.invoke('request-folder-access'),
  openFullDiskAccess: () => ipcRenderer.invoke('open-full-disk-access'),
  startDrag: (data) => {
    ipcRenderer.send('ondragstart', data);
  },
  getPathForFile: (file) => {
    if (webUtils && typeof webUtils.getPathForFile === 'function') {
      try {
        return webUtils.getPathForFile(file);
      } catch (e) {
        console.warn('webUtils.getPathForFile error:', e);
      }
    }
    return file.path;
  }
});
