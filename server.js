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
log('info', `Environment variables: VMIX_API_KEY ${process.env.VMIX_API_KEY ? 'set' : 'not set'}`);
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const path = require('path');
const fs = require('fs');
// atomically是一个ES模块，需要动态导入
let writeFile;
import('atomically').then((module) => {
    log('debug', 'atomically模块导入完成');
    writeFile = module.writeFile;
    log('debug', 'atomically.writeFile函数已赋值');
    log('debug', 'atomically模块导入成功');
}).catch((error) => {
    log('error', `atomically模块导入失败: ${error.message}`);
    log('error', `atomically模块导入失败详情: ${error.stack}`);
});
const { WebSocketServer, WebSocket } = require('ws');
// xml2js是一个ES模块，需要动态导入
let XMLBuilder;
import('xml2js').then((module) => {
    XMLBuilder = module.Builder;
    log('debug', 'xml2js module imported successfully');
    createXmlBuilder();
}).catch((error) => {
    log('error', `Failed to import xml2js module: ${error.message}`);
});

const app = express();
const PORT = 8088; // 定义服务器端口

// 创建 WebSocket 服务器
const wss = new WebSocketServer({ noServer: true });
log('debug', 'WebSocket server created with noServer option');

// 【已修正】从主进程启动时传递的命令行参数中获取数据目录
// process.argv 是一个数组，[0]是node程序路径, [1]是本脚本路径, [2]是第一个参数
const dataDir = process.argv[2];
log('debug', `Data directory from command line argument: ${dataDir}`);
if (!dataDir) {
    log('error', 'Data directory not provided. Server is exiting.');
    process.exit(1); // 如果没有提供目录，则退出并返回一个错误码
} else {
    log('info', `Using data directory: ${dataDir}`);
    // 检查数据目录是否存在以及是否可写
    try {
        fs.accessSync(dataDir, fs.constants.F_OK | fs.constants.W_OK);
        log('info', `Data directory ${dataDir} exists and is writable`);
    } catch (err) {
        if (err.code === 'ENOENT') {
            log('error', `Data directory ${dataDir} does not exist`);
        } else if (err.code === 'EACCES') {
            log('error', `Data directory ${dataDir} is not writable`);
        } else {
            log('error', `Error accessing data directory ${dataDir}: ${err.message}`);
        }
        process.exit(1);
    }
}

// 创建缓存对象
const dataCache = new Map();
const cacheExpiry = 5 * 60 * 1000; // 缓存过期时间5分钟
log('debug', `Cache expiry time set to ${cacheExpiry}ms (${cacheExpiry / 1000 / 60} minutes)`);

// 创建XML构建器实例的函数
let xmlBuilder;
const createXmlBuilder = () => {
    if (XMLBuilder) {
        log('debug', 'Creating XML builder instance');
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
        log('debug', 'XML builder instance created successfully');
    } else {
        log('error', 'XMLBuilder is not available');
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
        log('debug', 'Starting XML conversion');
        // 检查xmlBuilder是否已经创建
        if (!xmlBuilder) {
            log('error', 'XML builder is not available');
            throw new Error('XML builder is not available');
        }
        
        // 如果数据是数组且只有一个元素，提取该元素
        const dataToConvert = Array.isArray(data) && data.length === 1 ? data[0] : data;
        log('debug', `Converting data to XML, data type: ${typeof dataToConvert}, is array: ${Array.isArray(dataToConvert)}`);
        const result = xmlBuilder.buildObject(dataToConvert);
        log('debug', 'XML conversion completed successfully');
        return result;
    } catch (error) {
        log('error', `Failed to convert data to XML: ${error.message}`);
        throw error;
    }
};

