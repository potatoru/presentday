// Light build: drops alt-audio, subtitles, EME/DRM, CMCD — not needed for a
// single fullscreen player. Same API, smaller bundle.
import Hls from 'hls.js/dist/hls.light.mjs';

// Default stream, can be overridden via ?src=<url>
const DEFAULT_SRC = 'https://presentday.cc/hls/index.m3u8';

const src = new URLSearchParams(location.search).get('src') ?? DEFAULT_SRC;
const video = document.getElementById('video');

if (Hls.isSupported()) {
  const hls = new Hls();
  hls.loadSource(src);
  hls.attachMedia(video);
  hls.on(Hls.Events.ERROR, (_event, data) => {
    if (data.fatal) {
      console.error('HLS fatal error:', data.type, data.details);
      switch (data.type) {
        case Hls.ErrorTypes.NETWORK_ERROR:
          hls.startLoad();
          break;
        case Hls.ErrorTypes.MEDIA_ERROR:
          hls.recoverMediaError();
          break;
        default:
          hls.destroy();
      }
    }
  });
} else if (video.canPlayType('application/vnd.apple.mpegurl')) {
  // Safari / iOS — native HLS support
  video.src = src;
} else {
  console.error('HLS is not supported in this browser');
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
// Autoplay must start muted; unmute once the user interacts.
const soundHint = document.getElementById('sound-hint');

function enableSound() {
  video.muted = false;
  video.volume = 1;
  video.play().catch(() => {});
  soundHint.classList.add('hidden');
  window.removeEventListener('pointerdown', enableSound);
  window.removeEventListener('keydown', enableSound);
}

window.addEventListener('pointerdown', enableSound);
window.addEventListener('keydown', enableSound);
