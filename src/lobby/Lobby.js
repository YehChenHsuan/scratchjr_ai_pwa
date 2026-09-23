//////////////////////////////////////////////////
// Home Screen
//////////////////////////////////////////////////

import {libInit, getUrlVars, gn, isAndroid, newHTML} from '../utils/lib';
import ScratchAudio from '../utils/ScratchAudio';
import OS from '../tablet/OS';
import Localization from '../utils/Localization';
import Cookie from '../utils/Cookie';
import {getInstallState, promptInstall, onInstallStateChange, getOfflineStatus} from '../utils/PWAInstall';
import {requestPersistentStorage} from '../utils/PWA';

import Home from './Home';
import Samples from './Samples';

let version = undefined;
let busy = false;
let errorTimer;
const host = 'inapp/';
let currentPage = null;
let settingsCleanup = null;

export default class Lobby {
    // Getters/setters for properties used in other classes
    static get version () {
        return version;
    }

    static set busy (newBusy) {
        busy = newBusy;
    }

    static get errorTimer () {
        return errorTimer;
    }

    static appinit (v) {
        libInit();
        version = v;
        var urlvars = getUrlVars();
        var place = urlvars.place;
        ScratchAudio.addSound('sounds/', 'tap.wav', ScratchAudio.uiSounds);
        ScratchAudio.addSound('sounds/', 'cut.wav', ScratchAudio.uiSounds);
        ScratchAudio.init();
        Lobby.setPage(place ? place : 'home');

        if (window.Settings.settingsPageDisabled) {
            gn('settings').style.visibility = 'hidden';
        }

        gn('hometab').onclick = function () {
            if (gn('hometab').className != 'home on') {
                Lobby.setPage('home');
            }
        };
        gn('helptab').onclick = function () {
            if (gn('helptab').className != 'help on') {
                Lobby.setPage('help');
            }
        };
        gn('booktab').onclick = function () {
            if (gn('booktab').className != 'book on') {
                Lobby.setPage('book');
            }
        };
        gn('geartab').onclick = function () {
            if (gn('geartab').className != 'gear on') {
                Lobby.setPage('gear');
            }
        };
        gn('abouttab').onclick = function () {
            if (gn('abouttab').className != 'tab on') {
                Lobby.setSubMenu('about');
            }
        };
        gn('interfacetab').onclick = function () {
            if (gn('interfacetab').className != 'tab on') {
                Lobby.setSubMenu('interface');
            }
        };
        gn('painttab').onclick = function () {
            if (gn('painttab').className != 'tab on') {
                Lobby.setSubMenu('paint');
            }
        };
        gn('blockstab').onclick = function () {
            if (gn('booktab').className != 'tab2 on') {
                Lobby.setSubMenu('blocks');
            }
        };
        if (isAndroid) {
            AndroidInterface.notifyDoneLoading();
        }
    }

    static setPage (page) {
        if (busy) {
            return;
        }
        if (gn('hometab').className == 'home on') {
            var doNext = function (page) {
                Lobby.changePage(page);
            };
            OS.setfile('homescroll.sjr', gn('wrapc').scrollTop, function () {
                doNext(page);
            });
        } else {
            Lobby.changePage(page);
        }
    }

    static changePage (page) {
        if (settingsCleanup) {
            settingsCleanup();
            settingsCleanup = null;
        }
        Lobby.selectButton(page);
        document.documentElement.scrollTop = 0;
        var div = gn('wrapc');
        while (div.childElementCount > 0) {
            div.removeChild(div.childNodes[0]);
        }
        switch (page) {
        case 'home':
            busy = true;
            ScratchAudio.sndFX('tap.wav');
            Lobby.loadProjects(div);
            break;
        case 'help':
            busy = true;
            ScratchAudio.sndFX('tap.wav');
            Lobby.loadSamples(div);
            break;
        case 'book':
            Lobby.loadGuide(div);
            break;
        case 'gear':
            ScratchAudio.sndFX('tap.wav');
            Lobby.loadSettings(div);
            break;
        default:
            break;
        }
        currentPage = page;
    }

