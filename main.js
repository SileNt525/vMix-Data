/**
 * main.js
 * 这是 Electron 的主进程文件。
 * 它的职责是：
 * 1. 创建和管理应用的窗口。
 * 2. 启动和管理后端的 Express 服务器子进程。
 * 3. 处理前端通过 IPC (进程间通信) 发送过来的所有请求。
 */
const { app, BrowserWindow, ipcMain, dialog, net } = require('electron');
const path = require('path');
const { fork } = require('child_process');
const fs = require('fs');

const userDataPath = app.getPath('userData');
const dataDir = path.join(userDataPath, 'profiles');

if (!fs.existsSync(dataDir)) {
    try {
        fs.mkdirSync(dataDir, { recursive: true });
    } catch (error) {
        console.error('Failed to create profiles directory:', error);
    }
}

let mainWindow;
let serverProcess;
let serverPort = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 700, // 稍微增加高度以适应内容
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
    console.log('Starting backend server process');
    const serverPath = path.join(__dirname, 'server.js');
    serverProcess = fork(serverPath, [dataDir]);
    console.log('Backend server process started with PID:', serverProcess.pid);

    serverProcess.on('message', (msg) => {
        console.log('Message from server:', msg);
        if (msg.status === 'SERVER_STARTED' && mainWindow) {
            serverPort = msg.port;
            console.log(`Server started successfully on port ${serverPort}`);
            mainWindow.webContents.send('server-started', serverPort);
        } else if (msg.status === 'SERVER_START_FAILED' && mainWindow) {
            let errorMessage = `服务器启动失败: ${msg.message || '未知错误'}`;
            dialog.showErrorBox('服务器启动失败', errorMessage);
        }
    });

    serverProcess.on('exit', (code) => {
        console.log(`Server process exited with code ${code}`);
        if (code !== 0 && !serverProcess.killed) {
            dialog.showErrorBox('服务器错误', '后端服务器已崩溃，请重启应用。');
        }
    });
}

const performApiRequest = (method, apiPath, body = null) => {
    return new Promise((resolve) => {
        if (!serverPort) {
            return resolve({ success: false, error: '服务器尚未就绪' });
        }
        const url = new URL(apiPath, `http://127.0.0.1:${serverPort}`);
        const request = net.request({ method: method, url: url.toString() });

        request.on('response', (response) => {
            let responseBody = '';
            response.on('data', (chunk) => { responseBody += chunk.toString(); });
            response.on('end', () => {
                try {
                    resolve({ success: response.statusCode < 400, data: JSON.parse(responseBody), statusCode: response.statusCode });
                } catch (e) {
                    resolve({ success: false, error: '无效的服务器响应' });
                }
            });
        });
        request.on('error', (error) => resolve({ success: false, error: error.message }));

        if (body) {
            const jsonBody = JSON.stringify(body);
            request.setHeader('Content-Type', 'application/json');
            request.write(jsonBody);
        }
        request.end();
    });
};

app.whenReady().then(() => {
    ipcMain.handle('get-profiles', async () => {
        const files = await fs.promises.readdir(dataDir);
        return files.filter(file => file.endsWith('.json')).map(file => path.parse(file).name);
    });

    ipcMain.handle('get-profile-data', (event, profileName) => performApiRequest('GET', `/api/items/${profileName}`));
    
    // 【已修正】新增一个IPC调用来创建真实的空配置文件
    ipcMain.handle('create-empty-profile', async (event, profileName) => {
        if (!profileName || !/^[a-zA-Z0-9_-]+$/.test(profileName)) {
            return { success: false, error: '无效的配置文件名。只允许字母、数字、下划线和连字符。' };
        }
        const filePath = path.join(dataDir, `${profileName}.json`);
        try {
            // 使用'wx'标志确保文件不存在时才创建，避免覆盖
            await fs.promises.writeFile(filePath, JSON.stringify([{}], null, 2), { flag: 'wx' });
            return { success: true };
        } catch (error) {
            if (error.code === 'EEXIST') {
                return { success: false, error: '该配置文件已存在。' };
            }
            console.error('Failed to create empty profile file:', error);
            return { success: false, error: '创建文件时出错，请检查后台日志。' };
        }
    });

    ipcMain.handle('delete-profile', (event, profileName) => {
        if (!profileName) return { success: false, error: '无效的配置文件名' };
        // 直接删除文件，服务器会通过文件系统变化自行处理
        const filePath = path.join(dataDir, `${profileName}.json`);
        try {
            fs.unlinkSync(filePath);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('add-item', (event, { profileName, key, value }) => performApiRequest('POST', `/api/items/${profileName}`, { key, value }));
    ipcMain.handle('update-item', (event, { profileName, key, value }) => performApiRequest('PUT', `/api/items/${profileName}/${key}`, { value }));
    ipcMain.handle('delete-item', (event, { profileName, key }) => performApiRequest('DELETE', `/api/items/${profileName}/${key}`));

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