/**
 * preload.js (Definitive-Fix Edition)
 *
 * Key Fixes:
 * 1.  [COMPLETE API EXPOSURE]: All backend IPC handlers, including the crucial `get-custom-templates`, `save-custom-templates`, and the new `create-profile`, are now correctly exposed to the frontend through the context bridge. This was a major source of the previous bugs.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    // Event Listeners
    onServerStarted: (callback) => ipcRenderer.on('server-started', (_event, port) => callback(port)),
    
    // Profile Functions
    getProfiles: () => ipcRenderer.invoke('get-profiles'),
    getProfileData: (profileName) => ipcRenderer.invoke('get-profile-data', profileName),
    createProfile: (profileName) => ipcRenderer.invoke('create-profile', profileName), // NEW
    saveProfileData: (profileName, data) => ipcRenderer.invoke('save-profile-data', { profileName, data }),
    deleteProfile: (profileName) => ipcRenderer.invoke('delete-profile', profileName),

    // Template Functions (FIXED)
    getCustomTemplates: () => ipcRenderer.invoke('get-custom-templates'),
    saveCustomTemplates: (templates) => ipcRenderer.invoke('save-custom-templates', templates)
});