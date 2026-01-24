// Android 整合功能
// 此檔案處理 Cordova/Capacitor 的設備功能和權限

// 導入 Capacitor 插件
let CapacitorGeolocation = null;
let CapacitorLocalNotifications = null;
let CapacitorHaptics = null;

// 初始化 Capacitor 插件
if (window.Capacitor) {
    try {
        // 嘗試從全局 Capacitor 對象獲取插件
        if (window.Capacitor.Plugins) {
            CapacitorGeolocation = window.Capacitor.Plugins.Geolocation;
            CapacitorLocalNotifications = window.Capacitor.Plugins.LocalNotifications;
            CapacitorHaptics = window.Capacitor.Plugins.Haptics;
            console.log('Capacitor 插件已從全局對象載入');
        }
        
        // 如果全局對象不可用，嘗試動態導入
        if (!CapacitorGeolocation || !CapacitorLocalNotifications || !CapacitorHaptics) {
            console.log('嘗試動態載入 Capacitor 插件...');
            
            import('@capacitor/geolocation').then(module => {
                CapacitorGeolocation = module.Geolocation;
                console.log('Capacitor Geolocation 插件已載入');
            }).catch(err => {
                console.warn('無法載入 Capacitor Geolocation 插件:', err);
            });

            import('@capacitor/local-notifications').then(module => {
                CapacitorLocalNotifications = module.LocalNotifications;
                console.log('Capacitor LocalNotifications 插件已載入');
            }).catch(err => {
                console.warn('無法載入 Capacitor LocalNotifications 插件:', err);
            });

            import('@capacitor/haptics').then(module => {
                CapacitorHaptics = module.Haptics;
                console.log('Capacitor Haptics 插件已載入');
            }).catch(err => {
                console.warn('無法載入 Capacitor Haptics 插件:', err);
            });
        }
    } catch (error) {
        console.error('Capacitor 插件初始化失敗:', error);
    }
}

// 檢測運行環境
function isAndroidApp() {
    return window.cordova || window.Capacitor || (window.device && window.device.platform === 'Android');
}

// 檢測是否為 Capacitor 環境
function isCapacitor() {
    return window.Capacitor !== undefined;
}

// 檢測是否為 Cordova 環境
function isCordova() {
    return window.cordova !== undefined;
}

// Android 權限管理
class AndroidPermissions {
    static async requestLocationPermission() {
        if (!isAndroidApp()) {
            return true; // 網頁版本使用瀏覽器權限
        }

        try {
            if (isCapacitor() && CapacitorGeolocation) {
                // Capacitor 權限處理
                const permission = await CapacitorGeolocation.requestPermissions();
                return permission.location === 'granted';
            } else if (isCordova() && window.cordova.plugins && window.cordova.plugins.permissions) {
                // Cordova 權限處理
                return new Promise((resolve) => {
                    const permissions = window.cordova.plugins.permissions;
                    
                    permissions.hasPermission(permissions.ACCESS_FINE_LOCATION, (status) => {
                        if (status.hasPermission) {
                            resolve(true);
                        } else {
                            permissions.requestPermission(
                                permissions.ACCESS_FINE_LOCATION,
                                (success) => resolve(success.hasPermission),
                                () => resolve(false)
                            );
                        }
                    });
                });
            }
        } catch (error) {
            console.error('權限請求失敗:', error);
            return false;
        }
        
        return true;
    }