// 数据格式转换函数
const convertToPlainText = (data) => {
    try {
        log('debug', 'Starting plain text conversion');
        // 如果数据是数组且只有一个元素，提取该元素
        const dataToConvert = Array.isArray(data) && data.length === 1 ? data[0] : data;
        log('debug', `Converting data to plain text, data type: ${typeof dataToConvert}, is array: ${Array.isArray(dataToConvert)}`);
        
        // 如果是对象，将其转换为键值对格式的文本
        if (typeof dataToConvert === 'object' && dataToConvert !== null) {
            if (Array.isArray(dataToConvert)) {
                log('debug', 'Converting array to plain text');
                // 如果是数组，将每个元素转换为字符串并用换行符分隔
                const result = dataToConvert.map(item =>
                    typeof item === 'object' && item !== null ?
                    Object.entries(item).map(([key, value]) => `${key}: ${value}`).join('\n') :
                    String(item)
                ).join('\n---\n');
                log('debug', 'Plain text conversion completed for array');
                return result;
            } else {
                log('debug', 'Converting object to plain text');
                // 如果是对象，将其转换为键值对格式
                const result = Object.entries(dataToConvert)
                    .map(([key, value]) => `${key}: ${value}`)
                    .join('\n');
                log('debug', 'Plain text conversion completed for object');
                return result;
            }
        }
        
        // 其他情况直接转换为字符串
        log('debug', 'Converting to string');
        const result = String(dataToConvert);
        log('debug', 'Plain text conversion completed for string');
        return result;
    } catch (error) {
        log('error', `Failed to convert data to plain text: ${error.message}`);
        throw error;
    }
};

// 数据过滤函数
const filterData = (data, filters) => {
    if (!filters || Object.keys(filters).length === 0) {
        log('debug', 'No filters provided, returning original data');
        return data;
    }
    
    try {
        log('debug', `Applying filters: include=${filters.include || 'none'}, exclude=${filters.exclude || 'none'}`);
        // 如果数据是数组且只有一个元素，提取该元素
        const dataToFilter = Array.isArray(data) && data.length === 1 ? data[0] : data;
        
        // 如果是对象，应用过滤器
        if (typeof dataToFilter === 'object' && dataToFilter !== null && !Array.isArray(dataToFilter)) {
            const filteredData = {};
            let includedCount = 0;
            let excludedCount = 0;
            
            for (const [key, value] of Object.entries(dataToFilter)) {
                // 检查是否应该包含此键
                let include = true;
                if (filters.include) {
                    include = filters.include.split(',').includes(key);
                    if (include) includedCount++;
                }
                if (filters.exclude) {
                    const shouldExclude = filters.exclude.split(',').includes(key);
                    if (shouldExclude) excludedCount++;
                    include = include && !shouldExclude;
                }
                if (include) {
                    filteredData[key] = value;
                }
            }
            
            log('debug', `Filtering completed: included ${includedCount} keys, excluded ${excludedCount} keys`);
            // 如果数据原本是数组形式，需要包装回去
            return Array.isArray(data) && data.length === 1 ? [filteredData] : filteredData;
        }
        
        // 其他情况返回原始数据
        log('debug', 'Data is not an object, returning original data');
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
        log('debug', 'Data validation failed: Data must be an object or array');
        return { isValid: false, error: 'Data must be an object or array' };
    }
    
    // 如果是数组，检查每个元素
    if (Array.isArray(data)) {
        for (let i = 0; i < data.length; i++) {
            const item = data[i];
            if (typeof item !== 'object' || item === null) {
                log('debug', `Data validation failed: Array item at index ${i} must be an object`);
                return { isValid: false, error: `Array item at index ${i} must be an object` };
            }
            
            // 检查对象属性
            for (const [key, value] of Object.entries(item)) {
                if (typeof key !== 'string') {
                    log('debug', `Data validation failed: Object key must be a string`);
                    return { isValid: false, error: `Object key must be a string` };
                }
                
                // 检查值的类型
                if (value !== null && typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
                    log('debug', `Data validation failed: Object value for key '${key}' must be a string, number, boolean, or null`);
                    return { isValid: false, error: `Object value for key '${key}' must be a string, number, boolean, or null` };
                }
            }
        }
    } else {
        // 如果是对象，检查属性
        for (const [key, value] of Object.entries(data)) {
            if (typeof key !== 'string') {
                log('debug', `Data validation failed: Object key must be a string`);
                return { isValid: false, error: `Object key must be a string` };
            }
            
            // 检查值的类型
            if (value !== null && typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
                log('debug', `Data validation failed: Object value for key '${key}' must be a string, number, boolean, or null`);
                return { isValid: false, error: `Object value for key '${key}' must be a string, number, boolean, or null` };
            }
        }
    }
    
    log('debug', 'Data validation passed');
    return { isValid: true };
};

