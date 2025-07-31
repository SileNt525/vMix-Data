/**
 * preload.js
 * 这是一个预加载脚本，它在渲染进程（网页）的 web-contents 加载之前运行。
 * 它的主要作用是作为一座安全的“桥梁”（Context Bridge），
 * 将主进程中经过选择的、安全的功能暴露给渲染进程，而不会污染全局 window 对象。
 */
const { contextBridge, ipcRenderer } = require('electron');

// 使用 contextBridge 暴露一个名为 'electronAPI' 的全局对象给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
    // 获取所有配置文件
    getProfiles: () => ipcRenderer.invoke('get-profiles'),
    // 根据名称获取特定配置文件的数据
    getProfileData: (profileName) => ipcRenderer.invoke('get-profile-data', profileName),
    // 保存数据到指定的配置文件
    saveProfileData: (profileData) => ipcRenderer.invoke('save-profile-data', profileData),
    // 删除指定的配置文件
    deleteProfile: (profileName) => ipcRenderer.invoke('delete-profile'),
    // 监听来自主进程的消息（例如，服务器启动后的端口号）
    onServerStarted: (callback) => ipcRenderer.on('server-started', (event, port) => callback(port))
});
