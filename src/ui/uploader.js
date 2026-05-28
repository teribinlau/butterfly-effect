// uploader.js — three input paths (drag/drop, file picker, URL) into one HTMLVideoElement.
// Exposes: createVideo(defaultSrc, onReady) → returns the shared <video> element.

export function createVideo(defaultSrc, onReady) {
  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.muted = true;          // autoplay-friendly
  video.loop = true;
  video.playsInline = true;
  video.preload = 'auto';

  const fileInput = document.getElementById('fileInput');
  const urlInput = document.getElementById('urlInput');
  const urlLoad = document.getElementById('urlLoad');
  const dropZone = document.getElementById('drop');
  const playOverlay = document.getElementById('play');

  // Hook ready
  video.addEventListener('loadeddata', () => {
    onReady?.(video);
    tryPlay();
  });
  video.addEventListener('error', () => {
    console.warn('[uploader] video error', video.error);
  });

  function tryPlay() {
    const p = video.play();
    if (p && p.catch) {
      p.catch(() => {
        // Autoplay blocked → show overlay; one click resumes.
        playOverlay.classList.add('show');
        playOverlay.addEventListener('click', () => {
          video.play().then(() => playOverlay.classList.remove('show')).catch(() => {});
        }, { once: true });
      });
    }
  }

  function load(src) {
    // Revoke previous blob URL if any
    if (video._blobUrl) { URL.revokeObjectURL(video._blobUrl); video._blobUrl = null; }
    video.src = src;
    video.load();
  }
  function loadFile(file) {
    const url = URL.createObjectURL(file);
    video._blobUrl = url;
    load(url);
  }

  // — File picker
  fileInput.addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    if (f) loadFile(f);
  });

  // — URL paste
  function applyUrl() {
    const u = urlInput.value.trim();
    if (u) load(u);
  }
  urlLoad.addEventListener('click', applyUrl);
  urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') applyUrl(); });

  // — Drag and drop (anywhere)
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    if (e.dataTransfer?.types?.includes('Files')) {
      dragDepth++;
      dropZone.classList.add('show');
    }
  });
  window.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dropZone.classList.remove('show');
  });
  window.addEventListener('dragover', (e) => { e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    dropZone.classList.remove('show');
    const f = e.dataTransfer?.files?.[0];
    if (f && f.type.startsWith('video/')) loadFile(f);
  });

  // Kick off with default
  if (defaultSrc) load(defaultSrc);

  return video;
}
