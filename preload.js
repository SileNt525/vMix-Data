/**
 * preload.js
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    // 监听事件
    onServerStarted: (callback) => ipcRenderer.on('server-started', (_event, ...args) => callback(...args)),
    
    // 调用功能
    getProfiles: () => ipcRenderer.invoke('get-profiles'),
    getProfileData: (profileName) => ipcRenderer.invoke('get-profile-data', profileName),
    deleteProfile: (profileName) => ipcRenderer.invoke('delete-profile', profileName),
    
    // 【新增】创建配置文件的专用API
    createEmptyProfile: (profileName) => ipcRenderer.invoke('create-empty-profile', profileName),

    // 数据项操作 API
    addItem: (profileName, key, value) => ipcRenderer.invoke('add-item', { profileName, key, value }),
    updateItem: (profileName, key, value) => ipcRenderer.invoke('update-item', { profileName, key, value }),
    deleteItem: (profileName, key) => ipcRenderer.invoke('delete-item', { profileName, key }),
});