// 数据格式化函数
const formatData = (data, format) => {
    log('debug', `Formatting data to ${format} format`);
    // 首先验证数据
    const validation = validateData(data);
    if (!validation.isValid) {
        log('error', `Data validation failed: ${validation.error}`);
        throw new Error(`Data validation failed: ${validation.error}`);
    }
    
    switch (format.toLowerCase()) {
        case 'xml':
            log('debug', 'Converting data to XML format');
            return convertToXML(data);
        case 'text':
        case 'plain':
        case 'plaintext':
            log('debug', 'Converting data to plain text format');
            return convertToPlainText(data);
        case 'json':
        default:
            log('debug', 'Converting data to JSON format');
            return typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    }
};

// 获取内容类型函数
const getContentType = (format) => {
    log('debug', `Getting content type for format: ${format}`);
    switch (format.toLowerCase()) {
        case 'xml':
            log('debug', 'Returning XML content type');
            return 'application/xml; charset=utf-8';
        case 'text':
        case 'plain':
        case 'plaintext':
            log('debug', 'Returning plain text content type');
            return 'text/plain; charset=utf-8';
        case 'json':
        default:
            log('debug', 'Returning JSON content type');
            return 'application/json; charset=utf-8';
    }
};


// 生成一个简单的API密钥（在实际应用中，应该使用更安全的方法生成和存储密钥）
const API_KEY = process.env.VMIX_API_KEY || 'vmix-default-api-key';
log('debug', `API key configured: ${!!process.env.VMIX_API_KEY ? 'Using environment variable' : 'Using default key'}`);
log('debug', `API key length: ${API_KEY.length} characters`);

app.use(compression()); // 启用响应压缩
log('debug', 'Compression middleware enabled');
app.use(cors()); // 允许跨域请求
log('debug', 'CORS middleware enabled');
app.use(express.json()); // 解析 JSON 请求体
log('debug', 'JSON body parser middleware enabled');

// --- 中间件 ---
// 记录请求日志
app.use((req, res, next) => {
    log('info', `${req.method} ${req.path}`);
    log('debug', `Request headers: ${JSON.stringify(req.headers)}`);
    next();
});

// 访问控制中间件
const accessControl = (req, res, next) => {
    // 检查是否来自本地访问
    const clientIP = req.connection.remoteAddress || req.socket.remoteAddress;
    const isLocal = clientIP === '127.0.0.1' || clientIP === '::1' || clientIP === '::ffff:127.0.0.1';
    log('debug', `Access control check for client IP: ${clientIP}, isLocal: ${isLocal}`);
    
    // 如果不是本地访问，检查API密钥
    if (!isLocal) {
        const apiKey = req.headers['x-api-key'] || req.query.api_key;
        log('debug', `Checking API key for remote client, provided key: ${!!apiKey}`);
        if (!apiKey || apiKey !== API_KEY) {
            log('warn', `Unauthorized access attempt from ${clientIP}`);
            return res.status(403).json({ error: 'Forbidden: Invalid API key' });
        }
        log('debug', `API key validated for client ${clientIP}`);
    } else {
        log('debug', `Local access allowed for client ${clientIP}`);
    }
    
    next();
};

