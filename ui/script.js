document.addEventListener('DOMContentLoaded', () => {
    // --- DOM 元素获取 ---
    const profileSelect = document.getElementById('profile-select');
    const newProfileBtn = document.getElementById('new-profile-btn');
    const deleteProfileBtn = document.getElementById('delete-profile-btn');
    const vmixUrlInput = document.getElementById('vmix-url');
    const currentProfileTitle = document.getElementById('current-profile-title');
    const connectionStatusIndicator = document.getElementById('connection-status');
    
    // 新增的DOM元素引用
    const addItemForm = document.getElementById('add-item-form');
    const itemNameInput = document.getElementById('item-name');
    const itemValueInput = document.getElementById('item-value');
    const dataItemsContainer = document.getElementById('data-items-container');
    const jsonPreviewContent = document.getElementById('json-preview-content');

    // --- 应用状态 ---
    let currentProfileName = null;
    let serverPort = null;
    let saveTimeout = null; // 用于保存操作的防抖
    let currentData = {}; // 存储当前配置文件的数据
    let websocket = null; // WebSocket 连接
    let reconnectTimeout = null; // 重连定时器
    let reconnectAttempts = 0; // 重连尝试次数
    let heartbeatInterval = null; // 心跳定时器

    // --- 函数定义 ---

    /**
     * 防抖函数，防止用户频繁输入导致过度保存
     * @param {Function} func - 要执行的函数
     * @param {number} delay - 延迟时间 (毫秒)
     */
    const debounce = (func, delay) => {
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(func, delay);
    };

    /**
     * 更新 vMix 数据源 URL
     */
    const updateVmixUrl = () => {
        if (serverPort && currentProfileName) {
            const url = `http://127.0.0.1:${serverPort}/api/data/${currentProfileName}`;
            vmixUrlInput.value = url;
            vmixUrlInput.title = url;
            
            // 尝试建立 WebSocket 连接
            connectWebSocket();
        } else {
            vmixUrlInput.value = '请先选择或创建一个配置文件';
            vmixUrlInput.title = '';
        }
    };

    /**
     * 连接到 WebSocket 服务器
     */
    const connectWebSocket = () => {
        console.log('Attempting to connect to WebSocket server');
        if (websocket && websocket.readyState === WebSocket.OPEN) {
            console.log('WebSocket connection already open, skipping connection attempt');
            return;
        }

        if (!serverPort) {
            console.warn('Server port not available, cannot connect WebSocket');
            return;
        }

        try {
            const wsUrl = `ws://127.0.0.1:${serverPort}`;
            console.log(`Creating WebSocket connection to ${wsUrl}`);
            websocket = new WebSocket(wsUrl);
            
            websocket.onopen = () => {
                console.log('WebSocket connection established');
                reconnectAttempts = 0; // 重置重连尝试次数
                updateConnectionStatus('connected');
                // 启动心跳机制
                startHeartbeat();
            };
            
            websocket.onmessage = (event) => {
                console.log('Received WebSocket message:', event.data);
                try {
                    const message = JSON.parse(event.data);
                    handleWebSocketMessage(message);
                } catch (error) {
                    console.error('Error parsing WebSocket message:', error);
                }
            };
            
            websocket.onclose = (event) => {
                console.log('WebSocket connection closed', event);
                console.log(`Close code: ${event.code}, reason: ${event.reason}`);
                updateConnectionStatus('disconnected');
                // 尝试重连
                scheduleReconnect();
            };
            
            websocket.onerror = (error) => {
                console.error('WebSocket error:', error);
                updateConnectionStatus('error');
            };
        } catch (error) {
            console.error('Failed to connect to WebSocket server:', error);
            updateConnectionStatus('error');
            scheduleReconnect();
        }
    };

    /**
     * 处理 WebSocket 消息
     * @param {object} message - 接收到的消息
     */
    const handleWebSocketMessage = (message) => {
        switch (message.type) {
            case 'welcome':
                console.log('WebSocket welcome message:', message.message);
                break;
            case 'dataUpdate':
                // 如果更新的数据是当前配置文件的数据，则刷新界面
                if (message.profileName === currentProfileName) {
                    console.log(`Received data update for profile: ${message.profileName}`);
                    // 应用变化到当前数据
                    if (message.changes) {
                        for (const [key, value] of Object.entries(message.changes)) {
                            if (value === null) {
                                // 删除项
                                delete currentData[key];
                            } else {
                                // 添加或更新项
                                currentData[key] = value;
                            }
                        }
                    }
                    renderDataItems(currentData);
                    updateJsonPreview(currentData);
                }
                break;
            case 'pong':
                // 收到心跳响应，可以在这里添加处理逻辑（如果需要）
                console.log('Received pong from server');
                break;
            default:
                console.log('Unknown WebSocket message type:', message.type);
        }
    };

    /**
     * 更新连接状态指示
     * @param {string} status - 连接状态 (connected, disconnected, error)
     */
    const updateConnectionStatus = (status) => {
        if (!connectionStatusIndicator) return;
        
        // 清除之前的样式类
        connectionStatusIndicator.classList.remove('status-connected', 'status-disconnected', 'status-error');
        
        switch (status) {
            case 'connected':
                connectionStatusIndicator.textContent = '已连接';
                connectionStatusIndicator.classList.add('status-connected');
                break;
            case 'disconnected':
                connectionStatusIndicator.textContent = '未连接';
                connectionStatusIndicator.classList.add('status-disconnected');
                break;
            case 'error':
                connectionStatusIndicator.textContent = '连接错误';
                connectionStatusIndicator.classList.add('status-error');
                break;
            default:
                connectionStatusIndicator.textContent = '未知状态';
                connectionStatusIndicator.classList.add('status-disconnected');
        }
        
        console.log('WebSocket connection status:', status);
    };

    /**
     * 启动心跳机制
     */
    const startHeartbeat = () => {
        // 清除之前的心跳定时器
        if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
        }
        
        // 每30秒发送一次心跳
        heartbeatInterval = setInterval(() => {
            if (websocket && websocket.readyState === WebSocket.OPEN) {
                websocket.send(JSON.stringify({ type: 'ping' }));
            }
        }, 30000);
    };

    /**
     * 停止心跳机制
     */
    const stopHeartbeat = () => {
        if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
        }
    };

    /**
     * 安排重连
     */
    const scheduleReconnect = () => {
        // 清除之前的心跳定时器
        stopHeartbeat();
        
        // 清除之前的重连定时器
        if (reconnectTimeout) {
            clearTimeout(reconnectTimeout);
        }
        
        // 限制重连尝试次数
        if (reconnectAttempts >= 10) {
            console.log('Max reconnect attempts reached, giving up');
            return;
        }
        
        // 指数退避策略
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000); // 最大延迟30秒
        reconnectAttempts++;
        
        console.log(`Scheduling reconnect attempt ${reconnectAttempts} in ${delay}ms`);
        reconnectTimeout = setTimeout(() => {
            connectWebSocket();
        }, delay);
    };

    /**
     * 从主进程加载所有配置文件列表并更新下拉菜单
     */
    const loadProfiles = async () => {
        const profiles = await window.api.getProfiles();
        const previouslySelected = currentProfileName || profileSelect.value;
        profileSelect.innerHTML = '<option value="">-- 选择一个配置 --</option>';
        profiles.forEach(profile => {
            const option = document.createElement('option');
            option.value = profile;
            option.textContent = profile;
            profileSelect.appendChild(option);
        });

        // 尝试恢复之前的选择
        if (profiles.includes(previouslySelected)) {
            profileSelect.value = previouslySelected;
        }
        
        // 触发一次 change 事件来加载数据
        handleProfileChange();
    };

    /**
     * 根据当前选择的配置文件加载其数据
     */
    const handleProfileChange = async () => {
        currentProfileName = profileSelect.value;
        deleteProfileBtn.disabled = !currentProfileName;

        if (!currentProfileName) {
            currentProfileTitle.textContent = '数据项管理';
            dataItemsContainer.innerHTML = '<p class="placeholder">请从上方选择一个配置文件进行编辑，或点击"新建"来创建一个新的配置。</p>';
            jsonPreviewContent.textContent = '{}';
        } else {
            currentProfileTitle.textContent = `编辑: ${currentProfileName}`;
            // 使用新的API端点获取数据项
            const response = await fetch(`http://127.0.0.1:${serverPort}/api/items/${currentProfileName}`);
            if (response.ok) {
                const result = await response.json();
                currentData = result.items || {};
                renderDataItems(currentData);
                updateJsonPreview(currentData);
            } else {
                console.error('Failed to load profile data');
                dataItemsContainer.innerHTML = '<p class="placeholder">加载数据时出错。</p>';
                jsonPreviewContent.textContent = '{}';
            }
        }
        updateVmixUrl();
    };

    /**
     * 将数据对象渲染成数据项列表
     * @param {object} data - 要渲染的数据对象
     */
    const renderDataItems = (data) => {
        dataItemsContainer.innerHTML = '';
        
        if (Object.keys(data).length === 0) {
            dataItemsContainer.innerHTML = '<p class="placeholder">此配置为空，请添加新数据项。</p>';
            return;
        }

        for (const key in data) {
            createDataItem(key, data[key]);
        }
    };

    /**
     * 创建一个数据项元素
     * @param {string} key - 数据项的键
     * @param {string} value - 数据项的值
     */
    const createDataItem = (key, value) => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'data-item';
        itemDiv.dataset.key = key;

        const itemInfoDiv = document.createElement('div');
        itemInfoDiv.className = 'data-item-info';

        const itemNameDiv = document.createElement('div');
        itemNameDiv.className = 'data-item-name';
        itemNameDiv.textContent = key;

        const itemValueDiv = document.createElement('div');
        itemValueDiv.className = 'data-item-value';
        itemValueDiv.textContent = value;

        itemInfoDiv.appendChild(itemNameDiv);
        itemInfoDiv.appendChild(itemValueDiv);

        const itemActionsDiv = document.createElement('div');
        itemActionsDiv.className = 'data-item-actions';

        const editBtn = document.createElement('button');
        editBtn.className = 'edit-btn';
        editBtn.textContent = '编辑';

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-btn';
        deleteBtn.textContent = '删除';

        itemActionsDiv.appendChild(editBtn);
        itemActionsDiv.appendChild(deleteBtn);

        itemDiv.appendChild(itemInfoDiv);
        itemDiv.appendChild(itemActionsDiv);

        // 编辑按钮事件
        editBtn.addEventListener('click', () => {
            const newKey = prompt('请输入新的数据名称:', key);
            if (newKey === null) return; // 用户取消操作
            
            const newValue = prompt('请输入新的数据值:', value);
            if (newValue === null) return; // 用户取消操作
            
            // 使用防抖机制更新数据
            debounce(() => updateDataItem(key, newKey, newValue), 500);
        });

        // 删除按钮事件
        deleteBtn.addEventListener('click', () => {
            if (confirm(`确定要删除数据项 "${key}" 吗？`)) {
                deleteDataItem(key);
            }
        });

        dataItemsContainer.appendChild(itemDiv);
    };

    /**
     * 更新实时预览区域
     * @param {object} data - 要显示的JSON数据
     */
    const updateJsonPreview = (data) => {
        jsonPreviewContent.textContent = JSON.stringify(data, null, 2);
    };

    /**
     * 保存当前配置文件的数据
     * @param {object} data - 要保存的数据
     */
    const saveCurrentData = async (data = currentData) => {
        if (!currentProfileName) return;

        try {
            // 调用主进程保存数据
            const result = await window.api.saveProfileData(currentProfileName, data);
            if (!result.success) {
                console.error('保存失败:', result.error);
                // 添加用户友好的错误提示
                alert(`保存失败: ${result.error}`);
                return false;
            } else {
                // 保存成功后更新当前数据和预览
                currentData = data;
                updateJsonPreview(data);
                return true;
            }
        } catch (error) {
            console.error('保存数据时出错:', error);
            // 添加用户友好的错误提示
            alert(`保存数据时出错: ${error.message}`);
            return false;
        }
    };

    /**
     * 添加新的数据项
     * @param {string} key - 数据项的键
     * @param {string} value - 数据项的值
     */
    const addDataItem = async (key, value) => {
        // 检查键是否已存在
        if (currentData.hasOwnProperty(key)) {
            alert(`数据项 "${key}" 已存在，请使用不同的名称。`);
            return false;
        }

        // 使用新的API端点添加数据项
        const response = await fetch(`http://127.0.0.1:${serverPort}/api/items/${currentProfileName}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ key, value })
        });

        if (response.ok) {
            const result = await response.json();
            currentData = result.items || {};
            renderDataItems(currentData);
            updateJsonPreview(currentData);
            return true;
        } else {
            const error = await response.json();
            alert(`添加数据项失败: ${error.error}`);
            return false;
        }
    };

    /**
     * 更新数据项
     * @param {string} oldKey - 原来的键
     * @param {string} newKey - 新的键
     * @param {string} newValue - 新的值
     */
    const updateDataItem = async (oldKey, newKey, newValue) => {
        // 如果键名改变，需要删除旧的键
        if (oldKey !== newKey) {
            // 检查新键是否已存在
            if (currentData.hasOwnProperty(newKey)) {
                alert(`数据项 "${newKey}" 已存在，请使用不同的名称。`);
                return false;
            }
            
            // 使用新的API端点删除旧的数据项
            const deleteResponse = await fetch(`http://127.0.0.1:${serverPort}/api/items/${currentProfileName}/${oldKey}`, {
                method: 'DELETE'
            });

            if (!deleteResponse.ok && deleteResponse.status !== 404) {
                const error = await deleteResponse.json();
                alert(`删除旧数据项失败: ${error.error}`);
                return false;
            }
        }
        
        // 使用新的API端点更新数据项
        const response = await fetch(`http://127.0.0.1:${serverPort}/api/items/${currentProfileName}/${newKey}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ value: newValue })
        });

        if (response.ok) {
            const result = await response.json();
            currentData = result.items || {};
            renderDataItems(currentData);
            updateJsonPreview(currentData);
            return true;
        } else {
            const error = await response.json();
            alert(`更新数据项失败: ${error.error}`);
            return false;
        }
    };

    /**
     * 删除数据项
     * @param {string} key - 要删除的数据项的键
     */
    const deleteDataItem = async (key) => {
        // 使用新的API端点删除数据项
        const response = await fetch(`http://127.0.0.1:${serverPort}/api/items/${currentProfileName}/${key}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            const result = await response.json();
            currentData = result.items || {};
            renderDataItems(currentData);
            updateJsonPreview(currentData);
            return true;
        } else {
            const error = await response.json();
            alert(`删除数据项失败: ${error.error}`);
            return false;
        }
    };

    /**
     * 验证数据项
     * @param {string} key - 数据项的键
     * @param {string} value - 数据项的值
     * @returns {boolean} - 验证是否通过
     */
    const validateDataItem = (key, value) => {
        // 检查键是否为空
        if (!key.trim()) {
            alert('数据名称不能为空。');
            return false;
        }
        
        // 检查键是否包含非法字符（这里只允许字母、数字、下划线和连字符）
        if (!/^[a-zA-Z0-9_\-\u4e00-\u9fa5]+$/.test(key)) {
            alert('数据名称只能包含字母、数字、下划线、连字符和中文字符。');
            return false;
        }
        
        return true;
    };

    /**
     * 创建新的配置文件
     */
    const createNewProfile = async () => {
        const profileName = prompt('请输入新配置文件的名称:');
        if (!profileName) return;

        // 简单的名称验证
        if (!/^[a-zA-Z0-9_-]+$/.test(profileName)) {
            alert('配置文件名只能包含字母、数字、下划线和连字符。');
            return;
        }

        try {
            // 尝试加载这个配置文件，如果不存在会返回空对象
            const data = await window.api.getProfileData(profileName);
            if (Object.keys(data).length > 0) {
                alert('该配置文件已存在，请选择其他名称。');
                return;
            }

            // 创建新的配置文件选项
            const option = document.createElement('option');
            option.value = profileName;
            option.textContent = profileName;
            profileSelect.appendChild(option);
            profileSelect.value = profileName;
            
            // 触发change事件来加载新配置文件
            handleProfileChange();
        } catch (error) {
            console.error('创建新配置文件时出错:', error);
            alert('创建新配置文件时出错，请查看控制台了解详情。');
        }
    };

    /**
     * 删除当前配置文件
     */
    const deleteCurrentProfile = async () => {
        if (!currentProfileName) return;
        
        if (!confirm(`确定要删除配置文件 "${currentProfileName}" 吗？此操作不可撤销。`)) {
            return;
        }

        try {
            const result = await window.api.deleteProfile(currentProfileName);
            if (result.success) {
                // 从下拉菜单中移除选项
                const optionToRemove = profileSelect.querySelector(`option[value="${currentProfileName}"]`);
                if (optionToRemove) optionToRemove.remove();
                
                // 重置当前配置文件
                currentProfileName = null;
                profileSelect.value = '';
                handleProfileChange();
            } else {
                console.error('删除失败:', result.error);
                alert('删除配置文件失败，请查看控制台了解详情。');
            }
        } catch (error) {
            console.error('删除配置文件时出错:', error);
            alert('删除配置文件时出错，请查看控制台了解详情。');
        }
    };

    // --- 事件监听器 ---

    // 监听服务器启动事件
    window.api.onServerStarted((port) => {
        console.log(`Server started event received, port: ${port}`);
        serverPort = port;
        updateVmixUrl();
        // 尝试建立 WebSocket 连接
        connectWebSocket();
    });

    // 配置文件选择变化
    profileSelect.addEventListener('change', handleProfileChange);

    // 新建配置文件按钮
    newProfileBtn.addEventListener('click', createNewProfile);

    // 删除配置文件按钮
    deleteProfileBtn.addEventListener('click', deleteCurrentProfile);
    
    // 添加数据项表单提交事件
    addItemForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        if (!currentProfileName) {
            alert('请先选择一个配置文件。');
            return;
        }
        
        const key = itemNameInput.value.trim();
        const value = itemValueInput.value;
        
        // 数据验证
        if (!validateDataItem(key, value)) {
            return;
        }
        
        // 添加数据项
        const success = await addDataItem(key, value);
        
        if (success) {
            // 清空表单
            itemNameInput.value = '';
            itemValueInput.value = '';
            itemNameInput.focus();
        }
    });

    // --- 初始化 ---
    loadProfiles();
});