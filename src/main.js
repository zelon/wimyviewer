import { SlidingWindowCache } from './cache.js';
import { renderImage, showSpinner, hideSpinner } from './renderer.js';

window.addEventListener('DOMContentLoaded', async () => {
  const { invoke, convertFileSrc } = window.__TAURI__.core;
  const { listen } = window.__TAURI__.event;

  // --- DOM 요소 ---
  const canvas = document.getElementById('viewer');
  const canvasContainer = document.getElementById('canvas-container');
  const canvasInner = document.getElementById('canvas-inner');
  const spinner = document.getElementById('spinner');
  const statusBar = document.getElementById('status-bar');
  const openFolderBtn = document.getElementById('open-folder');
  const deleteDialog = document.getElementById('delete-dialog');
  const deleteFilename = document.getElementById('delete-filename');
  const deleteConfirmBtn = document.getElementById('delete-confirm');
  const deleteCancelBtn = document.getElementById('delete-cancel');
  const renameDialog = document.getElementById('rename-dialog');
  const renameInput = document.getElementById('rename-input');
  const renameConfirmBtn = document.getElementById('rename-confirm');
  const renameCancelBtn = document.getElementById('rename-cancel');
  const contextMenu = document.getElementById('context-menu');
  const ctxShowInExplorer = document.getElementById('ctx-show-in-explorer');

  // --- 상태 ---
  let filePaths = [];
  let currentIndex = 0;
  let zoomLevel = 1.0;
  let isDragging = false, dragStartX = 0, dragStartY = 0;
  const cache = new SlidingWindowCache(2);

  // --- 이미지 로드 ---
  // JPG/PNG/BMP/GIF/WebP/ICO: convertFileSrc → asset:// URL → 브라우저 네이티브 디코딩
  // PSD: Rust 디코딩 → base64 PNG → Blob → createImageBitmap
  async function loadBitmap(index) {
    const path = filePaths[index];
    const ext = path.replace(/\\/g, '/').split('.').pop().toLowerCase();

    if (ext === 'psd') {
      const b64 = await invoke('prepare_psd', { path });
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: 'image/png' });
      return createImageBitmap(blob);
    }

    // 표준 포맷: asset:// 프로토콜로 파일 직접 로드
    const url = convertFileSrc(path);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`파일 로드 실패: ${response.status} ${path}`);
    const blob = await response.blob();
    return createImageBitmap(blob);
  }

  // --- 프리로드 (fire-and-forget) ---
  async function preloadImage(index) {
    if (index < 0 || index >= filePaths.length) return;
    if (cache.has(index)) return;

    try {
      const bitmap = await loadBitmap(index);
      cache.set(index, bitmap);
      if (index === currentIndex) renderCurrentImage();
    } catch (e) {
      console.error(`프리로드 실패 (index ${index}):`, e);
    }
  }

  // --- 네비게이션 ---
  async function navigate(index) {
    if (filePaths.length === 0) return;
    index = Math.max(0, Math.min(filePaths.length - 1, index));
    if (index === currentIndex && cache.has(index)) return;

    currentIndex = index;
    updateStatus();

    if (cache.has(currentIndex)) {
      renderCurrentImage();
    } else {
      showSpinner(spinner);
      // 현재 이미지를 즉시 로드 (await)
      try {
        const bitmap = await loadBitmap(currentIndex);
        cache.set(currentIndex, bitmap);
        renderCurrentImage();
      } catch (e) {
        hideSpinner(spinner);
        console.error('이미지 로드 실패:', e);
      }
    }

    schedulePreload(currentIndex);
  }

  // 주변 이미지 프리로드 (동시 실행, 비블로킹)
  function schedulePreload(index) {
    cache.evict(index);
    const needed = cache.getNeeded(index, filePaths.length);
    for (const i of needed) {
      preloadImage(i); // await 없음 — 모두 동시에 실행
    }
  }

  function renderCurrentImage() {
    if (!cache.has(currentIndex)) return;
    renderImage(canvas, cache.get(currentIndex));
    updateLayout();
    centerScroll();
    hideSpinner(spinner);
    updateStatus();
  }

  // --- 줌 + 패닝 ---
  function updateLayout() {
    const iw = canvas.width * zoomLevel;
    const ih = canvas.height * zoomLevel;
    const cw = canvasContainer.clientWidth;
    const ch = canvasContainer.clientHeight;
    canvasInner.style.width = `${Math.max(iw, cw)}px`;
    canvasInner.style.height = `${Math.max(ih, ch)}px`;
    canvas.style.left = `${Math.max(0, (cw - iw) / 2)}px`;
    canvas.style.top = `${Math.max(0, (ch - ih) / 2)}px`;
    canvas.style.transform = `scale(${zoomLevel})`;
    updateCursor();
  }

  function centerScroll() {
    const iw = canvas.width * zoomLevel;
    const ih = canvas.height * zoomLevel;
    canvasContainer.scrollLeft = Math.max(0, (iw - canvasContainer.clientWidth) / 2);
    canvasContainer.scrollTop = Math.max(0, (ih - canvasContainer.clientHeight) / 2);
  }

  function isImageLargerThanViewport() {
    return canvas.width * zoomLevel > canvasContainer.clientWidth ||
           canvas.height * zoomLevel > canvasContainer.clientHeight;
  }

  function updateCursor() {
    if (isDragging) canvas.style.cursor = 'grabbing';
    else if (isImageLargerThanViewport()) canvas.style.cursor = 'grab';
    else canvas.style.cursor = 'default';
  }

  // 드래그로 패닝
  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || !isImageLargerThanViewport()) return;
    isDragging = true;
    dragStartX = e.clientX + canvasContainer.scrollLeft;
    dragStartY = e.clientY + canvasContainer.scrollTop;
    canvas.style.cursor = 'grabbing';
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    canvasContainer.scrollLeft = dragStartX - e.clientX;
    canvasContainer.scrollTop = dragStartY - e.clientY;
  });

  window.addEventListener('mouseup', (e) => {
    if (e.button !== 0 || !isDragging) return;
    isDragging = false;
    updateCursor();
  });

  // --- 컨텍스트 메뉴 ---
  function hideContextMenu() {
    contextMenu.style.display = 'none';
  }

  canvas.addEventListener('contextmenu', (e) => {
    if (filePaths.length === 0) return;
    e.preventDefault();
    const menuW = contextMenu.offsetWidth || 164;
    const menuH = contextMenu.offsetHeight || 36;
    const x = Math.min(e.clientX, window.innerWidth - menuW - 4);
    const y = Math.min(e.clientY, window.innerHeight - menuH - 4);
    contextMenu.style.left = `${x}px`;
    contextMenu.style.top = `${y}px`;
    contextMenu.style.display = 'block';
  });

  ctxShowInExplorer.addEventListener('click', () => {
    hideContextMenu();
    invoke('show_in_explorer', { path: filePaths[currentIndex] }).catch(console.error);
  });

  window.addEventListener('mousedown', (e) => {
    if (!contextMenu.contains(e.target)) hideContextMenu();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideContextMenu();
  }, true);

  // --- 상태바 ---
  function updateStatus() {
    if (filePaths.length === 0) {
      statusBar.textContent = '이미지 없음';
      return;
    }
    const filename = filePaths[currentIndex].replace(/\\/g, '/').split('/').pop();
    const zoomPct = Math.round(zoomLevel * 100);
    statusBar.textContent = `${filename}  |  ${currentIndex + 1} / ${filePaths.length}  |  ${zoomPct}%`;
  }

  // --- 폴더 열기 ---
  openFolderBtn.addEventListener('click', async () => {
    const dir = await invoke('select_folder').catch(() => null);
    if (!dir) return;

    const paths = await invoke('load_directory', { dirPath: dir }).catch(e => {
      statusBar.textContent = `디렉토리 로드 실패: ${e}`;
      return null;
    });
    if (!paths) return;

    if (paths.length === 0) {
      statusBar.textContent = '지원하는 이미지 파일이 없습니다.';
      return;
    }

    filePaths = paths;
    cache.clear();
    currentIndex = 0;
    zoomLevel = 1.0;
    showSpinner(spinner);
    updateStatus();

    // 현재 이미지 로드 후 주변 프리로드
    try {
      const bitmap = await loadBitmap(0);
      cache.set(0, bitmap);
      renderCurrentImage();
    } catch (e) {
      hideSpinner(spinner);
      statusBar.textContent = `이미지 로드 실패: ${e}`;
    }
    schedulePreload(0);
  });

  // --- 키보드 ---
  window.addEventListener('keydown', async (e) => {
    if (deleteDialog.open || renameDialog.open) return;
    switch (e.key) {
      case 'ArrowLeft':  e.preventDefault(); await navigate(currentIndex - 1); break;
      case 'ArrowRight': e.preventDefault(); await navigate(currentIndex + 1); break;
      case 'Home':       e.preventDefault(); await navigate(0);                break;
      case 'End':        e.preventDefault(); await navigate(filePaths.length - 1); break;
      case 'Delete':     e.preventDefault(); showDeleteDialog(); break;
      case 'F2':         e.preventDefault(); showRenameDialog(); break;
    }
  });

  // --- 마우스 휠 ---
  window.addEventListener('wheel', async (e) => {
    e.preventDefault();
    if (e.ctrlKey) {
      const oldZoom = zoomLevel;
      const cw = canvasContainer.clientWidth;
      const ch = canvasContainer.clientHeight;
      const oldLeft = Math.max(0, (cw - canvas.width * oldZoom) / 2);
      const oldTop  = Math.max(0, (ch - canvas.height * oldZoom) / 2);
      const imgPx = (canvasContainer.scrollLeft + cw / 2 - oldLeft) / oldZoom;
      const imgPy = (canvasContainer.scrollTop  + ch / 2 - oldTop)  / oldZoom;

      zoomLevel = Math.max(0.1, Math.min(10.0, zoomLevel + (e.deltaY > 0 ? -0.1 : 0.1)));
      updateLayout();

      const newLeft = Math.max(0, (cw - canvas.width * zoomLevel) / 2);
      const newTop  = Math.max(0, (ch - canvas.height * zoomLevel) / 2);
      canvasContainer.scrollLeft = imgPx * zoomLevel + newLeft - cw / 2;
      canvasContainer.scrollTop  = imgPy * zoomLevel + newTop  - ch / 2;
      updateStatus();
    } else {
      await navigate(e.deltaY > 0 ? currentIndex + 1 : currentIndex - 1);
    }
  }, { passive: false });

  // --- 삭제 팝업 ---
  function showDeleteDialog() {
    if (filePaths.length === 0) return;
    deleteFilename.textContent = filePaths[currentIndex].replace(/\\/g, '/').split('/').pop();
    deleteDialog.showModal();
  }

  deleteConfirmBtn.addEventListener('click', async () => {
    deleteDialog.close();
    try {
      await invoke('delete_file', { path: filePaths[currentIndex] });
    } catch (e) {
      alert(`삭제 실패: ${e}`);
      return;
    }

    cache.shiftAfterDelete(currentIndex);
    filePaths.splice(currentIndex, 1);

    if (filePaths.length === 0) {
      canvas.width = 0; canvas.height = 0;
      statusBar.textContent = '이미지 없음';
      return;
    }
    if (currentIndex >= filePaths.length) currentIndex = filePaths.length - 1;

    if (cache.has(currentIndex)) { renderCurrentImage(); }
    else { showSpinner(spinner); preloadImage(currentIndex); }
    updateStatus();
    schedulePreload(currentIndex);
  });

  deleteCancelBtn.addEventListener('click', () => deleteDialog.close());

  // --- 이름 변경 팝업 ---
  function showRenameDialog() {
    if (filePaths.length === 0) return;
    renameInput.value = filePaths[currentIndex].replace(/\\/g, '/').split('/').pop();
    renameDialog.showModal();
    renameInput.select();
  }

  async function confirmRename() {
    const newName = renameInput.value.trim();
    if (!newName) return;
    renameDialog.close();
    try {
      filePaths[currentIndex] = await invoke('rename_file', {
        oldPath: filePaths[currentIndex],
        newName,
      });
      updateStatus();
    } catch (e) {
      alert(`이름 변경 실패: ${e}`);
    }
  }

  renameConfirmBtn.addEventListener('click', confirmRename);
  renameCancelBtn.addEventListener('click', () => renameDialog.close());
  renameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') confirmRename();
    if (e.key === 'Escape') renameDialog.close();
  });
});