// --- API 端点 ---
// 这是 vMix 将要轮询的端点
app.get('/api/data/:profileName', accessControl, (req, res) => {
    const { profileName } = req.params;
    const { format = 'json', include, exclude } = req.query; // 支持格式和过滤参数
    const filePath = path.join(dataDir, `${profileName}.json`);
    log('debug', `Constructed file path: ${filePath}`);

    // 检查缓存（包含格式）
    const cacheKey = `${filePath}_${format}_${include || ''}_${exclude || ''}`;
    log('debug', `Constructed cache key: ${cacheKey}`);
    const cached = dataCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < cacheExpiry) {
        log('debug', `Cache hit for ${cacheKey}, cache age: ${Date.now() - cached.timestamp}ms`);
        // 设置适当的缓存头
        res.setHeader('Cache-Control', 'public, max-age=60');
        log('debug', 'Set Cache-Control header: public, max-age=60');
        res.setHeader('ETag', `"${cached.timestamp}"`);
        log('debug', `Set ETag header: "${cached.timestamp}"`);
        res.setHeader('Content-Type', getContentType(format));
        log('debug', `Set Content-Type header: ${getContentType(format)}`);
        return res.send(cached.data);
    } else if (cached) {
        log('debug', `Cache expired for ${cacheKey}, cache age: ${Date.now() - cached.timestamp}ms`);
        // 缓存已过期，删除它
        dataCache.delete(cacheKey);
    } else {
        log('debug', `Cache miss for ${cacheKey}`);
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
                log('debug', 'Set Cache-Control header: public, max-age=60');
                res.setHeader('Content-Type', getContentType(format));
                log('debug', `Set Content-Type header: ${getContentType(format)}`);
                log('debug', `Sending empty data response: ${formattedData}`);
                return res.send(formattedData);
            }
            // 根据错误类型提供更明确的错误信息
            log('error', `Failed to read profile data from ${filePath}: ${err.message}`);
            let errorMessage = 'Failed to read profile data';
            if (err.code === 'EACCES') {
                errorMessage = 'Permission denied to read profile data';
            } else if (err.code === 'EISDIR') {
                errorMessage = 'Profile path is a directory, not a file';
            }
            log('debug', `Sending error response: ${JSON.stringify({ error: errorMessage })}`);
            return res.status(500).json({ error: errorMessage });
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
            log('debug', 'Set Cache-Control header: public, max-age=60');
            res.setHeader('ETag', `"${Date.now()}"`);
            log('debug', `Set ETag header: "${Date.now()}"`);
            res.setHeader('Content-Type', getContentType(format));
            log('debug', `Set Content-Type header: ${getContentType(format)}`);
            res.send(formattedData);
        } catch (parseError) {
            log('error', `Failed to parse profile data from ${filePath}: ${parseError.message}`);
            // 检查是否是JSON解析错误
            if (parseError instanceof SyntaxError) {
                return res.status(500).json({ error: 'Invalid JSON format in profile data' });
            }
            res.status(500).json({ error: 'Failed to parse profile data' });
        }
    });
});

// 获取指定配置文件的数据项列表
app.get('/api/items/:profileName', accessControl, (req, res) => {
    const { profileName } = req.params;
    const filePath = path.join(dataDir, `${profileName}.json`);

    // 验证配置文件名
    log('debug', `Validating profile name: ${profileName}`);
    if (!/^[a-zA-Z0-9_-]+$/.test(profileName)) {
        log('warn', `Invalid profile name: ${profileName}`);
        log('debug', `Sending 400 response: ${JSON.stringify({ error: 'Invalid profile name' })}`);
        return res.status(400).json({ error: 'Invalid profile name' });
    }
    log('debug', `Profile name validated: ${profileName}`);

    fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) {
            if (err.code === 'ENOENT') {
                log('debug', `Profile ${profileName} not found`);
                log('debug', `Sending 404 response: ${JSON.stringify({ items: {} })}`);
                return res.status(404).json({ items: {} });
            }
            // 根据错误类型提供更明确的错误信息
            log('error', `Failed to read profile data from ${filePath}: ${err.message}`);
            let errorMessage = 'Failed to read profile data';
            if (err.code === 'EACCES') {
                errorMessage = 'Permission denied to read profile data';
            } else if (err.code === 'EISDIR') {
                errorMessage = 'Profile path is a directory, not a file';
            }
            return res.status(500).json({ error: errorMessage });
        }

        try {
            const parsedData = JSON.parse(data);
            // vMix 需要的是一个对象数组，我们这里返回数组中的第一个对象给UI编辑
            const items = Array.isArray(parsedData) && parsedData.length > 0 ? parsedData[0] : {};
            log('debug', `Retrieved items for profile ${profileName}`);
            log('debug', `Sending response with items: ${JSON.stringify({ items })}`);
            res.json({ items });
        } catch (parseError) {
            log('error', `Failed to parse profile data from ${filePath}: ${parseError.message}`);
            // 检查是否是JSON解析错误
            if (parseError instanceof SyntaxError) {
                return res.status(500).json({ error: 'Invalid JSON format in profile data' });
            }
            res.status(500).json({ error: 'Failed to parse profile data' });
        }
    });
});

