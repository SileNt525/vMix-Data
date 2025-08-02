/**
 * server.js
 * 这是一个独立的 Node.js 进程，运行一个 Express 服务器。
 * 它的职责是：
 * 1. 提供一个 HTTP GET 端点，供 vMix 轮询以获取最新的 JSON 数据。
 * 2. 接收来自主进程的消息，以原子方式将数据写入文件系统，确保数据安全。
 * 3. 提供数据项的增删改查API端点
 */

// 添加日志记录函数
const log = (level, message) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}`);
};

log('info', 'Server script started');
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const path = require('path');
const fs = require('fs');
// atomically是一个ES模块，需要动态导入
let writeFile;
import('atomically').then((module) => {
    writeFile = module.writeFile;
}).catch((error) => {
    console.error('Failed to import atomically module:', error);
});
const { WebSocketServer, WebSocket } = require('ws');
// xml2js是一个ES模块，需要动态导入
let XMLBuilder;

const app = express();
const PORT = 8088; // 定义服务器端口

// 创建 WebSocket 服务器
const wss = new WebSocketServer({ noServer: true });

// 【已修正】从主进程启动时传递的命令行参数中获取数据目录
// process.argv 是一个数组，[0]是node程序路径, [1]是本脚本路径, [2]是第一个参数
const dataDir = process.argv[2]; 
if (!dataDir) {
    console.error('Data directory not provided. Server is exiting.');
    process.exit(1); // 如果没有提供目录，则退出并返回一个错误码
}

// 创建缓存对象
const dataCache = new Map();
const cacheExpiry = 5 * 60 * 1000; // 缓存过期时间5分钟

// 创建XML构建器实例的函数
let xmlBuilder;
const createXmlBuilder = () => {
    if (XMLBuilder) {
        xmlBuilder = new XMLBuilder({
            rootName: 'data',
            renderOpts: {
                pretty: true,
                indent: '  ',
                newline: '\n'
            },
            xmldec: {
                version: '1.0',
                encoding: 'UTF-8'
            }
        });
    } else {
        console.error('XMLBuilder is not available');
    }
};

// 在XMLBuilder模块加载完成后创建xmlBuilder实例
import('xml2js').then((module) => {
    XMLBuilder = module.Builder;
    createXmlBuilder();
}).catch((error) => {
    console.error('Failed to import xml2js module:', error);
});

// 数据格式转换函数
const convertToXML = (data) => {
    try {
        // 检查xmlBuilder是否已经创建
        if (!xmlBuilder) {
            throw new Error('XML builder is not available');
        }
        
        // 如果数据是数组且只有一个元素，提取该元素
        const dataToConvert = Array.isArray(data) && data.length === 1 ? data[0] : data;
        return xmlBuilder.buildObject(dataToConvert);
    } catch (error) {
        log('error', `Failed to convert data to XML: ${error.message}`);
        throw error;
    }
};

// 数据格式转换函数
const convertToPlainText = (data) => {
    try {
        // 如果数据是数组且只有一个元素，提取该元素
        const dataToConvert = Array.isArray(data) && data.length === 1 ? data[0] : data;
        
        // 如果是对象，将其转换为键值对格式的文本
        if (typeof dataToConvert === 'object' && dataToConvert !== null) {
            if (Array.isArray(dataToConvert)) {
                // 如果是数组，将每个元素转换为字符串并用换行符分隔
                return dataToConvert.map(item =>
                    typeof item === 'object' && item !== null ?
                    Object.entries(item).map(([key, value]) => `${key}: ${value}`).join('\n') :
                    String(item)
                ).join('\n---\n');
            } else {
                // 如果是对象，将其转换为键值对格式
                return Object.entries(dataToConvert)
                    .map(([key, value]) => `${key}: ${value}`)
                    .join('\n');
            }
        }
        
        // 其他情况直接转换为字符串
        return String(dataToConvert);
    } catch (error) {
        log('error', `Failed to convert data to plain text: ${error.message}`);
        throw error;
    }
};

// 数据过滤函数
const filterData = (data, filters) => {
    if (!filters || Object.keys(filters).length === 0) {
        return data;
    }
    
    try {
        // 如果数据是数组且只有一个元素，提取该元素
        const dataToFilter = Array.isArray(data) && data.length === 1 ? data[0] : data;
        
        // 如果是对象，应用过滤器
        if (typeof dataToFilter === 'object' && dataToFilter !== null && !Array.isArray(dataToFilter)) {
            const filteredData = {};
            for (const [key, value] of Object.entries(dataToFilter)) {
                // 检查是否应该包含此键
                let include = true;
                if (filters.include) {
                    include = filters.include.split(',').includes(key);
                }
                if (filters.exclude) {
                    include = include && !filters.exclude.split(',').includes(key);
                }
                if (include) {
                    filteredData[key] = value;
                }
            }
            // 如果数据原本是数组形式，需要包装回去
            return Array.isArray(data) && data.length === 1 ? [filteredData] : filteredData;
        }
        
        // 其他情况返回原始数据
        return data;
    } catch (error) {
        log('error', `Failed to filter data: ${error.message}`);
        return data;
    }
};

// 数据验证函数
const validateData = (data) => {
    // 检查数据是否为对象或数组
    if (typeof data !== 'object' || data === null) {
        return { isValid: false, error: 'Data must be an object or array' };
    }
    
    // 如果是数组，检查每个元素
    if (Array.isArray(data)) {
        for (let i = 0; i < data.length; i++) {
            const item = data[i];
            if (typeof item !== 'object' || item === null) {
                return { isValid: false, error: `Array item at index ${i} must be an object` };
            }
            
            // 检查对象属性
            for (const [key, value] of Object.entries(item)) {
                if (typeof key !== 'string') {
                    return { isValid: false, error: `Object key must be a string` };
                }
                
                // 检查值的类型
                if (value !== null && typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
                    return { isValid: false, error: `Object value for key '${key}' must be a string, number, boolean, or null` };
                }
            }
        }
    } else {
        // 如果是对象，检查属性
        for (const [key, value] of Object.entries(data)) {
            if (typeof key !== 'string') {
                return { isValid: false, error: `Object key must be a string` };
            }
            
            // 检查值的类型
            if (value !== null && typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
                return { isValid: false, error: `Object value for key '${key}' must be a string, number, boolean, or null` };
            }
        }
    }
    
    return { isValid: true };
};

// 数据格式化函数
const formatData = (data, format) => {
    // 首先验证数据
    const validation = validateData(data);
    if (!validation.isValid) {
        throw new Error(`Data validation failed: ${validation.error}`);
    }
    
    switch (format.toLowerCase()) {
        case 'xml':
            return convertToXML(data);
        case 'text':
        case 'plain':
        case 'plaintext':
            return convertToPlainText(data);
        case 'json':
        default:
            return typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    }
};

// 获取内容类型函数
const getContentType = (format) => {
    switch (format.toLowerCase()) {
        case 'xml':
            return 'application/xml; charset=utf-8';
        case 'text':
        case 'plain':
        case 'plaintext':
            return 'text/plain; charset=utf-8';
        case 'json':
        default:
            return 'application/json; charset=utf-8';
    }
};


// 生成一个简单的API密钥（在实际应用中，应该使用更安全的方法生成和存储密钥）
const API_KEY = process.env.VMIX_API_KEY || 'vmix-default-api-key';

app.use(compression()); // 启用响应压缩
app.use(cors()); // 允许跨域请求
app.use(express.json()); // 解析 JSON 请求体

// --- 中间件 ---
// 记录请求日志
app.use((req, res, next) => {
    log('info', `${req.method} ${req.path}`);
    next();
});

// 访问控制中间件
const accessControl = (req, res, next) => {
    // 检查是否来自本地访问
    const clientIP = req.connection.remoteAddress || req.socket.remoteAddress;
    const isLocal = clientIP === '127.0.0.1' || clientIP === '::1' || clientIP === '::ffff:127.0.0.1';
    
    // 如果不是本地访问，检查API密钥
    if (!isLocal) {
        const apiKey = req.headers['x-api-key'] || req.query.api_key;
        if (!apiKey || apiKey !== API_KEY) {
            log('warn', `Unauthorized access attempt from ${clientIP}`);
            return res.status(403).json({ error: 'Forbidden: Invalid API key' });
        }
    }
    
    next();
};

// --- API 端点 ---
// 这是 vMix 将要轮询的端点
app.get('/api/data/:profileName', accessControl, (req, res) => {
    const { profileName } = req.params;
    const { format = 'json', include, exclude } = req.query; // 支持格式和过滤参数
    const filePath = path.join(dataDir, `${profileName}.json`);

    // 检查缓存（包含格式）
    const cacheKey = `${filePath}_${format}_${include || ''}_${exclude || ''}`;
    const cached = dataCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < cacheExpiry) {
        log('debug', `Cache hit for ${cacheKey}`);
        // 设置适当的缓存头
        res.setHeader('Cache-Control', 'public, max-age=60');
        res.setHeader('ETag', `"${cached.timestamp}"`);
        res.setHeader('Content-Type', getContentType(format));
        return res.send(cached.data);
    }

    fs.readFile(filePath, 'utf8', (err, fileData) => {
        if (err) {
            // 如果文件不存在，返回 404
            if (err.code === 'ENOENT') {
                // 返回一个空的有效JSON数组，防止vMix出错
                log('debug', `Profile ${profileName} not found`);
                const emptyData = [];
                const formattedData = formatData(emptyData, format);
                // 设置适当的缓存头
                res.setHeader('Cache-Control', 'public, max-age=60');
                res.setHeader('Content-Type', getContentType(format));
                return res.send(formattedData);
            }
            // 其他错误返回 500
            log('error', `Failed to read profile data: ${err.message}`);
            return res.status(500).json({ error: 'Failed to read profile data' });
        }
        
        try {
            const parsedData = JSON.parse(fileData);
            // 应用过滤器
            const filteredData = filterData(parsedData, { include, exclude });
            // 格式化数据
            const formattedData = formatData(filteredData, format);
            
            // 成功读取文件，缓存并返回其内容
            log('debug', `Read profile ${profileName} from file`);
            dataCache.set(cacheKey, { data: formattedData, timestamp: Date.now() });
            
            // 设置适当的缓存头
            res.setHeader('Cache-Control', 'public, max-age=60');
            res.setHeader('ETag', `"${Date.now()}"`);
            res.setHeader('Content-Type', getContentType(format));
            res.send(formattedData);
        } catch (parseError) {
            log('error', `Failed to parse profile data: ${parseError.message}`);
            res.status(500).json({ error: 'Failed to parse profile data' });
        }
    });
});

// 获取指定配置文件的数据项列表
app.get('/api/items/:profileName', accessControl, (req, res) => {
    const { profileName } = req.params;
    const filePath = path.join(dataDir, `${profileName}.json`);

    // 验证配置文件名
    if (!/^[a-zA-Z0-9_-]+$/.test(profileName)) {
        log('warn', `Invalid profile name: ${profileName}`);
        return res.status(400).json({ error: 'Invalid profile name' });
    }

    fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) {
            if (err.code === 'ENOENT') {
                log('debug', `Profile ${profileName} not found`);
                return res.status(404).json({ items: {} });
            }
            log('error', `Failed to read profile data: ${err.message}`);
            return res.status(500).json({ error: 'Failed to read profile data' });
        }

        try {
            const parsedData = JSON.parse(data);
            // vMix 需要的是一个对象数组，我们这里返回数组中的第一个对象给UI编辑
            const items = Array.isArray(parsedData) && parsedData.length > 0 ? parsedData[0] : {};
            log('debug', `Retrieved items for profile ${profileName}`);
            res.json({ items });
        } catch (parseError) {
            log('error', `Failed to parse profile data: ${parseError.message}`);
            res.status(500).json({ error: 'Failed to parse profile data' });
        }
    });
});

// 添加数据项
app.post('/api/items/:profileName', accessControl, (req, res) => {
    const { profileName } = req.params;
    const { key, value } = req.body;

    // 验证输入
    if (!key || typeof key !== 'string' || !value) {
        log('warn', 'Invalid key or value provided');
        return res.status(400).json({ error: 'Key and value are required' });
    }

    // 验证配置文件名
    if (!/^[a-zA-Z0-9_-]+$/.test(profileName)) {
        log('warn', `Invalid profile name: ${profileName}`);
        return res.status(400).json({ error: 'Invalid profile name' });
    }

    const filePath = path.join(dataDir, `${profileName}.json`);

    // 读取现有数据
    fs.readFile(filePath, 'utf8', (err, data) => {
        let items = {};
        
        if (err && err.code !== 'ENOENT') {
            log('error', `Failed to read profile data: ${err.message}`);
            return res.status(500).json({ error: 'Failed to read profile data' });
        }

        if (!err) {
            try {
                const parsedData = JSON.parse(data);
                items = Array.isArray(parsedData) && parsedData.length > 0 ? parsedData[0] : {};
            } catch (parseError) {
                log('error', `Failed to parse profile data: ${parseError.message}`);
                return res.status(500).json({ error: 'Failed to parse profile data' });
            }
        }

        // 检查键是否已存在
        if (items.hasOwnProperty(key)) {
            log('warn', `Key ${key} already exists in profile ${profileName}`);
            return res.status(409).json({ error: 'Key already exists' });
        }

        // 添加新数据项
        items[key] = value;

        // 保存数据
        saveProfileData(filePath, items, (saveErr) => {
            if (saveErr) {
                log('error', `Failed to save profile data: ${saveErr.message}`);
                return res.status(500).json({ error: 'Failed to save profile data' });
            }
            
            log('info', `Added item ${key} to profile ${profileName}`);
            res.status(201).json({ message: 'Item added successfully', items });
        });
    });
});

// 更新数据项
app.put('/api/items/:profileName/:key', accessControl, (req, res) => {
    const { profileName, key } = req.params;
    const { value } = req.body;

    // 验证输入
    if (value === undefined) {
        log('warn', 'Value is required');
        return res.status(400).json({ error: 'Value is required' });
    }

    // 验证配置文件名
    if (!/^[a-zA-Z0-9_-]+$/.test(profileName)) {
        log('warn', `Invalid profile name: ${profileName}`);
        return res.status(400).json({ error: 'Invalid profile name' });
    }

    const filePath = path.join(dataDir, `${profileName}.json`);

    // 读取现有数据
    fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) {
            if (err.code === 'ENOENT') {
                log('debug', `Profile ${profileName} not found`);
                return res.status(404).json({ error: 'Profile not found' });
            }
            log('error', `Failed to read profile data: ${err.message}`);
            return res.status(500).json({ error: 'Failed to read profile data' });
        }

        try {
            const parsedData = JSON.parse(data);
            const items = Array.isArray(parsedData) && parsedData.length > 0 ? parsedData[0] : {};
            
            // 检查键是否存在
            if (!items.hasOwnProperty(key)) {
                log('warn', `Key ${key} not found in profile ${profileName}`);
                return res.status(404).json({ error: 'Key not found' });
            }
            
            // 更新数据项
            items[key] = value;
            
            // 保存数据
            saveProfileData(filePath, items, (saveErr) => {
                if (saveErr) {
                    log('error', `Failed to save profile data: ${saveErr.message}`);
                    return res.status(500).json({ error: 'Failed to save profile data' });
                }
                
                log('info', `Updated item ${key} in profile ${profileName}`);
                res.json({ message: 'Item updated successfully', items });
            });
        } catch (parseError) {
            log('error', `Failed to parse profile data: ${parseError.message}`);
            res.status(500).json({ error: 'Failed to parse profile data' });
        }
    });
});

// 删除数据项
app.delete('/api/items/:profileName/:key', accessControl, (req, res) => {
    const { profileName, key } = req.params;

    // 验证配置文件名
    if (!/^[a-zA-Z0-9_-]+$/.test(profileName)) {
        log('warn', `Invalid profile name: ${profileName}`);
        return res.status(400).json({ error: 'Invalid profile name' });
    }

    const filePath = path.join(dataDir, `${profileName}.json`);

    // 读取现有数据
    fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) {
            if (err.code === 'ENOENT') {
                log('debug', `Profile ${profileName} not found`);
                return res.status(404).json({ error: 'Profile not found' });
            }
            log('error', `Failed to read profile data: ${err.message}`);
            return res.status(500).json({ error: 'Failed to read profile data' });
        }

        try {
            const parsedData = JSON.parse(data);
            const items = Array.isArray(parsedData) && parsedData.length > 0 ? parsedData[0] : {};
            
            // 检查键是否存在
            if (!items.hasOwnProperty(key)) {
                log('warn', `Key ${key} not found in profile ${profileName}`);
                return res.status(404).json({ error: 'Key not found' });
            }
            
            // 删除数据项
            delete items[key];
            
            // 保存数据
            saveProfileData(filePath, items, (saveErr) => {
                if (saveErr) {
                    log('error', `Failed to save profile data: ${saveErr.message}`);
                    return res.status(500).json({ error: 'Failed to save profile data' });
                }
                
                log('info', `Deleted item ${key} from profile ${profileName}`);
                res.json({ message: 'Item deleted successfully', items });
            });
        } catch (parseError) {
            log('error', `Failed to parse profile data: ${parseError.message}`);
            res.status(500).json({ error: 'Failed to parse profile data' });
        }
    });
});

// --- 辅助函数 ---
// 保存配置文件数据的辅助函数
let saveProfileData = (filePath, items, callback) => {
    // 清除缓存
    dataCache.delete(filePath);
    
    // 将数据写入任务发送给主进程处理，由它来完成原子化写入
    // vMix 需要的是一个对象数组，所以我们在这里将对象包装在数组中
    if (process.send) {
        process.send({ type: 'WRITE_DATA', filePath, data: [items] });
        callback(null);
    } else {
        // 如果没有主进程连接，直接写入文件
        writeFile(filePath, JSON.stringify([items], null, 2))
            .then(() => callback(null))
            .catch(callback);
    }
};

// --- 进程消息监听器 ---
// 监听来自主进程的消息，执行文件写入操作
process.on('message', async (msg) => {
    if (msg.type === 'WRITE_DATA') {
        const { filePath, data } = msg;
        try {
            // 使用 atomically.writeFile 来安全地写入文件
            // 它会先写入一个临时文件，成功后再重命名，防止vMix读到不完整的数据
            await writeFile(filePath, JSON.stringify(data, null, 2));
            // 清除缓存
            dataCache.delete(filePath);
            log('debug', `Data written to ${filePath}`);
        } catch (error) {
            log('error', `Atomic write failed: ${error.message}`);
        }
    } else if (msg.type === 'DELETE_FILE') {
        // 接收主进程的删除文件指令
        fs.unlink(msg.filePath, (err) => {
            // 如果文件不存在 (ENOENT)，则忽略错误，否则打印错误
            if (err && err.code !== 'ENOENT') {
                log('error', `Failed to delete file: ${err.message}`);
            } else {
                // 清除缓存
                dataCache.delete(msg.filePath);
                log('debug', `Deleted file: ${msg.filePath}`);
            }
        });
    }
});

// 升级 HTTP 服务器为 WebSocket 服务器
log('info', `Attempting to start server on port ${PORT}`);
const server = app.listen(PORT, '127.0.0.1', () => {
    // 通知主进程服务器已成功启动，并传递端口号
    if (process.send) {
        process.send({ status: 'SERVER_STARTED', port: PORT });
    }
    log('info', `vMix Data Server listening at http://127.0.0.1:${PORT}`);
}).on('error', (error) => {
    log('error', `Failed to start server: ${error.message}`);
});

