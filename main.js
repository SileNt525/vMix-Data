/**
 * main.js (最终修复版)
 * 职责：
 * 1. 创建和管理窗口。
 * 2. 启动和管理服务器子进程。
 * 3. 作为“中间人”，将前端的请求通过IPC转发给服务器子进程。
 */
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { fork } = require('child_process');
const fs = require('fs');
const crypto = require('crypto');

const userDataPath = app.getPath('userData');
const dataDir = path.join(userDataPath, 'profiles');

if (!fs.existsSync(dataDir)) {
    try {
        fs.mkdirSync(dataDir, { recursive: true });
        console.log('Profiles directory created:', dataDir);
    } catch (error) {
        console.error('Failed to create profiles directory:', error);
    }
}

let mainWindow;
let serverProcess;

// 用于存储IPC请求的回调函数
const ipcCallbacks = new Map();

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 700,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    mainWindow.loadFile('ui/index.html');
    // mainWindow.webContents.openDevTools();
}

function startServer() {
    console.log('Starting backend server process...');
    const serverPath = path.join(__dirname, 'server.js');
    serverProcess = fork(serverPath, [dataDir]);
    console.log('Backend server process forked with PID:', serverProcess.pid);

    serverProcess.on('message', (msg) => {
        console.log('Message from server process:', msg);
        if (msg.status === 'SERVER_STARTED' && mainWindow) {
            mainWindow.webContents.send('server-started', msg.port);
        } else if (msg.status === 'SERVER_START_FAILED') {
            dialog.showErrorBox('服务器启动失败', msg.message || '未知错误');
        } else if (msg.type === 'IPC_RESPONSE') {
            const callback = ipcCallbacks.get(msg.id);
            if (callback) {
                callback(msg.payload);
                ipcCallbacks.delete(msg.id);
            }
        }
    });

    serverProcess.on('exit', (code) => {
        console.log(`Server process exited with code ${code}`);
        if (code !== 0 && !serverProcess.killed) {
            dialog.showErrorBox('服务器错误', '后端服务器已崩溃，请重启应用。');
        }
    });
}

// 辅助函数：向服务器进程发送请求并等待响应
function sendRequestToServer(type, payload) {
    return new Promise((resolve) => {
        if (!serverProcess || serverProcess.killed) {
            return resolve({ success: false, error: '后台服务未运行。' });
        }
        const id = crypto.randomUUID();
        ipcCallbacks.set(id, resolve);
        serverProcess.send({ type, id, payload });
    });
}

app.whenReady().then(() => {
    // --- IPC 处理器 ---
    ipcMain.handle('get-profiles', () => sendRequestToServer('GET_PROFILES'));
    ipcMain.handle('get-profile-data', (event, profileName) => sendRequestToServer('GET_PROFILE_DATA', { profileName }));
    ipcMain.handle('create-profile', (event, profileName) => sendRequestToServer('CREATE_PROFILE', { profileName }));
    ipcMain.handle('delete-profile', (event, profileName) => sendRequestToServer('DELETE_PROFILE', { profileName }));
    ipcMain.handle('add-item', (event, payload) => sendRequestToServer('ADD_ITEM', payload));
    ipcMain.handle('update-item', (event, payload) => sendRequestToServer('UPDATE_ITEM', payload));
    ipcMain.handle('delete-item', (event, payload) => sendRequestToServer('DELETE_ITEM', payload));

    createWindow();
    startServer();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        if (serverProcess) serverProcess.kill();
        app.quit();
    }
});