// 添加数据项
app.post('/api/items/:profileName', accessControl, (req, res) => {
    const { profileName } = req.params;
    const { key, value } = req.body;

    // 验证输入
    log('debug', `Validating input: key=${key}, value=${value}`);
    if (!key || typeof key !== 'string' || !value) {
        log('warn', 'Invalid key or value provided');
        return res.status(400).json({ error: 'Key and value are required' });
    }
    log('debug', 'Input validation passed');

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
            // 根据错误类型提供更明确的错误信息
            log('error', `Failed to read profile data from ${filePath}: ${err.message}`);
            let errorMessage = 'Failed to read profile data';
            if (err.code === 'EACCES') {
                errorMessage = 'Permission denied to read profile data';
            } else if (err.code === 'EISDIR') {
                errorMessage = 'Profile path is a directory, not a file';
            }
            return res.status(500).json({ error: errorMessage });
        }

        if (!err) {
            try {
                const parsedData = JSON.parse(data);
                items = Array.isArray(parsedData) && parsedData.length > 0 ? parsedData[0] : {};
            } catch (parseError) {
                log('error', `Failed to parse profile data from ${filePath}: ${parseError.message}`);
                // 检查是否是JSON解析错误
                if (parseError instanceof SyntaxError) {
                    return res.status(500).json({ error: 'Invalid JSON format in profile data' });
                }
                return res.status(500).json({ error: 'Failed to parse profile data' });
            }
        }

        // 检查键是否已存在
        if (items.hasOwnProperty(key)) {
            log('warn', `Key ${key} already exists in profile ${profileName}`);
            log('debug', `Sending 409 response: ${JSON.stringify({ error: 'Key already exists' })}`);
            return res.status(409).json({ error: 'Key already exists' });
        }

        // 添加新数据项
        items[key] = value;

        // 保存数据
        saveProfileData(filePath, items, (saveErr) => {
            if (saveErr) {
                log('error', `Failed to save profile data to ${filePath}: ${saveErr.message}`);
                // 根据错误类型提供更明确的错误信息
                let errorMessage = 'Failed to save profile data';
                if (saveErr.code === 'EACCES') {
                    errorMessage = 'Permission denied to save profile data';
                } else if (saveErr.code === 'ENOSPC') {
                    errorMessage = 'No space left on device to save profile data';
                }
                return res.status(500).json({ error: errorMessage });
            }
            
            log('info', `Added item ${key} to profile ${profileName}`);
            log('debug', `Sending response: ${JSON.stringify({ message: 'Item added successfully', items })}`);
            res.status(201).json({ message: 'Item added successfully', items });
        });
    });
});

// 更新数据项
app.put('/api/items/:profileName/:key', accessControl, (req, res) => {
    const { profileName, key } = req.params;
    const { value } = req.body;

    // 验证输入
    log('debug', `Validating value: ${value}`);
    if (value === undefined) {
        log('warn', 'Value is required');
        return res.status(400).json({ error: 'Value is required' });
    }
    log('debug', 'Value validation passed');

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
            // 根据错误类型提供更明确的错误信息
            log('error', `Failed to read profile data from ${filePath}: ${err.message}`);
            let errorMessage = 'Failed to read profile data';
            if (err.code === 'EACCES') {
                errorMessage = 'Permission denied to read profile data';
            } else if (err.code === 'EISDIR') {
                errorMessage = 'Profile path is a directory, not a file';
            }
            return res.status(500).json({ error: errorMessage });
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
                    log('error', `Failed to save profile data to ${filePath}: ${saveErr.message}`);
                    // 根据错误类型提供更明确的错误信息
                    let errorMessage = 'Failed to save profile data';
                    if (saveErr.code === 'EACCES') {
                        errorMessage = 'Permission denied to save profile data';
                    } else if (saveErr.code === 'ENOSPC') {
                        errorMessage = 'No space left on device to save profile data';
                    }
                    return res.status(500).json({ error: errorMessage });
                }
                
                log('info', `Updated item ${key} in profile ${profileName}`);
                log('debug', `Sending response: ${JSON.stringify({ message: 'Item updated successfully', items })}`);
                res.json({ message: 'Item updated successfully', items });
            });
        } catch (parseError) {
            log('error', `Failed to parse profile data from ${filePath}: ${parseError.message}`);
            // 检查是否是JSON解析错误
            if (parseError instanceof SyntaxError) {
                return res.status(500).json({ error: 'Invalid JSON format in profile data' });
            }
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
            // 根据错误类型提供更明确的错误信息
            log('error', `Failed to read profile data from ${filePath}: ${err.message}`);
            let errorMessage = 'Failed to read profile data';
            if (err.code === 'EACCES') {
                errorMessage = 'Permission denied to read profile data';
            } else if (err.code === 'EISDIR') {
                errorMessage = 'Profile path is a directory, not a file';
            }
            return res.status(500).json({ error: errorMessage });
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
                    log('error', `Failed to save profile data to ${filePath}: ${saveErr.message}`);
                    // 根据错误类型提供更明确的错误信息
                    let errorMessage = 'Failed to save profile data';
                    if (saveErr.code === 'EACCES') {
                        errorMessage = 'Permission denied to save profile data';
                    } else if (saveErr.code === 'ENOSPC') {
                        errorMessage = 'No space left on device to save profile data';
                    }
                    return res.status(500).json({ error: errorMessage });
                }
                
                log('info', `Deleted item ${key} from profile ${profileName}`);
                log('debug', `Sending response: ${JSON.stringify({ message: 'Item deleted successfully', items })}`);
                res.json({ message: 'Item deleted successfully', items });
            });
        } catch (parseError) {
            log('error', `Failed to parse profile data from ${filePath}: ${parseError.message}`);
            // 检查是否是JSON解析错误
            if (parseError instanceof SyntaxError) {
                return res.status(500).json({ error: 'Invalid JSON format in profile data' });
            }
            res.status(500).json({ error: 'Failed to parse profile data' });
        }
    });
});

