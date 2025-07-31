document.addEventListener('DOMContentLoaded', () => {
    // --- DOM 元素获取 ---
    const profileSelect = document.getElementById('profile-select');
    const newProfileBtn = document.getElementById('new-profile-btn');
    const deleteProfileBtn = document.getElementById('delete-profile-btn');
    const vmixUrlInput = document.getElementById('vmix-url');
    const currentProfileTitle = document.getElementById('current-profile-title');
    const dataFieldsContainer = document.getElementById('data-fields-container');
    const addFieldBtn = document.getElementById('add-field-btn');

    // --- 应用状态 ---
    let currentProfileName = null;
    let serverPort = null;
    let saveTimeout = null; // 用于保存操作的防抖

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
        } else {
            vmixUrlInput.value = '请先选择或创建一个配置文件';
            vmixUrlInput.title = '';
        }
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
        addFieldBtn.disabled = !currentProfileName;

        if (!currentProfileName) {
            currentProfileTitle.textContent = '数据字段';
            dataFieldsContainer.innerHTML = '<p class="placeholder">请从上方选择一个配置文件进行编辑，或点击“新建”来创建一个新的配置。</p>';
        } else {
            currentProfileTitle.textContent = `编辑: ${currentProfileName}`;
            const data = await window.api.getProfileData(currentProfileName);
            renderDataFields(data);
        }
        updateVmixUrl();
    };

    /**
     * 将数据对象渲染成键值对输入框
     * @param {object} data - 要渲染的数据对象
     */
    const renderDataFields = (data) => {
        dataFieldsContainer.innerHTML = '';
        if (Object.keys(data).length === 0 && currentProfileName) {
            dataFieldsContainer.innerHTML = '<p class="placeholder">此配置为空，点击“添加字段”开始添加数据。</p>';
        }

        for (const key in data) {
            createFieldInput(key, data[key]);
        }
    };

    /**
     * 创建一个键值对输入行
     * @param {string} key - 键
     * @param {string} value - 值
     */
    const createFieldInput = (key = '', value = '') => {
        const fieldDiv = document.createElement('div');
        fieldDiv.className = 'field';

        const keyInput = document.createElement('input');
        keyInput.type = 'text';
        keyInput.className = 'key-input';
        keyInput.placeholder = '字段名 (Key)';
        keyInput.value = key;

        const valueInput = document.createElement('input');
        valueInput.type = 'text';
        valueInput.className = 'value-input';
        valueInput.placeholder = '字段值 (Value)';
        valueInput.value = value;

        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = '删除';
        deleteBtn.className = 'delete-field-btn';

        // 任何输入变化都触发防抖保存
        [keyInput, valueInput].forEach(input => {
            input.addEventListener('input', () => debounce(saveCurrentData, 500));
        });

        deleteBtn.addEventListener('click', () => {
            fieldDiv.remove();
            saveCurrentData(); // 删除后立即保存
        });

        fieldDiv.appendChild(keyInput);
        fieldDiv.appendChild(valueInput);
        fieldDiv.appendChild(deleteBtn);
        
        dataFieldsContainer.appendChild(fieldDiv);
    };

    /**
     * 保存当前配置文件的数据
     */
    const saveCurrentData = async () => {
        if (!currentProfileName) return;

        // 收集所有字段的数据
        const fields = dataFieldsContainer.querySelectorAll('.field');
        const data = {};
        fields.forEach(field => {
            const keyInput = field.querySelector('.key-input');
            const valueInput = field.querySelector('.value-input');
            const key = keyInput.value.trim();
            const value = valueInput.value;
            
            // 只保存键不为空的字段
            if (key) {
                data[key] = value;
            }
        });

        try {
            // 调用主进程保存数据
            const result = await window.api.saveProfileData(currentProfileName, data);
            if (!result.success) {
                console.error('保存失败:', result.error);
                // 可以在这里添加用户友好的错误提示
            }
        } catch (error) {
            console.error('保存数据时出错:', error);
            // 可以在这里添加用户友好的错误提示
        }
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
        serverPort = port;
        updateVmixUrl();
    });

    // 配置文件选择变化
    profileSelect.addEventListener('change', handleProfileChange);

    // 新建配置文件按钮
    newProfileBtn.addEventListener('click', createNewProfile);

    // 删除配置文件按钮
    deleteProfileBtn.addEventListener('click', deleteCurrentProfile);

    // 添加字段按钮
    addFieldBtn.addEventListener('click', () => {
        if (currentProfileName) {
            createFieldInput();
        }
    });

    // --- 初始化 ---
    loadProfiles();
});