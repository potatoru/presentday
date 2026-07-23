// Use the light build, smaller and we do not need the extra features
import Hls from 'hls.js/dist/hls.light.mjs';

// Stream URL, can be changed with ?src=<url>
const DEFAULT_SRC = 'https://presentday.cc/hls/index.m3u8';

const src = new URLSearchParams(location.search).get('src') ?? DEFAULT_SRC;
const video = document.getElementById('video');

// Some mobile browsers ignore the autoplay attribute so we start playback by hand
function kickPlay() {
  const p = video.play();
  if (p) p.catch(() => {}); // A reject is fine, a tap will start it later
}

// Show a fatal error on screen because phones have no devtools
const errBox = document.getElementById('err');
function showError(msg) {
  errBox.textContent = msg;
  errBox.hidden = false;
}

if (Hls.isSupported()) {
  const hls = new Hls();
  hls.loadSource(src);
  hls.attachMedia(video);

  hls.on(Hls.Events.MANIFEST_PARSED, kickPlay);

  let mediaRecoveries = 0;
  hls.on(Hls.Events.ERROR, (_event, data) => {
    if (!data.fatal) return;
    console.error('HLS fatal error:', data.type, data.details);

    // The browser cannot play this codec so retrying will not help
    if (
      data.details === Hls.ErrorDetails.BUFFER_INCOMPATIBLE_CODECS_ERROR ||
      data.details === Hls.ErrorDetails.BUFFER_ADD_CODEC_ERROR
    ) {
      showError('playback error: codec unsupported\n' + data.details);
      hls.destroy();
      return;
    }

    switch (data.type) {
      case Hls.ErrorTypes.NETWORK_ERROR:
        hls.startLoad();
        break;
      case Hls.ErrorTypes.MEDIA_ERROR:
        if (mediaRecoveries++ < 3) {
          hls.recoverMediaError();
        } else {
          showError('playback error: media\n' + data.details);
          hls.destroy();
        }
        break;
      default:
        showError('playback error: ' + data.type + '\n' + data.details);
        hls.destroy();
    }
  });

  // Watch for a freeze, the live video can stop while the audio keeps going
  // If it stops moving, jump back to the live edge
  let lastTime = 0;
  let stalledFor = 0;
  setInterval(() => {
    if (video.paused || video.readyState < 3) return;
    if (video.currentTime === lastTime) {
      stalledFor += 1;
      if (stalledFor >= 3 && hls.liveSyncPosition != null) {
        video.currentTime = hls.liveSyncPosition;
        kickPlay();
        stalledFor = 0;
      }
    } else {
      stalledFor = 0;
      lastTime = video.currentTime;
    }
  }, 1000);

  // A tab coming back from background can show a black frozen frame
  // Resume and jump to the live edge, but only if the video was playing before
  // the tab was hidden, so a user pause is kept
  let wasPlaying = false;
  function onVisibility() {
    if (document.visibilityState === 'hidden') {
      wasPlaying = !video.paused;
      return;
    }
    if (!wasPlaying) return;
    const behind =
      hls.liveSyncPosition != null &&
      video.currentTime < hls.liveSyncPosition - 10;
    if (video.paused || video.readyState < 3 || behind) {
      hls.startLoad();
      if (hls.liveSyncPosition != null) video.currentTime = hls.liveSyncPosition;
      kickPlay();
    }
  }
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pageshow', onVisibility);
} else if (video.canPlayType('application/vnd.apple.mpegurl')) {
  // Safari and iOS play HLS on their own
  video.src = src;
  video.addEventListener('loadedmetadata', kickPlay);
  video.addEventListener('error', () => {
    showError('playback error\n' + (video.error?.message ?? 'unknown'));
  });
  let wasPlaying = false;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      wasPlaying = !video.paused;
    } else if (wasPlaying && video.paused) {
      kickPlay();
    }
  });
} else {
  showError('HLS is not supported in this browser');
}

const clock = document.getElementById('clock');
const timeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Tokyo',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

function tick() {
  clock.textContent = timeFmt.format(new Date());
}
tick();
setInterval(tick, 1000);

const nowPlaying = document.getElementById('now-playing');
const npArtist = nowPlaying.querySelector('.np-artist');
const npTitle = nowPlaying.querySelector('.np-title');

async function updateNowPlaying() {
  try {
    const res = await fetch('https://api.plaza.one/v2/status', {
      cache: 'no-store',
    });
    if (!res.ok) return; // On error keep the old value
    const { song } = await res.json();
    if (!song?.title) return;
    npArtist.textContent = song.artist ?? '';
    npTitle.textContent = song.title;
    nowPlaying.hidden = false;
  } catch {
    // Network error, keep what is shown
  }
}

updateNowPlaying();
setInterval(updateNowPlaying, 10_000);

// Video starts muted for autoplay, the button or the hint turns sound on
// Chrome only allows unmute on a real click
const soundHint = document.getElementById('sound-hint');
const soundToggle = document.getElementById('sound-toggle');

// True only when the user paused with a video click or Space
let userPaused = false;

function updateMuteIcon() {
  soundToggle.classList.toggle('muted', video.muted);
  soundToggle.setAttribute('aria-label', video.muted ? 'Unmute' : 'Mute');
}

function enableSound() {
  video.muted = false;
  video.volume = 1;
  // If the user paused the video, only turn on sound and leave it paused
  if (userPaused) {
    soundHint.classList.add('hidden');
    return;
  }
  const p = video.play();
  const done = () => soundHint.classList.add('hidden');
  if (!p) {
    done();
    return;
  }
  p.then(done).catch(() => {
    // Browser did not allow unmute, go back to muted and keep the hint
    video.muted = true;
    video.play().catch(() => {});
  });
}

function toggleMute() {
  if (video.muted) enableSound();
  else video.muted = true;
}

soundHint.addEventListener('click', enableSound);
soundToggle.addEventListener('click', toggleMute);
video.addEventListener('volumechange', updateMuteIcon);
updateMuteIcon();

// Play or pause by clicking the video or pressing Space
function togglePlay() {
  if (video.paused) {
    userPaused = false;
    video.play().catch(() => {});
  } else {
    userPaused = true;
    video.pause();
  }
}

video.addEventListener('click', togglePlay);

window.addEventListener('keydown', (e) => {
  // Skip Space if a button is focused so the button gets the key
  if (e.code === 'Space' && !(e.target instanceof HTMLButtonElement)) {
    e.preventDefault();
    togglePlay();
  }
});

// Eye button hides the whole interface and leaves only the video
const uiToggle = document.getElementById('ui-toggle');
uiToggle.addEventListener('click', () => {
  const hidden = document.body.classList.toggle('ui-hidden');
  uiToggle.classList.toggle('off', hidden);
  uiToggle.setAttribute('aria-label', hidden ? 'Show interface' : 'Hide interface');
});