// --- 辅助函数 ---
// 端口检测函数
const checkPort = (port) => {
    log('debug', `Starting port check for port ${port}`);
    return new Promise((resolve) => {
        const server = require('net').createServer();
        server.listen(port, '127.0.0.1');
        server.on('error', (err) => {
            log('debug', `Port ${port} check failed: ${err.code}`);
            server.close();
            // 根据错误代码返回更详细的信息
            if (err.code === 'EADDRINUSE') {
                log('warn', `Port ${port} is already in use`);
                resolve({ available: false, reason: 'PORT_IN_USE' });
            } else if (err.code === 'EACCES') {
                log('error', `Permission denied to access port ${port}`);
                resolve({ available: false, reason: 'PERMISSION_DENIED' });
            } else {
                log('error', `Failed to check port ${port}: ${err.message}`);
                resolve({ available: false, reason: 'OTHER_ERROR', error: err });
            }
        });
        server.on('listening', () => {
            log('debug', `Port ${port} is available`);
            server.close();
            resolve({ available: true });
        });
    });
};

// 保存配置文件数据的辅助函数
let saveProfileData = (filePath, items, callback) => {
    log('debug', `Saving profile data to ${filePath}`);
    // 清除缓存
    log('debug', `Clearing cache for ${filePath}`);
    dataCache.delete(filePath);
    
    // 将数据写入任务发送给主进程处理，由它来完成原子化写入
    // vMix 需要的是一个对象数组，所以我们在这里将对象包装在数组中
    if (process.send) {
        log('debug', 'Sending WRITE_DATA message to main process');
        process.send({ type: 'WRITE_DATA', filePath, data: [items] });
        callback(null);
    } else {
        // 如果没有主进程连接，直接写入文件
        log('debug', 'No main process connection, writing file directly');
        writeFile(filePath, JSON.stringify([items], null, 2))
            .then(() => {
                log('debug', `File written successfully to ${filePath}`);
                callback(null);
            })
            .catch((error) => {
                log('error', `Failed to write file to ${filePath}: ${error.message}`);
                callback(error);
            });
    }
};

