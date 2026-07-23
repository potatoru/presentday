// Light build: drops alt-audio, subtitles, EME/DRM, CMCD — not needed for a
// single fullscreen player. Same API, smaller bundle.
import Hls from 'hls.js/dist/hls.light.mjs';

// Default stream, can be overridden via ?src=<url>
const DEFAULT_SRC = 'https://presentday.cc/hls/index.m3u8';

const src = new URLSearchParams(location.search).get('src') ?? DEFAULT_SRC;
const video = document.getElementById('video');

// Kick playback explicitly: some mobile browsers (e.g. Samsung Internet) ignore
// the `autoplay` attribute for MSE-backed video and leave it frozen on frame 0.
function kickPlay() {
  const p = video.play();
  if (p) p.catch(() => {}); // rejection is fine; a user tap will start it later
}

// Surface a fatal, unrecoverable error on screen (mobile has no devtools).
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

    // Codec the browser's MSE can't handle — recovery is futile, so stop and report.
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

  // Stall watchdog: on a live stream a mobile decoder can freeze while the audio
  // keeps going. If playback stops advancing, snap back to the live edge.
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
} else if (video.canPlayType('application/vnd.apple.mpegurl')) {
  // Safari / iOS — native HLS support
  video.src = src;
  video.addEventListener('loadedmetadata', kickPlay);
  video.addEventListener('error', () => {
    showError('playback error\n' + (video.error?.message ?? 'unknown'));
  });
} else {
  showError('HLS is not supported in this browser');
}

// ---------- Live clock (Tokyo / JST) ----------
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

// ---------- Now playing (plaza.one) ----------
const nowPlaying = document.getElementById('now-playing');
const npArtist = nowPlaying.querySelector('.np-artist');
const npTitle = nowPlaying.querySelector('.np-title');

async function updateNowPlaying() {
  try {
    const res = await fetch('https://api.plaza.one/v2/status', {
      cache: 'no-store',
    });
    if (!res.ok) return; // keep previous value on error
    const { song } = await res.json();
    if (!song?.title) return;
    npArtist.textContent = song.artist ?? '';
    npTitle.textContent = song.title;
    nowPlaying.hidden = false;
  } catch {
    // Network error — keep whatever is currently shown
  }
}

updateNowPlaying();
setInterval(updateNowPlaying, 10_000);

// ---------- Enable sound on first interaction ----------
// Autoplay must start muted; unmute once the user interacts. Chrome only honors
// the unmute inside a real user gesture — use `click` (a full press+release),
// which grants activation more reliably than `pointerdown`.
const soundHint = document.getElementById('sound-hint');

function stopListening() {
  window.removeEventListener('click', enableSound);
  window.removeEventListener('keydown', enableSound);
}

function enableSound() {
  video.muted = false;
  video.volume = 1;
  const p = video.play();
  if (!p) {
    soundHint.classList.add('hidden');
    stopListening();
    return;
  }
  p.then(() => {
    // Unmuted playback accepted — done.
    soundHint.classList.add('hidden');
    stopListening();
  }).catch(() => {
    // Browser refused to unmute; keep the video running muted and leave the
    // hint up so the next click can try again.
    video.muted = true;
    video.play().catch(() => {});
  });
}

window.addEventListener('click', enableSound);
window.addEventListener('keydown', enableSound);