    static async requestNotificationPermission() {
        console.log('AndroidPermissions.requestNotificationPermission 被調用');
        
        if (!isAndroidApp()) {
            console.log('非Android環境，使用瀏覽器權限');
            // 網頁版本使用瀏覽器權限
            if ('Notification' in window && typeof Notification !== 'undefined') {
                try {
                    if (Notification.permission === 'granted') {
                        console.log('通知權限已授予');
                        return true;
                    } else if (Notification.permission !== 'denied') {
                        console.log('請求通知權限...');
                        const permission = await Notification.requestPermission();
                        console.log('通知權限結果:', permission);
                        return permission === 'granted';
                    } else {
                        console.log('通知權限被拒絕');
                        return false;
                    }
                } catch (error) {
                    console.error('請求通知權限時發生錯誤:', error);
                    return false;
                }
            } else {
                console.warn('瀏覽器不支援通知功能');
                return false;
            }
        }

        try {
            if (isCapacitor() && CapacitorLocalNotifications) {
                console.log('使用 Capacitor LocalNotifications 請求權限');
                const permission = await CapacitorLocalNotifications.requestPermissions();
                console.log('Capacitor 權限結果:', permission);
                return permission.display === 'granted';
            } else if (isCordova() && window.cordova.plugins && window.cordova.plugins.notification) {
                console.log('使用 Cordova 通知權限');
                return true;
            }
        } catch (error) {
            console.error('通知權限請求失敗:', error);
            return false;
        }
        
        return true;
    }

    // 請求背景通知權限
    static async requestBackgroundNotificationPermission() {
        console.log('AndroidPermissions.requestBackgroundNotificationPermission 被調用');
        
        if (!isAndroidApp()) {
            console.log('非Android環境，檢查Service Worker支援');
            // 網頁版本檢查Service Worker支援
            if ('serviceWorker' in navigator && 'Notification' in window) {
                const notificationPermission = await this.requestNotificationPermission();
                if (notificationPermission) {
                    // 註冊Service Worker以支援背景通知
                    try {
                        const registration = await navigator.serviceWorker.ready;
                        console.log('Service Worker已準備就緒，支援背景通知');
                        return true;
                    } catch (error) {
                        console.error('Service Worker註冊失敗:', error);
                        return false;
                    }
                }
            }
            return false;
        }

        try {
            // Android環境下請求背景通知權限
            const basicPermission = await this.requestNotificationPermission();
            if (!basicPermission) {
                return false;
            }

            // 對於Android 13+，需要額外的POST_NOTIFICATIONS權限
            if (isCapacitor() && window.CapacitorApp) {
                try {
                    const appInfo = await window.CapacitorApp.getInfo();
                    console.log('應用信息:', appInfo);
                    
                    // 檢查是否需要請求額外的背景權限
                    if (window.CapacitorDevice) {
                        const deviceInfo = await window.CapacitorDevice.getInfo();
                        console.log('設備信息:', deviceInfo);
                        
                        // Android 13+ (API 33+) 需要特殊處理
                        if (deviceInfo.androidSDKVersion >= 33) {
                            console.log('Android 13+，請求POST_NOTIFICATIONS權限');
                            // 這裡可以添加特定的權限請求邏輯
                        }
                    }
                } catch (error) {
                    console.warn('無法獲取應用或設備信息:', error);
                }
            }

            return true;
        } catch (error) {
            console.error('背景通知權限請求失敗:', error);
            return false;
        }
    }
}

// Android 定位服務
class AndroidGeolocation {
    static getCurrentPosition(options = {}) {
        const defaultOptions = {
            enableHighAccuracy: true,
            timeout: 30000,
            maximumAge: 0
        };
        
        const finalOptions = { ...defaultOptions, ...options };

        return new Promise((resolve, reject) => {
            if (isCapacitor() && CapacitorGeolocation) {
                // 使用 Capacitor Geolocation
                CapacitorGeolocation.getCurrentPosition(finalOptions)
                    .then(position => {
                        resolve({
                            coords: {
                                latitude: position.coords.latitude,
                                longitude: position.coords.longitude,
                                accuracy: position.coords.accuracy,
                                altitude: position.coords.altitude,
                                altitudeAccuracy: position.coords.altitudeAccuracy,
                                heading: position.coords.heading,
                                speed: position.coords.speed
                            },
                            timestamp: position.timestamp
                        });
                    })
                    .catch(reject);
            } else {
                // 使用標準 Geolocation API
                navigator.geolocation.getCurrentPosition(resolve, reject, finalOptions);
            }
        });
    }

