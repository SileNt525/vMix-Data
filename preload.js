/**
 * preload.js
 * 这个脚本在渲染进程加载网页之前运行。
 * 它有权访问 Node.js API 和 DOM API。
 * 主要作用是使用 contextBridge 将主进程中通过 IPC 暴露的功能安全地注入到渲染进程的 window 对象中。
 * 这样可以避免将整个 ipcRenderer 对象暴露给渲染进程，从而提高安全性。
 */
const { contextBridge, ipcRenderer } = require('electron');

// 在 window 对象上暴露一个名为 'api' 的全局变量
contextBridge.exposeInMainWorld('api', {
    // 监听来自主进程的事件
    onServerStarted: (callback) => ipcRenderer.on('server-started', (_event, ...args) => callback(...args)),
    // 调用主进程的功能
    getProfiles: () => ipcRenderer.invoke('get-profiles'),
    getProfileData: (profileName) => ipcRenderer.invoke('get-profile-data', profileName),
    saveProfileData: (profileName, data) => ipcRenderer.invoke('save-profile-data', { profileName, data }),
    deleteProfile: (profileName) => ipcRenderer.invoke('delete-profile', profileName),
});