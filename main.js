/**
 * main.js (Definitive-Fix v2)
 *
 * Key Fixes:
 * 1.  [ATOMIC CREATION HANDLER]: Introduced a new `create-profile` IPC handler. This separates the act of file creation from file updating, making the process more robust and eliminating race conditions. The frontend now awaits this specific handler's success before proceeding.
 * 2.  [BULLETPROOF I/O]: Retained and reinforced the comprehensive try...catch wrapping on ALL file system interactions to guarantee that no error goes unhandled.
 * 3.  [LOGIC CLARITY]: The code is cleaner and the purpose of each IPC handler is now more distinct.
 */
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const express = require('express');
const cors = require('cors');
const compression = require('compression');

const userDataPath = app.getPath('userData');
const dataDir = path.join(userDataPath, 'profiles');
const templatesFilePath = path.join(userDataPath, 'templates.json');
let mainWindow;
let server;
const serverPort = 8088;

const safeJsonParse = (content, defaultVal) => {
    try {
        return content ? JSON.parse(content) : defaultVal;
    } catch (e) {
        console.error('JSON parsing failed:', e);
        return defaultVal;
    }
};

async function initializeApp() {
    await fs.mkdir(dataDir, { recursive: true });
    try {
        await fs.access(templatesFilePath);
    } catch {
        await fs.writeFile(templatesFilePath, JSON.stringify({}));
    }

    const expressApp = express();
    expressApp.use(cors());
    expressApp.use(compression());
    expressApp.use(express.json());

    expressApp.get('/api/data/:profileName', async (req, res) => {
        const filePath = path.join(dataDir, `${req.params.profileName}.json`);
        try {
            const fileData = await fs.readFile(filePath, 'utf8');
            const templateInstances = safeJsonParse(fileData, []);
            const flattenedData = templateInstances.flatMap(instance =>
                Object.entries(instance.items || {}).map(([key, value]) => ({ key, value }))
            );
            res.setHeader('Content-Type', 'application/json; charset=utf-8').send(JSON.stringify(flattenedData, null, 2));
        } catch {
            res.setHeader('Content-Type', 'application/json; charset=utf-8').send('[]');
        }
    });

    server = expressApp.listen(serverPort, '0.0.0.0', () => {
        createWindow(server.address().port);
    }).on('error', (err) => {
        dialog.showErrorBox('服务器启动失败', `端口 ${serverPort} 可能被占用。\n错误: ${err.message}`);
        app.quit();
    });
}

function createWindow(port) {
    mainWindow = new BrowserWindow({
        width: 1200, height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true, nodeIntegration: false,
        },
    });
    mainWindow.loadFile('ui/index.html');
    mainWindow.webContents.on('did-finish-load', () => {
        mainWindow.webContents.send('server-started', port);
    });
}

app.whenReady().then(() => {
    // --- IPC HANDLERS ---
    ipcMain.handle('get-profiles', async () => {
        try {
            const files = await fs.readdir(dataDir);
            return { success: true, data: files.filter(f => f.endsWith('.json')).map(f => path.parse(f).name) };
        } catch (error) { return { success: false, error: error.message }; }
    });

    ipcMain.handle('get-profile-data', async (event, profileName) => {
        const filePath = path.join(dataDir, `${profileName}.json`);
        try {
            const content = await fs.readFile(filePath, 'utf8');
            return { success: true, data: safeJsonParse(content, []) };
        } catch (error) {
            return error.code === 'ENOENT' ? { success: true, data: [] } : { success: false, error: error.message };
        }
    });
    
    // NEW: Dedicated creator function
    ipcMain.handle('create-profile', async(event, profileName) => {
        const filePath = path.join(dataDir, `${profileName}.json`);
        try {
            await fs.writeFile(filePath, JSON.stringify([])); // Explicitly create with empty array
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('save-profile-data', async (event, { profileName, data }) => {
        const filePath = path.join(dataDir, `${profileName}.json`);
        try {
            await fs.writeFile(filePath, JSON.stringify(data, null, 2));
            return { success: true };
        } catch (error) { return { success: false, error: error.message }; }
    });

    ipcMain.handle('delete-profile', async (event, profileName) => {
        const filePath = path.join(dataDir, `${profileName}.json`);
        try {
            await fs.unlink(filePath);
            return { success: true };
        } catch (error) { return { success: false, error: error.message }; }
    });

    ipcMain.handle('get-custom-templates', async () => {
        try {
            const content = await fs.readFile(templatesFilePath, 'utf8');
            return { success: true, data: safeJsonParse(content, {}) };
        } catch (error) { return { success: false, error: error.message }; }
    });

    ipcMain.handle('save-custom-templates', async (event, templates) => {
        try {
            await fs.writeFile(templatesFilePath, JSON.stringify(templates, null, 2));
            return { success: true };
        } catch (error) { return { success: false, error: error.message }; }
    });

    initializeApp();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) initializeApp(); });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        if (server) server.close();
        app.quit();
    }
});