    static watchPosition(successCallback, errorCallback, options = {}) {
        const defaultOptions = {
            enableHighAccuracy: true,
            timeout: 30000,
            maximumAge: 5000
        };
        
        const finalOptions = { ...defaultOptions, ...options };

        if (isCapacitor() && CapacitorGeolocation) {
            return CapacitorGeolocation.watchPosition(finalOptions, (position, err) => {
                if (err) {
                    errorCallback(err);
                } else {
                    successCallback({
                        coords: {
                            latitude: position.coords.latitude,
                            longitude: position.coords.longitude,
                            accuracy: position.coords.accuracy,
                            altitude: position.coords.altitude,
                            altitudeAccuracy: position.coords.altitudeAccuracy,
                            heading: position.coords.heading,
                            speed: position.coords.speed
                        },
                        timestamp: position.timestamp
                    });
                }
            });
        } else {
            return navigator.geolocation.watchPosition(successCallback, errorCallback, finalOptions);
        }
    }

    static clearWatch(watchId) {
        if (isCapacitor() && CapacitorGeolocation) {
            CapacitorGeolocation.clearWatch({ id: watchId });
        } else {
            navigator.geolocation.clearWatch(watchId);
        }
    }
}

// Android 通知服務
class AndroidNotifications {
    static async showNotification(title, body, options = {}) {
        console.log('AndroidNotifications.showNotification 被調用:', { title, body, options });
        
        if (!isAndroidApp()) {
            // 網頁版本使用瀏覽器通知
            if ('Notification' in window && Notification.permission === 'granted') {
                try {
                    const notification = new Notification(title, { 
                        body, 
                        icon: options.icon || '/icon-192x192.png',
                        vibrate: options.vibrate || [200, 100, 200],
                        tag: options.tag || 'default',
                        ...options 
                    });
                    
                    // 添加點擊事件處理
                    if (options.onclick) {
                        notification.onclick = options.onclick;
                    }
                    
                    return notification;
                } catch (error) {
                    console.error('瀏覽器通知創建失敗:', error);
                    return null;
                }
            }
            console.warn('瀏覽器通知不可用，權限狀態:', Notification.permission);
            return null;
        }

        try {
            if (isCapacitor()) {
                // 優先使用我們初始化的插件變量
                let LocalNotifications = CapacitorLocalNotifications;
                
                // 如果變量不可用，嘗試從全局對象獲取
                if (!LocalNotifications && window.Capacitor && window.Capacitor.Plugins) {
                    LocalNotifications = window.Capacitor.Plugins.LocalNotifications;
                }
                
                if (LocalNotifications) {
                    console.log('使用 Capacitor LocalNotifications 發送通知');
                    
                    const notificationId = Date.now();
                    await LocalNotifications.schedule({
                        notifications: [{
                            title: title,
                            body: body,
                            id: notificationId,
                            schedule: { at: new Date(Date.now() + 100) }, // 立即顯示
                            sound: options.sound || null,
                            attachments: options.attachments || null,
                            actionTypeId: options.actionTypeId || "",
                            extra: options.extra || null,
                            smallIcon: options.smallIcon || "ic_stat_icon_config_sample",
                            iconColor: options.iconColor || "#488AFF"
                        }]
                    });
                    
                    console.log('Capacitor 通知已排程:', notificationId);
                    return { id: notificationId };
                } else {
                    console.warn('Capacitor LocalNotifications 插件不可用');
                    return null;
                }
            } else if (isCordova() && window.cordova.plugins && window.cordova.plugins.notification && window.cordova.plugins.notification.local) {
                const notificationId = Date.now();
                window.cordova.plugins.notification.local.schedule({
                    id: notificationId,
                    title: title,
                    text: body,
                    foreground: true,
                    vibrate: true,
                    ...options
                });
                
                console.log('Cordova 通知已排程:', notificationId);
                return { id: notificationId };
            } else {
                console.warn('沒有可用的原生通知插件');
                return null;
            }
        } catch (error) {
            console.error('原生通知發送失敗:', error);
            return null;
        }
    }
}

