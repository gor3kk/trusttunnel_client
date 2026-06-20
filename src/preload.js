import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  getProfiles: () => ipcRenderer.invoke('get-profiles'),
  saveProfile: (name, config) => ipcRenderer.invoke('save-profile', name, config),
  deleteProfile: (name) => ipcRenderer.invoke('delete-profile', name),
  startVpn: (name) => ipcRenderer.invoke('start-vpn', name),
  stopVpn: () => ipcRenderer.invoke('stop-vpn'),
  getVpnStatus: () => ipcRenderer.invoke('get-vpn-status'),
  importProfileFromUrl: (url) => ipcRenderer.invoke('import-profile-from-url', url),
  onVpnStatusChanged: (callback) => {
    const subscription = (event, status) => callback(status);
    ipcRenderer.on('vpn-status-changed', subscription);
    return () => ipcRenderer.removeListener('vpn-status-changed', subscription);
  },
  onVpnLog: (callback) => {
    const subscription = (event, log) => callback(log);
    ipcRenderer.on('vpn-log', subscription);
    return () => ipcRenderer.removeListener('vpn-log', subscription);
  }
});
