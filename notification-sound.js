// 通知音效生成器
class NotificationSound {
    constructor() {
        this.audioContext = null;
        this.isEnabled = true;
        this.volume = 0.5;
        this.initAudioContext();
    }

    // 初始化音頻上下文
    initAudioContext() {
        try {
            // 創建音頻上下文
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        } catch (error) {
            console.warn('音頻上下文初始化失敗:', error);
            this.audioContext = null;
        }
    }

    // 確保音頻上下文已啟動
    async ensureAudioContext() {
        if (!this.audioContext) {
            this.initAudioContext();
        }

        if (this.audioContext && this.audioContext.state === 'suspended') {
            try {
                await this.audioContext.resume();
            } catch (error) {
                console.warn('音頻上下文恢復失敗:', error);
            }
        }
    }

    // 播放通知音效
    async playNotificationSound() {
        if (!this.isEnabled || !this.audioContext) {
            return;
        }

        try {
            await this.ensureAudioContext();
            
            // 創建音效序列：三聲短促的提示音
            const frequencies = [800, 1000, 800]; // 頻率序列
            const duration = 0.15; // 每個音的持續時間
            const gap = 0.1; // 音之間的間隔

            for (let i = 0; i < frequencies.length; i++) {
                const startTime = this.audioContext.currentTime + (i * (duration + gap));
                this.playTone(frequencies[i], duration, startTime);
            }
        } catch (error) {
            console.warn('播放通知音效失敗:', error);
        }
    }

    // 播放單個音調
    playTone(frequency, duration, startTime) {
        if (!this.audioContext) return;

        // 創建振盪器
        const oscillator = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();

        // 設定音調類型和頻率
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(frequency, startTime);

        // 設定音量包絡（淡入淡出效果）
        gainNode.gain.setValueAtTime(0, startTime);
        gainNode.gain.linearRampToValueAtTime(this.volume, startTime + 0.01);
        gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + duration);

        // 連接音頻節點
        oscillator.connect(gainNode);
        gainNode.connect(this.audioContext.destination);

        // 播放音效
        oscillator.start(startTime);
        oscillator.stop(startTime + duration);
    }

    // 播放成功音效（較高音調）
    async playSuccessSound() {
        if (!this.isEnabled || !this.audioContext) {
            return;
        }

        try {
            await this.ensureAudioContext();
            
            const frequencies = [523, 659, 784]; // C5, E5, G5 和弦
            const duration = 0.3;

            for (let i = 0; i < frequencies.length; i++) {
                const startTime = this.audioContext.currentTime + (i * 0.1);
                this.playTone(frequencies[i], duration, startTime);
            }
        } catch (error) {
            console.warn('播放成功音效失敗:', error);
        }
    }

    // 播放警告音效（較低音調）
    async playWarningSound() {
        if (!this.isEnabled || !this.audioContext) {
            return;
        }

        try {
            await this.ensureAudioContext();
            
            const frequencies = [400, 300, 400, 300]; // 交替低音
            const duration = 0.2;

            for (let i = 0; i < frequencies.length; i++) {
                const startTime = this.audioContext.currentTime + (i * 0.25);
                this.playTone(frequencies[i], duration, startTime);
            }
        } catch (error) {
            console.warn('播放警告音效失敗:', error);
        }
    }

    // 設定音效開關
    setEnabled(enabled) {
        this.isEnabled = enabled;
        try { if (typeof appStorageSet === 'function') appStorageSet('notificationSoundEnabled', enabled); } catch (e) {}
        try { localStorage.setItem('notificationSoundEnabled', enabled.toString()); } catch (_) {}
    }

    // 設定音量
    setVolume(volume) {
        this.volume = Math.max(0, Math.min(1, volume));
        try { if (typeof appStorageSet === 'function') appStorageSet('notificationSoundVolume', this.volume); } catch (e) {}
        try { localStorage.setItem('notificationSoundVolume', this.volume.toString()); } catch (_) {}
    }

    // 從本地存儲載入設定
    async loadSettings() {
        // 先嘗試同步快取，確保初始行為
        try {
            const savedEnabled = localStorage.getItem('notificationSoundEnabled');
            if (savedEnabled !== null) this.isEnabled = savedEnabled === 'true';
            const savedVolume = localStorage.getItem('notificationSoundVolume');
            if (savedVolume !== null) this.volume = parseFloat(savedVolume);
        } catch (_) {}

        // 再非同步讀取主存（IndexedDB）
        try {
            if (typeof appStorageGet === 'function') {
                const [enabled, volume] = await Promise.all([
                    appStorageGet('notificationSoundEnabled'),
                    appStorageGet('notificationSoundVolume')
                ]);
                if (typeof enabled === 'boolean') this.isEnabled = enabled;
                if (typeof volume === 'number' && !isNaN(volume)) this.volume = Math.max(0, Math.min(1, volume));
            }
        } catch (e) { /* 忽略，保留快取結果 */ }
    }

    // 測試音效
    async testSound() {
        console.log('測試通知音效...');
        await this.playNotificationSound();
    }
}

// 創建全域音效實例
window.notificationSound = new NotificationSound();

// 載入保存的設定
window.notificationSound.loadSettings();

// 導出供其他模組使用
if (typeof module !== 'undefined' && module.exports) {
    module.exports = NotificationSound;
}