// Android 設備功能
class AndroidDevice {
    static async vibrate(duration = 200) {
        console.log('AndroidDevice.vibrate 被調用:', { duration, isAndroidApp: isAndroidApp() });
        
        if (!isAndroidApp()) {
            // 網頁版本使用瀏覽器震動
            if ('vibrate' in navigator) {
                try {
                    if (Array.isArray(duration)) {
                        navigator.vibrate(duration);
                    } else {
                        navigator.vibrate([duration]);
                    }
                    console.log('瀏覽器震動已觸發:', duration);
                    return true;
                } catch (error) {
                    console.error('瀏覽器震動失敗:', error);
                    return false;
                }
            }
            return false;
        }

        try {
            if (isCapacitor() && CapacitorHaptics) {
                // 使用 Capacitor Haptics 插件
                if (Array.isArray(duration)) {
                    // 複雜震動模式 - 使用多次impact
                    for (let i = 0; i < duration.length; i += 2) {
                        if (duration[i] > 0) {
                            await CapacitorHaptics.impact({ style: 'MEDIUM' });
                        }
                        if (duration[i + 1] && i + 1 < duration.length) {
                            await new Promise(resolve => setTimeout(resolve, duration[i + 1]));
                        }
                    }
                } else {
                    // 簡單震動
                    await CapacitorHaptics.impact({ style: 'MEDIUM' });
                }
                
                console.log('Capacitor 震動已執行:', duration);
                return true;
            } else if (isCordova() && window.navigator.vibrate) {
                // Cordova 震動
                if (Array.isArray(duration)) {
                    window.navigator.vibrate(duration);
                } else {
                    window.navigator.vibrate([duration]);
                }
                
                console.log('Cordova 震動已執行:', duration);
                return true;
            } else {
                // 回退到標準震動API
                if ('vibrate' in navigator) {
                    const pattern = Array.isArray(duration) ? duration : [duration];
                    navigator.vibrate(pattern);
                    console.log('標準震動API已觸發:', pattern);
                    return true;
                }
            }
        } catch (error) {
            console.error('Android 震動失敗:', error);
            
            // 最後回退嘗試
            try {
                if ('vibrate' in navigator) {
                    const pattern = Array.isArray(duration) ? duration : [duration];
                    navigator.vibrate(pattern);
                    console.log('回退震動API已觸發:', pattern);
                    return true;
                }
            } catch (fallbackError) {
                console.error('回退震動也失敗:', fallbackError);
            }
            
            return false;
        }
        
        console.warn('設備不支援震動功能');
        return false;
    }

    static getDeviceInfo() {
        if (isCapacitor()) {
            const { Device } = window.Capacitor.Plugins;
            return Device.getInfo();
        } else if (isCordova() && window.device) {
            return Promise.resolve({
                model: window.device.model,
                platform: window.device.platform,
                uuid: window.device.uuid,
                version: window.device.version,
                manufacturer: window.device.manufacturer,
                isVirtual: window.device.isVirtual,
                serial: window.device.serial
            });
        }
        return Promise.resolve({
            platform: 'web',
            model: 'Unknown',
            version: 'Unknown'
        });
    }

    static async keepAwake() {
        if (isCapacitor()) {
            try {
                const { KeepAwake } = window.Capacitor.Plugins;
                await KeepAwake.keepAwake();
            } catch (error) {
                console.warn('Keep awake not available:', error);
            }
        } else if (isCordova() && window.plugins && window.plugins.insomnia) {
            window.plugins.insomnia.keepAwake();
        }
    }

    static async allowSleep() {
        if (isCapacitor()) {
            try {
                const { KeepAwake } = window.Capacitor.Plugins;
                await KeepAwake.allowSleep();
            } catch (error) {
                console.warn('Allow sleep not available:', error);
            }
        } else if (isCordova() && window.plugins && window.plugins.insomnia) {
            window.plugins.insomnia.allowSleepAgain();
        }
    }
}

// 背景模式管理
class AndroidBackgroundMode {
    static enable() {
        if (isCordova() && window.cordova.plugins && window.cordova.plugins.backgroundMode) {
            window.cordova.plugins.backgroundMode.enable();
        }
    }