// --- 进程消息监听器 ---
// 监听来自主进程的消息，执行文件写入操作
process.on('message', async (msg) => {
    log('debug', `Received message from main process: ${JSON.stringify(msg)}`);
    if (msg.type === 'WRITE_DATA') {
        const { filePath, data } = msg;
        try {
            // 使用 atomically.writeFile 来安全地写入文件
            // 它会先写入一个临时文件，成功后再重命名，防止vMix读到不完整的数据
            log('debug', `Attempting to write data to ${filePath}`);
            log('debug', `Data to write: ${JSON.stringify(data, null, 2)}`);
            log('debug', `Checking if writeFile function is available: ${!!writeFile}`);
            await writeFile(filePath, JSON.stringify(data, null, 2));
            // 清除缓存
            dataCache.delete(filePath);
            log('debug', `Data written to ${filePath}`);
            // 通过进程间通信发送成功消息给主进程
            if (process.send) {
                process.send({ type: 'WRITE_DATA_SUCCESS', filePath: filePath });
            }
        } catch (error) {
            log('error', `Atomic write failed for ${filePath}: ${error.message}`);
            log('error', `Atomic write failed stack: ${error.stack}`);
            // 根据错误类型提供更明确的错误信息
            let errorInfo = { type: 'WRITE_DATA_ERROR', filePath: filePath };
            if (error.code === 'EACCES') {
                errorInfo.error = 'PERMISSION_DENIED';
                errorInfo.message = `Permission denied to write to ${filePath}`;
            } else if (error.code === 'ENOSPC') {
                errorInfo.error = 'NO_SPACE';
                errorInfo.message = `No space left on device to write to ${filePath}`;
            } else {
                errorInfo.error = 'OTHER_ERROR';
                errorInfo.message = error.message;
            }
            
            // 通过进程间通信发送详细的错误信息给主进程
            if (process.send) {
                process.send(errorInfo);
            }
        }
    } else if (msg.type === 'DELETE_FILE') {
        // 接收主进程的删除文件指令
        log('debug', `Attempting to delete file: ${msg.filePath}`);
        fs.unlink(msg.filePath, (err) => {
            // 如果文件不存在 (ENOENT)，则忽略错误，否则打印错误
            if (err && err.code !== 'ENOENT') {
                log('error', `Failed to delete file: ${err.message}`);
                // 根据错误类型提供更明确的错误信息
                let errorInfo = { type: 'DELETE_FILE_ERROR', filePath: msg.filePath };
                if (err.code === 'EACCES') {
                    errorInfo.error = 'PERMISSION_DENIED';
                    errorInfo.message = `Permission denied to delete ${msg.filePath}`;
                } else {
                    errorInfo.error = 'OTHER_ERROR';
                    errorInfo.message = err.message;
                }
                
                // 通过进程间通信发送详细的错误信息给主进程
                if (process.send) {
                    process.send(errorInfo);
                }
            } else {
                // 清除缓存
                dataCache.delete(msg.filePath);
                log('debug', `Deleted file: ${msg.filePath}`);
            }
        });
    }
});

// 端口检测和服务器启动函数
const startServer = async () => {
    // 定义主端口和备用端口
    const ports = [8088, 8089, 8090, 8091, 8092];
    let availablePort = null;
    let portCheckResults = [];
    
    // 检查端口可用性
    log('info', 'Starting port availability check');
    const startTime = Date.now();
    for (const port of ports) {
        log('info', `Checking port ${port} availability`);
        const result = await checkPort(port);
        portCheckResults.push({ port, ...result });
        
        if (result.available) {
            availablePort = port;
            log('info', `Port ${port} is available`);
            break;
        } else {
            switch (result.reason) {
                case 'PORT_IN_USE':
                    log('warn', `Port ${port} is not available: Port in use`);
                    break;
                case 'PERMISSION_DENIED':
                    log('error', `Port ${port} is not available: Permission denied`);
                    break;
                case 'OTHER_ERROR':
                    log('error', `Port ${port} is not available: ${result.error.message}`);
                    break;
                default:
                    log('warn', `Port ${port} is not available`);
            }
        }
    }
    const endTime = Date.now();
    log('info', `Port availability check completed in ${endTime - startTime}ms`);
    
    // 如果没有可用端口，退出进程
    if (availablePort === null) {
        log('error', 'No available ports found. Exiting.');
        // 通过进程间通信发送详细的错误信息给主进程
        if (process.send) {
            process.send({
                status: 'SERVER_START_FAILED',
                error: 'NO_AVAILABLE_PORTS',
                portCheckResults: portCheckResults
            });
        }
        process.exit(1);
    }
    
    // 使用可用端口启动服务器
    log('info', `Attempting to start server on port ${availablePort}`);
    const server = app.listen(availablePort, '127.0.0.1', () => {
        // 通知主进程服务器已成功启动，并传递实际使用的端口号
        if (process.send) {
            process.send({ status: 'SERVER_STARTED', port: availablePort });
        }
        log('info', `vMix Data Server successfully started and listening at http://127.0.0.1:${availablePort}`);
    }).on('error', (error) => {
        log('error', `Failed to start server: ${error.message}`);
        // 根据错误类型提供更明确的错误信息
        let errorInfo = { status: 'SERVER_START_FAILED' };
        if (error.code === 'EADDRINUSE') {
            errorInfo.error = 'PORT_IN_USE';
            errorInfo.message = `Port ${availablePort} is already in use`;
        } else if (error.code === 'EACCES') {
            errorInfo.error = 'PERMISSION_DENIED';
            errorInfo.message = `Permission denied to bind to port ${availablePort}`;
        } else {
            errorInfo.error = 'OTHER_ERROR';
            errorInfo.message = error.message;
        }
        
        // 通过进程间通信发送详细的错误信息给主进程
        if (process.send) {
            process.send(errorInfo);
        }
    });
    
    // 添加服务器监听事件的日志
    server.on('listening', () => {
        const address = server.address();
        log('info', `Server is listening on ${address.address}:${address.port}`);
    });
    
    // 添加服务器错误事件的日志
    server.on('error', (error) => {
        log('error', `Server error: ${error.message}`);
    });
    
    // 设置 WebSocket 升级处理
    server.on('upgrade', (request, socket, head) => {
        log('debug', `Received upgrade request for ${request.url}`);
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
        });
    });
};

