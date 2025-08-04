/**
 * script.js (Modern UI & UX Revamp)
 *
 * Key Improvements:
 * 1.  [Modern UI]: Card-based layout for data items.
 * 2.  [Rapid Editing]: Added '+' and '-' buttons for quick increment/decrement of numeric values.
 * 3.  [Inline Editing]: Data item names and values can be edited directly in place.
 * 4.  [UX Enhancements]: Cleaner layout, better feedback (e.g., copy confirmation), and a more intuitive workflow.
 * 5.  [Refactored Logic]: Code is reorganized for better readability and to support the new features.
 */
document.addEventListener('DOMContentLoaded', () => {
    // === UI Elements ===
    const profileSelect = document.getElementById('profile-select');
    const newProfileBtn = document.getElementById('new-profile-btn');
    const deleteProfileBtn = document.getElementById('delete-profile-btn');
    const vmixUrlInput = document.getElementById('vmix-url');
    const copyUrlBtn = document.getElementById('copy-url-btn');
    const connectionIndicator = document.getElementById('connection-indicator');
    const connectionText = document.getElementById('connection-text');
    const currentProfileTitle = document.getElementById('current-profile-title');
    const addItemForm = document.getElementById('add-item-form');
    const itemNameInput = document.getElementById('item-name');
    const itemValueInput = document.getElementById('item-value');
    const dataItemsContainer = document.getElementById('data-items-container');
    const welcomeMessage = document.getElementById('welcome-message');

    const newProfileModal = document.getElementById('new-profile-modal');
    const newProfileForm = document.getElementById('new-profile-form');
    const newProfileNameInput = document.getElementById('new-profile-name-input');
    const modalCancelBtn = document.getElementById('modal-cancel-btn');

    // === Global State ===
    let serverPort = null;
    let currentProfileName = null;
    let currentData = {};
    let debounceTimer = null;

    // === Helper Functions ===

    const updateVmixUrl = () => {
        if (serverPort && currentProfileName) {
            vmixUrlInput.value = `http://127.0.0.1:${serverPort}/api/data/${currentProfileName}`;
            copyUrlBtn.disabled = false;
        } else {
            vmixUrlInput.value = '';
            vmixUrlInput.placeholder = '选择一个配置以生成URL';
            copyUrlBtn.disabled = true;
        }
    };

    const renderDataItems = () => {
        dataItemsContainer.innerHTML = '';
        if (!currentData || Object.keys(currentData).length === 0) {
            dataItemsContainer.appendChild(welcomeMessage);
            welcomeMessage.classList.remove('hidden');
        } else {
            welcomeMessage.classList.add('hidden');
            Object.entries(currentData).forEach(([key, value]) => {
                const isNumeric = !isNaN(parseFloat(value)) && isFinite(value);
                const card = document.createElement('div');
                card.className = 'data-item-card';
                card.dataset.key = key;

                card.innerHTML = `
                    <div class="item-header">
                        <span class="item-name" contenteditable="true">${key}</span>
                        <button class="delete-btn" title="删除">&times;</button>
                    </div>
                    <div class="item-content">
                        ${isNumeric ? `
                        <div class="value-controls">
                            <button class="value-increment" title="增加 1">+</button>
                            <button class="value-decrement" title="减少 1">-</button>
                        </div>
                        ` : ''}
                        <div class="item-value" contenteditable="true">${value}</div>
                    </div>
                `;

                dataItemsContainer.appendChild(card);
            });
        }
    };
    
    // Debounced save function to prevent saving on every single keystroke
    const debouncedSave = (data) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            saveData(data);
        }, 300); // 300ms delay
    };

    const saveData = async (data) => {
        if (!currentProfileName) return;
        const result = await window.api.saveProfileData(currentProfileName, data);
        if (!result.success) {
            alert(`保存失败: ${result.error}`);
            // Optionally reload data to revert UI changes
            await handleProfileChange();
        }
    };
    
    // === Core Logic ===

    const loadProfiles = async (selectProfileName = null) => {
        const result = await window.api.getProfiles();
        if (result.success) {
            const profiles = result.data;
            const currentSelection = selectProfileName || profileSelect.value || (profiles.length > 0 ? profiles[0] : null);
            
            profileSelect.innerHTML = '';
            if (profiles.length === 0) {
                const option = document.createElement('option');
                option.textContent = '请新建一个配置';
                profileSelect.appendChild(option);
            } else {
                 profiles.forEach(p => {
                    const option = document.createElement('option');
                    option.value = p;
                    option.textContent = p;
                    profileSelect.appendChild(option);
                });
            }
           
            profileSelect.value = profiles.includes(currentSelection) ? currentSelection : '';
            await handleProfileChange();
        }
    };

    const handleProfileChange = async () => {
        currentProfileName = profileSelect.value;
        const hasProfile = !!currentProfileName && currentProfileName !== '请新建一个配置';
        
        deleteProfileBtn.disabled = !hasProfile;
        addItemForm.classList.toggle('hidden', !hasProfile);
        
        if (!hasProfile) {
            currentProfileTitle.textContent = '请选择或新建一个配置文件';
            currentData = {};
            renderDataItems();
        } else {
            currentProfileTitle.textContent = `当前配置: ${currentProfileName}`;
            const result = await window.api.getProfileData(currentProfileName);
            currentData = result.success ? result.data.items : {};
            renderDataItems();
        }
        updateVmixUrl();
    };

    // === Event Listeners ===

    // Server connection
    window.api.onServerStarted((port) => {
        serverPort = port;
        connectionIndicator.className = 'status-connected';
        connectionText.textContent = `已连接 (端口: ${port})`;
        updateVmixUrl();
    });

    // Profile management
    profileSelect.addEventListener('change', handleProfileChange);
    newProfileBtn.addEventListener('click', () => {
        newProfileNameInput.value = '';
        newProfileModal.classList.remove('hidden');
        newProfileNameInput.focus();
    });

    deleteProfileBtn.addEventListener('click', async () => {
        if (!currentProfileName || !confirm(`确定要删除配置文件 "${currentProfileName}" 吗？此操作不可撤销。`)) return;
        const result = await window.api.deleteProfile(currentProfileName);
        if (result.success) {
            await loadProfiles();
        } else {
            alert(`删除失败: ${result.error}`);
        }
    });

    // Add new data item
    addItemForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const key = itemNameInput.value.trim();
        const value = itemValueInput.value.trim();
        if (!key) {
            alert('数据名称不能为空。');
            return;
        }
        if (currentData.hasOwnProperty(key)) {
            alert('该数据名称已存在。');
            return;
        }

        currentData[key] = value;
        renderDataItems(); // Re-render immediately for better UX
        await saveData(currentData);

        itemNameInput.value = '';
        itemValueInput.value = '';
        itemNameInput.focus();
    });

    // Data item interactions (using event delegation)
    dataItemsContainer.addEventListener('click', async (e) => {
        const card = e.target.closest('.data-item-card');
        if (!card) return;
        const key = card.dataset.key;

        // Delete button
        if (e.target.classList.contains('delete-btn')) {
            if (confirm(`确定要删除数据项 "${key}" 吗？`)) {
                delete currentData[key];
                renderDataItems();
                await saveData(currentData);
            }
        }

        // Increment button
        if (e.target.classList.contains('value-increment')) {
            let value = parseFloat(currentData[key]);
            if (!isNaN(value)) {
                currentData[key] = value + 1;
                card.querySelector('.item-value').textContent = currentData[key];
                debouncedSave(currentData);
            }
        }
        
        // Decrement button
        if (e.target.classList.contains('value-decrement')) {
            let value = parseFloat(currentData[key]);
            if (!isNaN(value)) {
                currentData[key] = value - 1;
                card.querySelector('.item-value').textContent = currentData[key];
                debouncedSave(currentData);
            }
        }
    });

    dataItemsContainer.addEventListener('blur', async (e) => {
        const card = e.target.closest('.data-item-card');
        if (!card) return;

        const originalKey = card.dataset.key;
        const newKey = card.querySelector('.item-name').textContent.trim();
        const newValue = card.querySelector('.item-value').textContent.trim();
        
        let dataChanged = false;
        
        // Key change
        if (originalKey !== newKey) {
            if (!newKey) { // Prevent empty key
                card.querySelector('.item-name').textContent = originalKey;
                alert("数据名称不能为空。");
                return;
            }
            if (currentData.hasOwnProperty(newKey)) { // Prevent duplicate key
                 card.querySelector('.item-name').textContent = originalKey;
                 alert("该数据名称已存在。");
                 return;
            }
            // Create a new object with the new key order
            const newData = {};
            for (const k in currentData) {
                if (k === originalKey) {
                    newData[newKey] = currentData[originalKey];
                } else {
                    newData[k] = currentData[k];
                }
            }
            currentData = newData;
            card.dataset.key = newKey; // Update dataset
            dataChanged = true;
        }

        // Value change
        if (currentData[newKey] != newValue) {
            currentData[newKey] = newValue;
            dataChanged = true;
        }
        
        if (dataChanged) {
            // Re-render to apply numeric controls if needed
            renderDataItems(); 
            await saveData(currentData);
        }

    }, true); // Use capture phase to ensure blur event is caught reliably

    dataItemsContainer.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.target.classList.contains('item-name') || e.target.classList.contains('item-value'))) {
            e.preventDefault();
            e.target.blur(); // Trigger the blur event to save
        }
    });


    // Modal logic
    newProfileForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const profileName = newProfileNameInput.value.trim();
        if (Array.from(profileSelect.options).some(opt => opt.value === profileName)) {
            alert('该配置文件名称已存在。');
            return;
        }
        newProfileModal.classList.add('hidden');
        await window.api.saveProfileData(profileName, {});
        await loadProfiles(profileName);
    });
    
    modalCancelBtn.addEventListener('click', () => newProfileModal.classList.add('hidden'));

    // Copy URL
    copyUrlBtn.addEventListener('click', () => {
        vmixUrlInput.select();
        document.execCommand('copy');
        const originalText = copyUrlBtn.textContent;
        copyUrlBtn.textContent = '已复制!';
        setTimeout(() => {
            copyUrlBtn.textContent = originalText;
        }, 1500);
    });

    // === Initial Load ===
    loadProfiles();
});