    static loadProjects (p) {
        document.ontouchmove = undefined;
        document.onmousemove = undefined;
        gn('topsection').className = 'topsection home';
        gn('tabheader').textContent = Localization.localize('MY_PROJECTS');
        gn('subtitle').textContent = '';
        gn('footer').className = 'footer off';
        gn('wrapc').scrollTop = 0;
        gn('wrapc').className = 'contentwrap scroll';
        var div = newHTML('div', 'htmlcontents home', p);
        div.setAttribute('id', 'htmlcontents');
        Home.init();
    }

    static loadSamples (p) {
        gn('topsection').className = 'topsection help';
        gn('tabheader').textContent = Localization.localize('QUICK_INTRO');
        gn('subtitle').textContent = Localization.localize('SAMPLE_PROJECTS');
        gn('footer').className = 'footer off';
        gn('wrapc').scrollTop = 0;
        gn('wrapc').className = 'contentwrap noscroll';
        var div = newHTML('div', 'htmlcontents help', p);
        div.setAttribute('id', 'htmlcontents');
        document.ontouchmove = function (e) {
            e.preventDefault();
        };
        document.onmousemove = function (e) {
            e.preventDefault();
        };
        Samples.init();
    }

    static loadGuide (p) {
        gn('topsection').className = 'topsection book';
        gn('footer').className = 'footer on';
        var div = newHTML('div', 'htmlcontents home', p);
        div.setAttribute('id', 'htmlcontents');
        setTimeout(function () {
            Lobby.setSubMenu('about');
        }, 250);
    }

