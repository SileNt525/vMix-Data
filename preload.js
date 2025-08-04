/**
 * preload.js (最终修复版)
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    // 监听事件
    onServerStarted: (callback) => ipcRenderer.on('server-started', (_event, port) => callback(port)),
    onDataUpdated: (callback) => ipcRenderer.on('data-updated', (_event, data) => callback(data)),
    
    // 调用功能
    getProfiles: () => ipcRenderer.invoke('get-profiles'),
    getProfileData: (profileName) => ipcRenderer.invoke('get-profile-data', profileName),
    saveProfileData: (profileName, data) => ipcRenderer.invoke('save-profile-data', { profileName, data }),
    deleteProfile: (profileName) => ipcRenderer.invoke('delete-profile', profileName),
});