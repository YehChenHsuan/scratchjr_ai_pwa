let deferredPrompt = null;
const listeners = new Set();
let isInstalled = false;

function notifyListeners () {
    listeners.forEach(cb => {
        try {
            cb();
        } catch (e) {
            // ignore listener errors
        }
    });
}

if (typeof window !== 'undefined') {
    window.addEventListener('beforeinstallprompt', e => {
        e.preventDefault();
        deferredPrompt = e;
        notifyListeners();
    });

    window.addEventListener('appinstalled', () => {
        deferredPrompt = null;
        isInstalled = true;
        notifyListeners();
    });
}

export function isStandalone () {
    if (typeof window === 'undefined') return false;
    const isMatch = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
    return Boolean(isMatch || navigator.standalone === true || isInstalled);
}

export function isIOS () {
    if (typeof navigator === 'undefined') return false;
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function getInstallState () {
    if (isStandalone()) {
        return 'installed';
    }
    if (deferredPrompt !== null) {
        return 'promptable';
    }
    if (isIOS()) {
        return 'ios';
    }
    return 'unsupported';
}

export function promptInstall () {
    if (!deferredPrompt) {
        return Promise.resolve('dismissed');
    }
    const promptEvent = deferredPrompt;
    deferredPrompt = null;
    notifyListeners();
    return promptEvent.prompt().then(() => promptEvent.userChoice).then(choiceResult => {
        if (choiceResult && choiceResult.outcome === 'accepted') {
            isInstalled = true;
            notifyListeners();
            return 'accepted';
        }
        return 'dismissed';
    }).catch(() => 'dismissed');
}

export function onInstallStateChange (cb) {
    listeners.add(cb);
    return () => {
        listeners.delete(cb);
    };
}

export function getOfflineStatus () {
    const swPromise = new Promise(resolve => {
        if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) {
            return resolve({coreCached: null, coreTotal: null, aiCached: null, aiTotal: null});
        }
        let resolved = false;
        let handler;
        const timeoutId = setTimeout(() => {
            if (!resolved) {
                resolved = true;
                if (handler) navigator.serviceWorker.removeEventListener('message', handler);
                resolve({coreCached: null, coreTotal: null, aiCached: null, aiTotal: null});
            }
        }, 3000);

        handler = event => {
            const data = event.data || {};
            if (data.type === 'CACHE_STATUS') {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeoutId);
                    navigator.serviceWorker.removeEventListener('message', handler);
                    resolve({
                        coreCached: typeof data.coreCached === 'number' ? data.coreCached : null,
                        coreTotal: typeof data.coreTotal === 'number' ? data.coreTotal : null,
                        aiCached: typeof data.aiCached === 'number' ? data.aiCached : null,
                        aiTotal: typeof data.aiTotal === 'number' ? data.aiTotal : null
                    });
                }
            }
        };

        navigator.serviceWorker.addEventListener('message', handler);
        navigator.serviceWorker.controller.postMessage({type: 'GET_CACHE_STATUS'});
    });

    const storagePersisted = navigator.storage && navigator.storage.persisted
        ? navigator.storage.persisted().catch(() => false)
        : Promise.resolve(false);
    const storageEstimate = navigator.storage && navigator.storage.estimate
        ? navigator.storage.estimate().catch(() => ({}))
        : Promise.resolve({});

    const storagePromise = Promise.all([storagePersisted, storageEstimate]).then(([persisted, estimate]) => ({
        persisted: Boolean(persisted),
        usageBytes: (estimate && estimate.usage) ? estimate.usage : 0
    })).catch(() => ({
        persisted: false,
        usageBytes: 0
    }));

    return Promise.all([swPromise, storagePromise]).then(([swStatus, storageStatus]) => ({
        coreCached: swStatus.coreCached,
        coreTotal: swStatus.coreTotal,
        aiCached: swStatus.aiCached,
        aiTotal: swStatus.aiTotal,
        persisted: storageStatus.persisted,
        usageBytes: storageStatus.usageBytes
    }));
}