server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
});

// 管理 WebSocket 客户端连接
wss.on('connection', (ws, request) => {
    log('info', 'New WebSocket client connected');
    
    // 发送欢迎消息
    ws.send(JSON.stringify({ type: 'welcome', message: 'Connected to vMix Data Server' }));
    
    // 处理客户端消息
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'ping') {
                // 回复心跳响应
                ws.send(JSON.stringify({ type: 'pong' }));
                log('debug', 'Received ping from client, sent pong response');
            }
        } catch (error) {
            log('error', `Error parsing WebSocket message: ${error.message}`);
        }
    });
    
    // 处理客户端断开连接
    ws.on('close', () => {
        log('info', 'WebSocket client disconnected');
    });
    
    // 处理错误
    ws.on('error', (error) => {
        log('error', `WebSocket error: ${error.message}`);
    });
});

// 存储每个配置文件的先前状态，用于计算变化
const profileStates = new Map();

// 修改 saveProfileData 函数以通知客户端数据更新
const originalSaveProfileData = saveProfileData;
saveProfileData = (filePath, items, callback) => {
    // 调用原始函数保存数据
    originalSaveProfileData(filePath, items, (err) => {
        if (err) {
            callback(err);
            return;
        }
        
        // 数据保存成功后，通知所有连接的客户端
        const profileName = path.basename(filePath, '.json');
        const previousState = profileStates.get(profileName) || {};
        
        // 计算变化的数据
        const changes = {};
        let hasChanges = false;
        
        // 检查新的或更新的项
        for (const [key, value] of Object.entries(items)) {
            if (previousState[key] !== value) {
                changes[key] = value;
                hasChanges = true;
            }
        }
        
        // 检查删除的项
        for (const key of Object.keys(previousState)) {
            if (!items.hasOwnProperty(key)) {
                changes[key] = null; // 使用 null 表示删除
                hasChanges = true;
            }
        }
        
        // 更新存储的状态
        profileStates.set(profileName, {...items});
        
        // 只有在有变化时才发送消息
        if (hasChanges) {
            const message = JSON.stringify({
                type: 'dataUpdate',
                profileName: profileName,
                changes: changes
            });
            
            // 广播消息给所有连接的客户端
            let clientCount = 0;
            wss.clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(message);
                    clientCount++;
                }
            });
            
            log('debug', `Sent data update to ${clientCount} clients for profile: ${profileName}`);
        } else {
            log('debug', `No changes detected for profile: ${profileName}, skipping update broadcast`);
        }
        
        callback(null);
    });
};