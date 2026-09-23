import {gn, isAndroid, getUrlVars} from '../utils/lib';

let place;

export function gettingStartedMain () {
    gn('closeHelp').onclick = gettingStartedCloseMe;
    gn('closeHelp').ontouchstart = gettingStartedCloseMe;
    var videoObj = gn('myVideo');
    videoObj.poster = 'assets/lobby/poster.png';
    var image = document.createElement('img');
    image.src = videoObj.poster;
    image.onload = function () {
        videoObj.style.display = 'block';
    };
    videoObj.onerror = function () {
        // 優雅降級：若離線且未快取影片，提示點擊關閉按鈕返回
        console.warn('[gettingStarted] Video failed to load (offline or un-cached).');
    };
    if (isAndroid) {
        // On Android we need to copy to a temporary directory first:
        setTimeout(function () {
            videoObj.type = 'video/mp4';
            videoObj.src = AndroidInterface.scratchjr_getgettingstartedvideopath();
        }, 1000);
    } else {
        // On iOS or Web we load from server / PWA cache
        videoObj.src = 'assets/lobby/intro.mp4';
    }
    var urlvars = getUrlVars();
    place = urlvars['place'];
    document.ontouchmove = function (e) {
        e.preventDefault();
    };
}


function gettingStartedCloseMe () {
    window.location.href = 'home.html?place=' + place;
}