// 启动服务器
log('info', 'Starting server...');
log('info', 'Server start process initiated');
startServer();
log('info', 'Server start process completed');

// 管理 WebSocket 客户端连接
wss.on('connection', (ws, request) => {
    log('info', 'New WebSocket client connected');
    log('debug', `Client connected from ${request.socket.remoteAddress}:${request.socket.remotePort}`);
    log('debug', `Request URL: ${request.url}`);
    log('debug', `Request headers: ${JSON.stringify(request.headers)}`);
    
    // 发送欢迎消息
    const welcomeMessage = { type: 'welcome', message: 'Connected to vMix Data Server' };
    ws.send(JSON.stringify(welcomeMessage));
    log('debug', `Sent welcome message: ${JSON.stringify(welcomeMessage)}`);
    
    // 处理客户端消息
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            log('debug', `Received message from client: ${data.type || 'unknown type'}`);
            if (data.type === 'ping') {
                // 回复心跳响应
                const pongMessage = { type: 'pong' };
                ws.send(JSON.stringify(pongMessage));
                log('debug', 'Received ping from client, sent pong response');
            }
        } catch (error) {
            log('error', `Error parsing WebSocket message: ${error.message}`);
            log('debug', `Raw message: ${message}`);
        }
    });
    
    // 处理客户端断开连接
    ws.on('close', (code, reason) => {
        log('info', `WebSocket client disconnected with code: ${code}`);
        if (reason) {
            log('debug', `Disconnect reason: ${reason.toString()}`);
        }
    });
    
    // 处理错误
    ws.on('error', (error) => {
        log('error', `WebSocket error: ${error.message}`);
        log('debug', `WebSocket error stack: ${error.stack}`);
    });
});

// 存储每个配置文件的先前状态，用于计算变化
const profileStates = new Map();

// 修改 saveProfileData 函数以通知客户端数据更新
const originalSaveProfileData = saveProfileData;
saveProfileData = (filePath, items, callback) => {
    log('debug', `saveProfileData called for ${filePath}`);
    // 调用原始函数保存数据
    originalSaveProfileData(filePath, items, (err) => {
        if (err) {
            log('error', `Failed to save profile data for ${filePath}: ${err.message}`);
            callback(err);
            return;
        }
        
        log('debug', `Profile data saved successfully for ${filePath}`);
        // 数据保存成功后，通知所有连接的客户端
        const profileName = path.basename(filePath, '.json');
        const previousState = profileStates.get(profileName) || {};
        log('debug', `Previous state for profile ${profileName}: ${JSON.stringify(previousState)}`);
        
        // 计算变化的数据
        const changes = {};
        let hasChanges = false;
        
        // 检查新的或更新的项
        for (const [key, value] of Object.entries(items)) {
            if (previousState[key] !== value) {
                changes[key] = value;
                hasChanges = true;
                log('debug', `Detected change in key ${key}: ${previousState[key]} -> ${value}`);
            }
        }
        
        // 检查删除的项
        for (const key of Object.keys(previousState)) {
            if (!items.hasOwnProperty(key)) {
                changes[key] = null; // 使用 null 表示删除
                hasChanges = true;
                log('debug', `Detected deletion of key ${key}`);
            }
        }
        
        // 更新存储的状态
        profileStates.set(profileName, {...items});
        log('debug', `Updated state for profile ${profileName}: ${JSON.stringify(items)}`);
        
        // 只有在有变化时才发送消息
        if (hasChanges) {
            const message = JSON.stringify({
                type: 'dataUpdate',
                profileName: profileName,
                changes: changes
            });
            log('debug', `Broadcasting data update for profile ${profileName}: ${JSON.stringify(changes)}`);
            
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