    static loadSettings (p) {
        // loadProjects without the header
        gn('topsection').className = 'topsection book';
        gn('footer').className = 'footer off';
        gn('wrapc').scrollTop = 0;
        gn('wrapc').className = 'contentwrap scroll';
        var div = newHTML('div', 'htmlcontents settings', p);
        div.setAttribute('id', 'htmlcontents');

        // Localization settings
        var title = newHTML('h1', 'localizationtitle', div);
        title.textContent = Localization.localize('SELECT_LANGUAGE');

        var languageButtons = newHTML('div', 'languagebuttons', div);

        var languageButton;
        for (var l in window.Settings.supportedLocales) {
            var selected = '';
            if (window.Settings.supportedLocales[l] == Localization.currentLocale) {
                selected = ' selected';
            }
            languageButton = newHTML('div', 'localizationselect' + selected, languageButtons);
            languageButton.textContent = l;

            languageButton.onclick = function (e) {
                ScratchAudio.sndFX('tap.wav');
                let newLocale = window.Settings.supportedLocales[e.target.textContent];
                Cookie.set('localization', newLocale);
                OS.analyticsEvent('lobby', 'language_changed', newLocale);
                window.location = '?place=gear';
            };
        }

        // ==========================================
        // A. PWA 安裝區塊
        // ==========================================
        var installSection = newHTML('div', 'pwa-settings-section', div);
        var installTitle = newHTML('h1', 'pwa-section-title', installSection);
        installTitle.textContent = Localization.localize('PWA_INSTALL_SECTION_TITLE');

        var installContainer = newHTML('div', 'pwa-install-container', installSection);

        var renderInstallSection = function () {
            while (installContainer.firstChild) {
                installContainer.removeChild(installContainer.firstChild);
            }
            var state = getInstallState();
            if (state === 'promptable') {
                var installBtn = newHTML('button', 'pwa-large-btn', installContainer);
                installBtn.textContent = Localization.localize('PWA_INSTALL_BUTTON');
                installBtn.onclick = function () {
                    ScratchAudio.sndFX('tap.wav');
                    promptInstall();
                };
            } else if (state === 'ios') {
                var iosGuide = newHTML('div', 'pwa-ios-guide', installContainer);
                var stepsRow = newHTML('div', 'pwa-ios-steps', iosGuide);

                var step1 = newHTML('div', 'pwa-ios-step', stepsRow);
                var shareSvg = '<svg class="pwa-ios-share-icon" viewBox="0 0 24 24" width="22" height="22" ' +
                    'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
                    'stroke-linejoin="round">' +
                    '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path>' +
                    '<polyline points="16 6 12 2 8 6"></polyline>' +
                    '<line x1="12" y1="2" x2="12" y2="15"></line></svg>';
                step1.innerHTML = Localization.localize('PWA_IOS_STEP1') + shareSvg;

                var step2 = newHTML('div', 'pwa-ios-step', stepsRow);
                step2.textContent = Localization.localize('PWA_IOS_STEP2');

                var step3 = newHTML('div', 'pwa-ios-step', stepsRow);
                step3.textContent = Localization.localize('PWA_IOS_STEP3');

                var warningBox = newHTML('div', 'pwa-ios-warning', iosGuide);
                warningBox.textContent = Localization.localize('PWA_IOS_WARNING');
            } else if (state === 'installed') {
                var installedPill = newHTML('div', 'pwa-status-pill installed', installContainer);
                installedPill.textContent = Localization.localize('PWA_INSTALLED_STATUS');
            } else {
                var unsupportedPill = newHTML('div', 'pwa-status-pill unsupported', installContainer);
                unsupportedPill.textContent = Localization.localize('PWA_UNSUPPORTED_HINT');
            }
        };

        renderInstallSection();
        var unsubscribeInstall = onInstallStateChange(renderInstallSection);

        // ==========================================
        // B. 離線使用狀態區塊
        // ==========================================
        var offlineSection = newHTML('div', 'pwa-settings-section', div);
        var offlineTitle = newHTML('h1', 'pwa-section-title', offlineSection);
        offlineTitle.textContent = Localization.localize('PWA_STATUS_SECTION_TITLE');

        var offlineCard = newHTML('div', 'pwa-offline-card', offlineSection);

        var pollTimer = null;
        var isUpdatingStatus = false;

        var updateOfflineStatus = function () {
            if (isUpdatingStatus) {
                return;
            }
            isUpdatingStatus = true;
            getOfflineStatus().then(function (status) {
                isUpdatingStatus = false;
                if (currentPage !== 'gear') {
                    return;
                }

                while (offlineCard.firstChild) {
                    offlineCard.removeChild(offlineCard.firstChild);
                }

                if (status.coreCached === null && status.aiCached === null) {
                    var prepMsg = newHTML('div', 'pwa-status-preparing', offlineCard);
                    prepMsg.textContent = Localization.localize('PWA_STATUS_PREPARING');
                    return;
                }

                // 1. Core Resources
                var coreRow = newHTML('div', 'pwa-status-row', offlineCard);
                var coreLabel = newHTML('div', 'pwa-status-label', coreRow);
                coreLabel.textContent = Localization.localize('PWA_STATUS_CORE');

                var coreWrap = newHTML('div', 'pwa-progress-wrap', coreRow);
                var coreBg = newHTML('div', 'pwa-progress-bar-bg', coreWrap);
                var coreFill = newHTML('div', 'pwa-progress-bar-fill', coreBg);
                var coreCached = status.coreCached || 0;
                var coreTotal = status.coreTotal || 0;
                var corePercent = coreTotal > 0 ? Math.min(100, Math.round((coreCached / coreTotal) * 100)) : 0;
                coreFill.style.width = corePercent + '%';

                var coreText = newHTML('div', 'pwa-progress-text', coreWrap);
                coreText.textContent = coreCached + ' / ' + coreTotal;
                if (coreTotal > 0 && coreCached >= coreTotal) {
                    coreFill.className += ' complete';
                    var check1 = newHTML('span', 'pwa-check-icon', coreText);
                    check1.textContent = ' ✓';
                }

                // 2. AI Models
                var aiRow = newHTML('div', 'pwa-status-row', offlineCard);
                var aiLabel = newHTML('div', 'pwa-status-label', aiRow);
                aiLabel.textContent = Localization.localize('PWA_STATUS_AI');

                var aiWrap = newHTML('div', 'pwa-progress-wrap', aiRow);
                var aiBg = newHTML('div', 'pwa-progress-bar-bg', aiWrap);
                var aiFill = newHTML('div', 'pwa-progress-bar-fill', aiBg);
                var aiCached = status.aiCached || 0;
                var aiTotal = status.aiTotal || 0;
                var aiPercent = aiTotal > 0 ? Math.min(100, Math.round((aiCached / aiTotal) * 100)) : 0;
                aiFill.style.width = aiPercent + '%';

                var aiText = newHTML('div', 'pwa-progress-text', aiWrap);
                aiText.textContent = aiCached + ' / ' + aiTotal;
                if (aiTotal > 0 && aiCached >= aiTotal) {
                    aiFill.className += ' complete';
                    var check2 = newHTML('span', 'pwa-check-icon', aiText);
                    check2.textContent = ' ✓';
                }

                // 3. Data Protection
                var persistRow = newHTML('div', 'pwa-status-row', offlineCard);
                var persistLabel = newHTML('div', 'pwa-status-label', persistRow);
                persistLabel.textContent = Localization.localize('PWA_STATUS_DATA_PROTECTION');

                var persistRight = newHTML('div', 'pwa-status-val-wrap', persistRow);
                if (status.persisted) {
                    var protText = newHTML('span', '', persistRight);
                    protText.textContent = Localization.localize('PWA_STATUS_PROTECTED');
                    protText.style.color = '#4CAF50';
                    protText.style.fontWeight = 'bold';
                    var checkP = newHTML('span', 'pwa-check-icon', persistRight);
                    checkP.textContent = ' ✓';
                } else {
                    var enableBtn = newHTML('button', 'pwa-action-btn-small', persistRight);
                    enableBtn.textContent = Localization.localize('PWA_ENABLE_PROTECTION_BUTTON');
                    enableBtn.onclick = function () {
                        ScratchAudio.sndFX('tap.wav');
                        requestPersistentStorage().then(function () {
                            updateOfflineStatus();
                        });
                    };
                }

                // 4. Storage Used
                var storageRow = newHTML('div', 'pwa-status-row', offlineCard);
                var storageLabel = newHTML('div', 'pwa-status-label', storageRow);
                storageLabel.textContent = Localization.localize('PWA_STORAGE_USED');

                var storageVal = newHTML('div', '', storageRow);
                storageVal.style.fontWeight = 'bold';
                var mb = (status.usageBytes / (1024 * 1024)).toFixed(1);
                storageVal.textContent = mb + ' MB';

                var isAllComplete = (coreTotal > 0 && coreCached >= coreTotal) &&
                    (aiTotal > 0 && aiCached >= aiTotal);
                if (isAllComplete && pollTimer) {
                    clearInterval(pollTimer);
                    pollTimer = null;
                }
            }).catch(function () {
                isUpdatingStatus = false;
            });
        };

        updateOfflineStatus();

        pollTimer = setInterval(function () {
            if (currentPage === 'gear') {
                updateOfflineStatus();
            } else if (pollTimer) {
                clearInterval(pollTimer);
                pollTimer = null;
            }
        }, 2000);

        settingsCleanup = function () {
            if (unsubscribeInstall) {
                unsubscribeInstall();
                unsubscribeInstall = null;
            }
            if (pollTimer) {
                clearInterval(pollTimer);
                pollTimer = null;
            }
        };
    }

