/**
 * preload.js (最终修复版)
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    // 监听事件
    onServerStarted: (callback) => ipcRenderer.on('server-started', (_event, port) => callback(port)),
    
    // 调用功能
    getProfiles: () => ipcRenderer.invoke('get-profiles'),
    getProfileData: (profileName) => ipcRenderer.invoke('get-profile-data', profileName),
    createProfile: (profileName) => ipcRenderer.invoke('create-profile', profileName),
    deleteProfile: (profileName) => ipcRenderer.invoke('delete-profile', profileName),
    addItem: (profileName, key, value) => ipcRenderer.invoke('add-item', { profileName, key, value }),
    updateItem: (profileName, key, value) => ipcRenderer.invoke('update-item', { profileName, key, value }),
    deleteItem: (profileName, key) => ipcRenderer.invoke('delete-item', { profileName, key }),
});