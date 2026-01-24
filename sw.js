// Enhanced Service Worker for background notifications
const CACHE_NAME = 'map-tracker-marker-press-20240927';
const urlsToCache = [
    '/',
    '/index.html',
    '/script.js',
    '/styles.css',
    '/sw.js'
];

// Install event - 立即激活新版本
self.addEventListener('install', function(event) {
    console.log('Service Worker installing...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(function(cache) {
                return cache.addAll(urlsToCache);
            })
            .then(function() {
                return self.skipWaiting(); // 立即激活
            })
    );
});

// Activate event - 清理舊緩存
self.addEventListener('activate', function(event) {
    console.log('Service Worker activating...');
    event.waitUntil(
        caches.keys().then(function(cacheNames) {
            return Promise.all(
                cacheNames.map(function(cacheName) {
                    if (cacheName !== CACHE_NAME) {
                        console.log('Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(function() {
            return self.clients.claim(); // 立即控制所有頁面
        })
    );
});

// Fetch event
self.addEventListener('fetch', function(event) {
    event.respondWith(
        caches.match(event.request)
            .then(function(response) {
                // Return cached version or fetch from network
                return response || fetch(event.request);
            }
        )
    );
});

// Message event - 處理來自主線程的消息
self.addEventListener('message', function(event) {
    console.log('Service Worker received message:', event.data);
    
    if (event.data && event.data.type === 'LOCATION_ALERT') {
        const { title, body, data } = event.data;
        showLocationNotification(title, body, data);
    }
    
    if (event.data && event.data.type === 'KEEP_ALIVE') {
        // 保持Service Worker活躍
        console.log('Service Worker keep alive signal received');
    }
    
    if (event.data && event.data.type === 'BACKGROUND_LOCATION_CHECK') {
        // 處理後台位置檢查
        console.log('Service Worker background location check:', event.data);
        
        // 如果有追蹤目標和當前位置，進行距離計算
        if (event.data.trackingTarget && event.data.currentPosition) {
            const target = event.data.trackingTarget;
            const current = event.data.currentPosition;
            
            // 計算距離（使用 Haversine 公式）
            const distance = calculateDistance(
                current.lat, current.lng,
                target.lat, target.lng
            );
            
            // 如果在提醒範圍內，顯示通知
            if (distance <= 100) { // 預設100公尺範圍
                showLocationNotification(target, distance);
            }
        }
    }
});

// 距離計算函數（Haversine 公式）
function calculateDistance(lat1, lng1, lat2, lng2) {
    const R = 6371000; // 地球半徑（公尺）
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// Push event for notifications
self.addEventListener('push', function(event) {
    let notificationData = {
        title: '位置提醒',
        body: '您有新的位置提醒',
        data: {}
    };
    
    if (event.data) {
        try {
            notificationData = event.data.json();
        } catch (e) {
            notificationData.body = event.data.text();
        }
    }
    
    event.waitUntil(
        showLocationNotification(notificationData.title, notificationData.body, notificationData.data)
    );
});

// 通知去重緩存
const notificationCache = new Map();
const NOTIFICATION_COOLDOWN = 30000; // 30秒冷卻時間

// 顯示位置通知的統一函數
function showLocationNotification(title, body, data = {}) {
    const notificationKey = data.markerId || 'default';
    const currentTime = Date.now();
    
    // 檢查通知冷卻時間，防止重複通知
    const lastNotificationTime = notificationCache.get(notificationKey);
    if (lastNotificationTime && (currentTime - lastNotificationTime) < NOTIFICATION_COOLDOWN) {
        console.log(`通知被跳過，標記點 ${notificationKey} 仍在冷卻期內`);
        return Promise.resolve();
    }
    
    // 更新通知時間
    notificationCache.set(notificationKey, currentTime);
    
    // 清理過期的緩存項目
    for (const [key, time] of notificationCache.entries()) {
        if (currentTime - time > NOTIFICATION_COOLDOWN * 2) {
            notificationCache.delete(key);
        }
    }
    
    const options = {
        body: body,
        icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23ff4444"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>',
        badge: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23ff4444"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>',
        vibrate: [200, 100, 200, 100, 200],
        tag: data.tag || `location-alert-${notificationKey}`,
        requireInteraction: true,
        silent: false,
        timestamp: currentTime,
        data: {
            ...data,
            notificationTime: currentTime
        },
        actions: [
            {
                action: 'view',
                title: '查看位置',
                icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23007AFF"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>'
            },
            {
                action: 'dismiss',
                title: '關閉',
                icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23666"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>'
            }
        ]
    };
    
    console.log(`顯示通知：${title} - ${body}`);
    
    // 嘗試通知主應用播放音效
    try {
        self.clients.matchAll().then(clients => {
            clients.forEach(client => {
                client.postMessage({
                    type: 'PLAY_NOTIFICATION_SOUND',
                    data: {
                        soundType: 'notification',
                        title: title,
                        body: body
                    }
                });
            });
        });
    } catch (error) {
        console.warn('無法發送音效播放消息:', error);
    }
    
    return self.registration.showNotification(title, options);
}

// Notification click event - 增強版
self.addEventListener('notificationclick', function(event) {
    console.log('Notification clicked:', event.notification.tag, event.action);
    
    event.notification.close();
    
    if (event.action === 'dismiss') {
        return; // 只關閉通知
    }
    
    // 處理查看位置或默認點擊
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then(function(clientList) {
                // 嘗試聚焦到現有窗口
                for (let i = 0; i < clientList.length; i++) {
                    const client = clientList[i];
                    if (client.url.includes(self.location.origin)) {
                        // 發送消息給主頁面
                        if (event.notification.data && event.notification.data.markerId) {
                            client.postMessage({
                                type: 'FOCUS_MARKER',
                                markerId: event.notification.data.markerId
                            });
                        }
                        return client.focus();
                    }
                }
                // 如果沒有現有窗口，打開新窗口
                return clients.openWindow('/');
            })
    );
});

// Background sync event (如果支援)
self.addEventListener('sync', function(event) {
    console.log('Background sync triggered:', event.tag);
    
    if (event.tag === 'location-check') {
        event.waitUntil(
            // 執行背景位置檢查
            performBackgroundLocationCheck()
        );
    }
});

// 背景位置檢查函數
function performBackgroundLocationCheck() {
    return new Promise((resolve) => {
        // 向所有客戶端發送位置檢查請求
        self.clients.matchAll().then(clients => {
            clients.forEach(client => {
                client.postMessage({
                    type: 'BACKGROUND_LOCATION_CHECK'
                });
            });
            resolve();
        });
    });
}

// 定期保持Service Worker活躍
setInterval(() => {
    console.log('Service Worker heartbeat:', new Date().toISOString());
}, 30000); // 每30秒一次心跳