    static setSubMenu (page) {
        if (busy) {
            return;
        }
        document.ontouchmove = undefined;
        document.onmousemove = undefined;
        busy = true;
        ScratchAudio.sndFX('tap.wav');
        Lobby.selectSubButton(page);
        document.documentElement.scrollTop = 0;
        gn('wrapc').scrollTop = 0;
        var div = gn('wrapc');
        while (div.childElementCount > 0) {
            div.removeChild(div.childNodes[0]);
        }
        var url;
        switch (page) {
        case 'about':
            url = host + 'about.html';
            Lobby.loadLink(div, url, 'contentwrap scroll', 'htmlcontents scrolled');
            break;
        case 'interface':
            document.ontouchmove = function (e) {
                e.preventDefault();
            };
            document.onmousemove = function (e) {
                e.preventDefault();
            };
            url = host + 'interface.html';
            Lobby.loadLink(div, url, 'contentwrap noscroll', 'htmlcontents fixed');
            break;
        case 'paint':
            document.ontouchmove = function (e) {
                e.preventDefault();
            };
            document.onmousemove = function (e) {
                e.preventDefault();
            };
            url = host + 'paint.html';
            Lobby.loadLink(div, url, 'contentwrap noscroll', 'htmlcontents fixed');
            break;
        case 'blocks':
            url = host + 'blocks.html';
            Lobby.loadLink(div, url, 'contentwrap scroll', 'htmlcontents scrolled');
            break;
        default:
            Lobby.missing(page, div);
            break;
        //url =  Lobby.loadProjects(div); break;
        }
    }

