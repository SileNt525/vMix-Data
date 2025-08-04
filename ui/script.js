/**
 * script.js (最终修复版 - 使用自定义编辑窗口)
 * 修复要点:
 * 1. [编辑功能重做] 彻底放弃不稳定的 `prompt`，改用自定义的HTML模态对话框 (`edit-item-modal`) 来实现编辑功能。这提供了更可靠、更友好的用户体验。
 * 2. [状态追踪] 引入了 `keyBeingEdited` 变量来追踪当前正在编辑的数据项，确保保存时能正确更新。
 * 3. [逻辑完善] 完善了整个数据操作（增、删、改）的流程，全部统一到 `saveDataAndUpdateUI` 函数，保证了数据状态的一致性。
 */
document.addEventListener('DOMContentLoaded', () => {
    // === UI元素 ===
    const profileSelect = document.getElementById('profile-select');
    const newProfileBtn = document.getElementById('new-profile-btn');
    const deleteProfileBtn = document.getElementById('delete-profile-btn');
    const vmixUrlInput = document.getElementById('vmix-url');
    const currentProfileTitle = document.getElementById('current-profile-title');
    const addItemForm = document.getElementById('add-item-form');
    const itemNameInput = document.getElementById('item-name');
    const itemValueInput = document.getElementById('item-value');
    const dataManagerSection = document.querySelector('.data-manager');
    
    // 新建配置模态框
    const newProfileModal = document.getElementById('new-profile-modal');
    const newProfileForm = document.getElementById('new-profile-form');
    const newProfileNameInput = document.getElementById('new-profile-name-input');
    const modalCancelBtn = document.getElementById('modal-cancel-btn');

    // [新增] 编辑数据项模态框
    const editItemModal = document.getElementById('edit-item-modal');
    const editItemForm = document.getElementById('edit-item-form');
    const editItemNameInput = document.getElementById('edit-item-name-input');
    const editItemValueInput = document.getElementById('edit-item-value-input');
    const editModalCancelBtn = document.getElementById('edit-modal-cancel-btn');


    // === 全局状态 ===
    let serverPort = null;
    let currentProfileName = null;
    let currentData = {};
    let keyBeingEdited = null; // [新增] 用于追踪正在编辑的键

    // === 辅助函数 ===
    const updateVmixUrl = () => {
        if (serverPort && currentProfileName) {
            const url = `http://127.0.0.1:${serverPort}/api/data/${currentProfileName}`;
            vmixUrlInput.value = url;
            vmixUrlInput.title = `远程访问: http://<本机IP>:${serverPort}/api/data/${currentProfileName}?api_key=vmix-default-api-key`;
        } else {
            vmixUrlInput.value = '请选择或创建一个配置文件';
            vmixUrlInput.title = '';
        }
    };
    
    const renderDataItems = () => {
        const dataItemsContainer = document.getElementById('data-items-container');
        dataItemsContainer.innerHTML = '';
        if (!currentData || Object.keys(currentData).length === 0) {
            dataItemsContainer.innerHTML = '<p class="placeholder">此配置为空，请添加新数据项。</p>';
        } else {
            for (const [key, value] of Object.entries(currentData)) {
                const itemDiv = document.createElement('div');
                itemDiv.className = 'data-item';
                itemDiv.innerHTML = `<div class="data-item-info"><div class="data-item-name">${key}</div><div class="data-item-value">${value || ''}</div></div><div class="data-item-actions"><button class="edit-btn">编辑</button><button class="delete-btn">删除</button></div>`;
                itemDiv.querySelector('.edit-btn').addEventListener('click', () => editDataItem(key));
                itemDiv.querySelector('.delete-btn').addEventListener('click', () => deleteDataItem(key));
                dataItemsContainer.appendChild(itemDiv);
            }
        }
    };
    
    const updateUIForProfile = (profileData) => {
        currentData = profileData || {};
        const vmixFormatData = Object.entries(currentData).map(([key, value]) => ({ key, value }));
        document.getElementById('json-preview-content').textContent = JSON.stringify(vmixFormatData, null, 2);
        renderDataItems();
        updateVmixUrl();
    };

    // === 核心逻辑 ===
    const loadProfiles = async (selectProfileName = null) => {
        const result = await window.api.getProfiles();
        if (result.success) {
            const profiles = result.data;
            const currentSelection = selectProfileName || profileSelect.value || (profiles[0] || null);
            profileSelect.innerHTML = '<option value="">-- 选择一个配置 --</option>';
            profiles.forEach(p => {
                const option = document.createElement('option');
                option.value = p;
                option.textContent = p;
                profileSelect.appendChild(option);
            });
            profileSelect.value = profiles.includes(currentSelection) ? currentSelection : '';
            await handleProfileChange();
        }
    };

    const handleProfileChange = async () => {
        currentProfileName = profileSelect.value;
        const controlsVisible = !!currentProfileName;
        deleteProfileBtn.disabled = !controlsVisible;
        dataManagerSection.classList.toggle('hidden', !controlsVisible);

        if (!currentProfileName) {
            currentProfileTitle.textContent = '数据项管理';
            updateUIForProfile({});
        } else {
            currentProfileTitle.textContent = `编辑: ${currentProfileName}`;
            const result = await window.api.getProfileData(currentProfileName);
            updateUIForProfile(result.success ? result.data.items : {});
        }
    };
    
    const saveDataAndUpdateUI = async () => {
        if (!currentProfileName) return;
        const result = await window.api.saveProfileData(currentProfileName, currentData);
        if (result.success) {
            updateUIForProfile(currentData);
        } else {
            alert(`保存失败: ${result.error}`);
            await handleProfileChange();
        }
    };

    const addDataItem = async (key, value) => {
        if (currentData.hasOwnProperty(key)) return alert('该数据名称已存在。');
        currentData[key] = value;
        await saveDataAndUpdateUI();
    };

    // [重做] 编辑功能，不再使用 prompt
    const editDataItem = (key) => {
        keyBeingEdited = key;
        editItemNameInput.value = key;
        editItemValueInput.value = currentData[key];
        editItemModal.classList.remove('hidden');
        editItemValueInput.focus();
        editItemValueInput.select();
    };

    const deleteDataItem = async (key) => {
        if (!confirm(`确定要删除数据项 "${key}" 吗？`)) return;
        delete currentData[key];
        await saveDataAndUpdateUI();
    };

    const deleteCurrentProfile = async () => {
        if (!currentProfileName || !confirm(`确定要删除配置文件 "${currentProfileName}" 吗？此操作不可撤销。`)) return;
        const result = await window.api.deleteProfile(currentProfileName);
        if (result.success) {
            await loadProfiles();
        } else {
            alert(`删除失败: ${result.error}`);
        }
    };

    // === 事件监听器 ===
    window.api.onServerStarted((port) => {
        serverPort = port;
        const indicator = document.getElementById('connection-status');
        indicator.className = 'status-connected';
        indicator.textContent = '已连接';
        updateVmixUrl();
    });

    profileSelect.addEventListener('change', handleProfileChange);
    newProfileBtn.addEventListener('click', () => {
        newProfileNameInput.value = '';
        newProfileModal.classList.remove('hidden');
        newProfileNameInput.focus();
    });
    deleteProfileBtn.addEventListener('click', deleteCurrentProfile);
    
    addItemForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const key = itemNameInput.value.trim();
        const value = itemValueInput.value;
        if (!key) return alert('数据名称不能为空。');
        await addDataItem(key, value);
        itemNameInput.value = '';
        itemValueInput.value = '';
        itemNameInput.focus();
    });

    // 新建配置模态框事件
    newProfileForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const profileName = newProfileNameInput.value.trim();
        if (!profileName) return;
        if (!/^[a-zA-Z0-9_-]+$/.test(profileName)) return alert('配置文件名只能包含字母、数字、下划线和连字符。');
        if (Array.from(profileSelect.options).some(opt => opt.value === profileName)) return alert('该配置文件名称已存在。');
        
        newProfileModal.classList.add('hidden');
        await window.api.saveProfileData(profileName, {});
        await loadProfiles(profileName);
    });
    
    modalCancelBtn.addEventListener('click', () => newProfileModal.classList.add('hidden'));

    // [新增] 编辑数据项模态框事件
    editItemForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const newValue = editItemValueInput.value;
        if (keyBeingEdited) {
            currentData[keyBeingEdited] = newValue;
            await saveDataAndUpdateUI();
        }
        editItemModal.classList.add('hidden');
        keyBeingEdited = null;
    });

    editModalCancelBtn.addEventListener('click', () => {
        editItemModal.classList.add('hidden');
        keyBeingEdited = null;
    });

    // === 初始加载 ===
    loadProfiles();
});