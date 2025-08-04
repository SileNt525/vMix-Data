/**
 * server.js
 * 这是一个独立的 Node.js 进程，运行一个 Express 服务器。
 * 它的职责是：
 * 1. 提供一个 HTTP GET 端点，供 vMix 轮询以获取最新的 JSON 数据。
 * 2. 接收来自主进程的消息，以原子方式将数据写入文件系统，确保数据安全。
 * 3. 提供数据项的增删改查API端点
 */
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const path = require('path');
const fs = require('fs');
const { WebSocketServer, WebSocket } = require('ws');

// --- 变量定义 ---
let writeFile;
let XMLBuilder;
let xmlBuilder;

const log = (level, message) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}`);
};

const dataDir = process.argv[2];
if (!dataDir) {
    log('error', 'Data directory not provided. Server is exiting.');
    process.exit(1);
}

const app = express();
const wss = new WebSocketServer({ noServer: true });
const dataCache = new Map();
const cacheExpiry = 5 * 60 * 1000;

const createXmlBuilder = () => {
    if (XMLBuilder) {
        xmlBuilder = new XMLBuilder({
            rootName: 'data',
            renderOpts: { pretty: true, indent: '  ', newline: '\n' },
            xmldec: { version: '1.0', encoding: 'UTF-8' }
        });
    }
};

const convertToXML = (data) => {
    if (!xmlBuilder) throw new Error('XML builder is not available');
    const dataToConvert = Array.isArray(data) && data.length === 1 ? data[0] : data;
    return xmlBuilder.buildObject(dataToConvert);
};

const convertToPlainText = (data) => {
    const dataToConvert = Array.isArray(data) && data.length === 1 ? data[0] : data;
    if (typeof dataToConvert === 'object' && dataToConvert !== null) {
        return Object.entries(dataToConvert).map(([key, value]) => `${key}: ${value}`).join('\n');
    }
    return String(dataToConvert);
};

const formatData = (data, format) => {
    switch (format.toLowerCase()) {
        case 'xml': return convertToXML(data);
        case 'text': case 'plain': case 'plaintext': return convertToPlainText(data);
        default: return JSON.stringify(data, null, 2);
    }
};

const getContentType = (format) => {
    switch (format.toLowerCase()) {
        case 'xml': return 'application/xml; charset=utf-8';
        case 'text': case 'plain': case 'plaintext': return 'text/plain; charset=utf-8';
        default: return 'application/json; charset=utf-8';
    }
};

const API_KEY = process.env.VMIX_API_KEY || 'vmix-default-api-key';
app.use(compression());
app.use(cors());
app.use(express.json());

const accessControl = (req, res, next) => {
    const clientIP = req.ip || req.connection.remoteAddress;
    const isLocal = clientIP === '127.0.0.1' || clientIP === '::1' || clientIP === '::ffff:127.0.0.1';
    
    if (!isLocal) {
        const apiKey = req.headers['x-api-key'] || req.query.api_key;
        if (!apiKey || apiKey !== API_KEY) {
            return res.status(403).json({ error: 'Forbidden: Invalid API key' });
        }
    }
    next();
};

app.get('/api/data/:profileName', accessControl, (req, res) => {
    const { profileName } = req.params;
    const { format = 'json' } = req.query;
    const filePath = path.join(dataDir, `${profileName}.json`);

    fs.readFile(filePath, 'utf8', (err, fileData) => {
        if (err) {
            const emptyData = formatData([{}], format);
            return res.setHeader('Content-Type', getContentType(format)).send(emptyData);
        }
        try {
            const parsedData = JSON.parse(fileData);
            const formattedData = formatData(parsedData, format);
            res.setHeader('Content-Type', getContentType(format)).send(formattedData);
        } catch (parseError) {
            res.status(500).json({ error: 'Invalid JSON format in profile data' });
        }
    });
});

app.get('/api/items/:profileName', accessControl, (req, res) => {
    const { profileName } = req.params;
    const filePath = path.join(dataDir, `${profileName}.json`);
    fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) {
             // 【已修正】如果文件不存在，返回200和空对象，而不是404
            if (err.code === 'ENOENT') return res.json({ items: {} });
            return res.status(500).json({ error: 'Failed to read profile data' });
        }
        try {
            const parsedData = JSON.parse(data);
            const items = Array.isArray(parsedData) && parsedData.length > 0 ? parsedData[0] : {};
            res.json({ items });
        } catch (parseError) {
            res.status(500).json({ error: 'Invalid JSON format in profile data' });
        }
    });
});

const readProfileForUpdate = (filePath, callback) => {
    fs.readFile(filePath, 'utf8', (err, data) => {
        if (err && err.code !== 'ENOENT') {
            return callback(err, null);
        }
        let items = {};
        if (!err) {
            try {
                const parsedData = JSON.parse(data);
                items = Array.isArray(parsedData) && parsedData.length > 0 ? parsedData[0] : {};
            } catch (e) {
                return callback(e, null);
            }
        }
        callback(null, items);
    });
};

const saveProfileData = (filePath, items, callback) => {
    if (!writeFile) return callback(new Error("File system module not ready."));
    writeFile(filePath, JSON.stringify([items], null, 2))
        .then(() => callback(null))
        .catch(callback);
};

app.post('/api/items/:profileName', accessControl, (req, res) => {
    const { profileName } = req.params;
    const { key, value } = req.body;
    if (!key || typeof value === 'undefined') return res.status(400).json({ error: 'Key and value are required' });
    
    const filePath = path.join(dataDir, `${profileName}.json`);
    readProfileForUpdate(filePath, (err, items) => {
        if (err) return res.status(500).json({ error: 'Failed to read profile' });
        if (items.hasOwnProperty(key)) return res.status(409).json({ error: 'Key already exists' });
        
        items[key] = value;
        saveProfileData(filePath, items, (saveErr) => {
            if (saveErr) return res.status(500).json({ error: 'Failed to save profile' });
            res.status(201).json({ message: 'Item added successfully', items });
        });
    });
});

app.put('/api/items/:profileName/:key', accessControl, (req, res) => {
    const { profileName, key } = req.params;
    const { value } = req.body;
    if (typeof value === 'undefined') return res.status(400).json({ error: 'Value is required' });

    const filePath = path.join(dataDir, `${profileName}.json`);
    readProfileForUpdate(filePath, (err, items) => {
        if (err) return res.status(500).json({ error: 'Failed to read profile' });
        if (!items.hasOwnProperty(key)) return res.status(404).json({ error: 'Key not found' });

        items[key] = value;
        saveProfileData(filePath, items, (saveErr) => {
            if (saveErr) return res.status(500).json({ error: 'Failed to save profile' });
            res.json({ message: 'Item updated successfully', items });
        });
    });
});

app.delete('/api/items/:profileName/:key', accessControl, (req, res) => {
    const { profileName, key } = req.params;
    const filePath = path.join(dataDir, `${profileName}.json`);
    readProfileForUpdate(filePath, (err, items) => {
        if (err) return res.status(500).json({ error: 'Failed to read profile' });
        if (!items.hasOwnProperty(key)) return res.status(404).json({ error: 'Key not found' });

        delete items[key];
        saveProfileData(filePath, items, (saveErr) => {
            if (saveErr) return res.status(500).json({ error: 'Failed to save profile' });
            res.json({ message: 'Item deleted successfully', items });
        });
    });
});

const profileStates = new Map();
const notifyDataUpdate = (filePath, items) => {
    const profileName = path.basename(filePath, '.json');
    const previousState = profileStates.get(profileName) || {};
    const changes = {};
    let hasChanges = false;

    Object.keys({ ...previousState, ...items }).forEach(key => {
        if (previousState[key] !== items[key]) {
            changes[key] = items.hasOwnProperty(key) ? items[key] : null;
            hasChanges = true;
        }
    });

    profileStates.set(profileName, { ...items });

    if (hasChanges) {
        const message = JSON.stringify({ type: 'dataUpdate', profileName, changes });
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) client.send(message);
        });
        log('debug', `Broadcasted data update for profile ${profileName}`);
    }
};

process.on('message', async (msg) => {
    if (msg.type === 'WRITE_DATA') {
        const { filePath, data } = msg;
        try {
            await writeFile(filePath, JSON.stringify(data, null, 2));
            notifyDataUpdate(filePath, data[0] || {});
            if (process.send) process.send({ type: 'WRITE_DATA_SUCCESS', filePath });
        } catch (error) {
            if (process.send) process.send({ type: 'WRITE_DATA_ERROR', filePath, message: error.message });
        }
    } else if (msg.type === 'DELETE_FILE') {
        fs.unlink(msg.filePath, (err) => {
            if (err && err.code !== 'ENOENT') {
                if (process.send) process.send({ type: 'DELETE_FILE_ERROR', filePath: msg.filePath, message: err.message });
            }
        });
    }
});

const startServerProcess = async () => {
    try {
        const atomicallyModule = await import('atomically');
        writeFile = atomicallyModule.writeFile;
        const xml2jsModule = await import('xml2js');
        XMLBuilder = xml2jsModule.Builder;
        createXmlBuilder();
    } catch (error) {
        if (process.send) process.send({ status: 'SERVER_START_FAILED', message: `Failed to import modules: ${error.message}` });
        process.exit(1);
    }

    const server = app.listen(8088, '0.0.0.0', () => {
        if (process.send) process.send({ status: 'SERVER_STARTED', port: 8088 });
        log('info', `vMix Data Server listening at http://0.0.0.0:8088`);
    }).on('error', (error) => {
        if (process.send) process.send({ status: 'SERVER_START_FAILED', message: `Server error: ${error.message}` });
    });

    server.on('upgrade', (request, socket, head) => {
        wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
    });
};

wss.on('connection', (ws) => {
    log('info', 'New WebSocket client connected');
    ws.on('message', (message) => {
        if (JSON.parse(message).type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
    });
    ws.on('close', () => log('info', 'WebSocket client disconnected'));
    ws.on('error', (error) => log('error', `WebSocket error: ${error.message}`));
});
startServerProcess();