    static selectSubButton (str) {
        var list = ['about', 'interface', 'paint', 'blocks'];
        for (var i = 0; i < list.length; i++) {
            var kid = gn(list[i] + 'tab');
            var cls = kid.className.split(' ')[0];
            kid.className = cls + ((list[i] == str) ? ' on' : ' off');
        }
    }

    static selectButton (str) {
        var list = ['home', 'help', 'book', 'gear'];
        for (var i = 0; i < list.length; i++) {
            if (str == list[i]) {
                gn(list[i] + 'tab').className = list[i] + ' on';
            } else {
                gn(list[i] + 'tab').className = list[i] + ' off';
            }
        }
    }

    static loadLink (p, url, css, css2) {
        document.documentElement.scrollTop = 0;
        gn('wrapc').scrollTop = 0;
        gn('wrapc').className = css;
        var iframe = newHTML('iframe', 'htmlcontents', p);
        iframe.setAttribute('id', 'htmlcontents');
        gn('htmlcontents').className = css2;
        gn('htmlcontents').src = url;
        gn('htmlcontents').onload = function () {
            if (errorTimer) {
                clearTimeout(errorTimer);
            }
            errorTimer = undefined;
            busy = false;
            gn('wrapc').scrollTop = 0;
        };
        errorTimer = window.setTimeout(function () {
            Lobby.errorLoading('Loading timeout');
        }, 20000);
    }

    static errorLoading (str) {
        if (errorTimer) {
            clearTimeout(errorTimer);
        }
        errorTimer = undefined;
        var wc = gn('wrapc');
        while (wc.childElementCount > 0) {
            wc.removeChild(wc.childNodes[0]);
        }
        var div = newHTML('div', 'htmlcontents', wc);
        div.setAttribute('id', 'htmlcontents');
        var ht = newHTML('div', 'errormsg', div);
        var h = newHTML('h1', undefined, ht);
        h.textContent = str;
        busy = false;
    }

    static missing (page, p) {
        gn('wrapc').className = 'contentwrap scroll';
        var div = newHTML('div', 'htmlcontents', p);
        div.setAttribute('id', 'htmlcontents');
        div = newHTML('div', 'errormsg', div);
        var h = newHTML('h1', undefined, div);
        h.textContent = page.toUpperCase() + ': UNDER CONSTRUCTION';
        busy = false;
    }

    static goHome () {
        if (currentPage === 'home') {
            window.location.href = 'index.html?back=true';
        } else {
            Lobby.setPage('home');
        }
    }

    static refresh () {
        if (gn('hometab') !== null) { // Check if we're on the lobby page
            Lobby.setPage('home');
        }
    }
}

window.Lobby = Lobby;