    static disable() {
        if (isCordova() && window.cordova.plugins && window.cordova.plugins.backgroundMode) {
            window.cordova.plugins.backgroundMode.disable();
        }
    }

    static setDefaults(options) {
        if (isCordova() && window.cordova.plugins && window.cordova.plugins.backgroundMode) {
            window.cordova.plugins.backgroundMode.setDefaults(options);
        }
    }
}

// 初始化 Android 整合
function initAndroidIntegration() {
    console.log('初始化 Android 整合...');
    
    // 檢測環境
    console.log('運行環境:', {
        isAndroidApp: isAndroidApp(),
        isCapacitor: isCapacitor(),
        isCordova: isCordova(),
        userAgent: navigator.userAgent
    });

    // 設備就绪事件
    if (isAndroidApp()) {
        document.addEventListener('deviceready', onDeviceReady, false);
    } else {
        // 網頁版本直接初始化
        onDeviceReady();
    }
}

function onDeviceReady() {
    console.log('設備就绪');
    
    // 获取设备信息
    AndroidDevice.getDeviceInfo().then(info => {
        console.log('设备信息:', info);
    });

    // 设置背景模式（如果需要）
    if (isCordova()) {
        AndroidBackgroundMode.setDefaults({
            title: '地图标注系统',
            text: '正在后台运行',
            icon: 'icon',
            color: '2196F3',
            resume: true,
            hidden: false,
            bigText: false
        });
    }

    // 保持屏幕唤醒（在追踪模式下）
    if (window.isTracking) {
        AndroidDevice.keepAwake();
    }
}

// 覆盖原有的定位函数以使用 Android 整合
if (isAndroidApp()) {
    // 覆盖 getCurrentLocation 函数
    const originalGetCurrentLocation = window.getCurrentLocation;
    window.getCurrentLocation = async function() {
        try {
            // 先请求权限
            const hasPermission = await AndroidPermissions.requestLocationPermission();
            if (!hasPermission) {
                throw new Error('位置权限被拒绝');
            }

            // 使用 Android 定位服务
            const position = await AndroidGeolocation.getCurrentPosition();
            
            // 调用原有的处理逻辑
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            const accuracy = position.coords.accuracy;
            
            // 更新当前位置
            window.currentPosition = { 
                lat, 
                lng, 
                accuracy: accuracy,
                timestamp: Date.now()
            };
            
            // 更新当前位置标记
            if (window.updateCurrentLocationMarker) {
                window.updateCurrentLocationMarker();
            }
            
            // 居中地图
            if (window.centerMapToCurrentPosition) {
                window.centerMapToCurrentPosition(true, 16);
            }
            
            // 显示成功通知
            const accuracyText = accuracy ? `，精度: ±${Math.round(accuracy)}公尺` : '';
            if (window.showNotification) {
                window.showNotification(`🎯 已定位到您的位置${accuracyText}`, 'success');
            }
            
            console.log('Android 定位成功:', window.currentPosition);
            
        } catch (error) {
            console.error('Android 定位失败:', error);
            
            // 显示错误通知
            let errorMessage = '无法获取位置';
            if (error.message.includes('权限')) {
                errorMessage = '❌ 位置权限被拒绝。请在应用程式设置中允许位置存取。';
            } else {
                errorMessage = '📍 定位失败。请检查GPS是否开启。';
            }
            
            if (window.showNotification) {
                window.showNotification(errorMessage, 'error');
            }
        }
    };
}

// 导出到全域
window.AndroidPermissions = AndroidPermissions;
window.AndroidGeolocation = AndroidGeolocation;
window.AndroidNotifications = AndroidNotifications;
window.AndroidDevice = AndroidDevice;
window.AndroidBackgroundMode = AndroidBackgroundMode;
window.isAndroidApp = isAndroidApp;
window.isCapacitor = isCapacitor;
window.isCordova = isCordova;

// 自動初始化
initAndroidIntegration();