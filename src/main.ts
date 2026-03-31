import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { PhysicalSize, PhysicalPosition } from '@tauri-apps/api/dpi';
import { SlidingWindowCache } from './cache';
import { renderImage, showSpinner, hideSpinner } from './renderer';
import type { DragDropPayload, WindowState } from './types';

window.addEventListener('DOMContentLoaded', async () => {
  const appWindow = getCurrentWindow();

  // --- DOM 요소 ---
  const canvas = document.getElementById('viewer') as HTMLCanvasElement;
  const canvasContainer = document.getElementById('canvas-container') as HTMLElement;
  const canvasInner = document.getElementById('canvas-inner') as HTMLElement;
  const spinner = document.getElementById('spinner') as HTMLElement;
  const statusFilename = document.getElementById('status-filename') as HTMLElement;
  const statusCounter = document.getElementById('status-counter') as HTMLElement;
  const statusZoom = document.getElementById('status-zoom') as HTMLElement;
  const progressSlider = document.getElementById('progress-slider') as HTMLInputElement;
  const navPrev = document.getElementById('nav-prev') as HTMLButtonElement;
  const navNext = document.getElementById('nav-next') as HTMLButtonElement;
  const zoomActualBtn = document.getElementById('zoom-actual') as HTMLButtonElement;
  const zoomFitBtn = document.getElementById('zoom-fit') as HTMLButtonElement;
  const openFolderBtn = document.getElementById('open-folder') as HTMLButtonElement;
  const rotateBtn = document.getElementById('rotate-btn') as HTMLButtonElement;
  const saveBtn = document.getElementById('save-btn') as HTMLButtonElement;
  const deleteDialog = document.getElementById('delete-dialog') as HTMLDialogElement;
  const deleteFilename = document.getElementById('delete-filename') as HTMLElement;
  const deleteConfirmBtn = document.getElementById('delete-confirm') as HTMLButtonElement;
  const deleteCancelBtn = document.getElementById('delete-cancel') as HTMLButtonElement;
  const renameDialog = document.getElementById('rename-dialog') as HTMLDialogElement;
  const renameInput = document.getElementById('rename-input') as HTMLInputElement;
  const renameExtSpan = document.getElementById('rename-ext') as HTMLElement;
  const renameConfirmBtn = document.getElementById('rename-confirm') as HTMLButtonElement;
  const renameCancelBtn = document.getElementById('rename-cancel') as HTMLButtonElement;
  const contextMenu = document.getElementById('context-menu') as HTMLElement;
  const ctxShowInExplorer = document.getElementById('ctx-show-in-explorer') as HTMLButtonElement;

  // --- 상태 ---
  let filePaths: string[] = [];
  let currentIndex = 0;
  let zoomLevel = 1.0;
  let fitMode = localStorage.getItem('fitMode') === 'true';
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let rotationAngle = 0; // 0, 90, 180, 270
  const cache = new SlidingWindowCache<ImageBitmap>(5);

  // --- 이미지 로드 ---
  // JPG/PNG/BMP/GIF/WebP/ICO: convertFileSrc → asset:// URL → 브라우저 네이티브 디코딩
  // PSD: Rust 디코딩 → base64 PNG → Blob → createImageBitmap
  async function loadBitmap(index: number): Promise<ImageBitmap> {
    const path = filePaths[index];
    const ext = path.replace(/\\/g, '/').split('.').pop()!.toLowerCase();

    if (ext === 'psd') {
      const b64 = await invoke<string>('prepare_psd', { path });
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
  async function preloadImage(index: number): Promise<void> {
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
  async function navigate(index: number): Promise<void> {
    if (filePaths.length === 0) return;
    index = Math.max(0, Math.min(filePaths.length - 1, index));
    if (index === currentIndex && cache.has(index)) return;

    currentIndex = index;
    rotationAngle = 0;
    saveBtn.disabled = true;
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
  function schedulePreload(index: number): void {
    cache.evict(index);
    const needed = cache.getNeeded(index, filePaths.length);
    for (const i of needed) {
      preloadImage(i); // await 없음 — 모두 동시에 실행
    }
  }

  function renderCurrentImage(): void {
    if (!cache.has(currentIndex)) return;
    renderImage(canvas, cache.get(currentIndex)!, rotationAngle);
    updateLayout();
    centerScroll();
    hideSpinner(spinner);
    updateStatus();
  }

  function rotateView(delta = 90): void {
    if (filePaths.length === 0) return;
    rotationAngle = ((rotationAngle + delta) % 360 + 360) % 360;
    saveBtn.disabled = rotationAngle === 0;
    renderCurrentImage();
  }

  async function saveRotated(): Promise<void> {
    if (filePaths.length === 0 || rotationAngle === 0) return;
    saveBtn.disabled = true;
    try {
      // Rust가 저장 후 회전된 이미지를 base64 PNG로 반환 → 브라우저 캐시 문제 없이 바로 사용
      const b64 = await invoke<string>('rotate_and_save', { path: filePaths[currentIndex], degrees: rotationAngle });
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: 'image/png' });
      const bitmap = await createImageBitmap(blob);
      cache.invalidate(currentIndex);
      rotationAngle = 0;
      saveBtn.disabled = true;
      updateStatus();
      cache.set(currentIndex, bitmap);
      renderCurrentImage();
      schedulePreload(currentIndex);
    } catch (e) {
      alert(`저장 실패: ${e}`);
      saveBtn.disabled = false;
    }
  }

  // --- 풀스크린 ---
  let isFullscreen = false;

  async function toggleFullscreen(): Promise<void> {
    isFullscreen = !isFullscreen;
    await appWindow.setFullscreen(isFullscreen);
    (document.getElementById('toolbar') as HTMLElement).style.display = isFullscreen ? 'none' : '';
    (document.getElementById('status-bar') as HTMLElement).style.display = isFullscreen ? 'none' : '';
  }

  function calcFitZoom(): number {
    return Math.min(
      canvasContainer.clientWidth / canvas.width,
      canvasContainer.clientHeight / canvas.height
    );
  }

  function enableFitMode(): void {
    fitMode = true;
    localStorage.setItem('fitMode', 'true');
    zoomLevel = calcFitZoom();
    updateLayout();
    centerScroll();
    updateStatus();
  }

  window.addEventListener('resize', () => {
    if (filePaths.length > 0) updateLayout();
  });

  // --- 줌 + 패닝 ---
  function updateLayout(): void {
    if (fitMode && canvas.width > 0 && canvas.height > 0) {
      zoomLevel = calcFitZoom();
      updateStatus();
    }
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

  function centerScroll(): void {
    const iw = canvas.width * zoomLevel;
    const ih = canvas.height * zoomLevel;
    canvasContainer.scrollLeft = Math.max(0, (iw - canvasContainer.clientWidth) / 2);
    canvasContainer.scrollTop = Math.max(0, (ih - canvasContainer.clientHeight) / 2);
  }

  function isImageLargerThanViewport(): boolean {
    return canvas.width * zoomLevel > canvasContainer.clientWidth ||
           canvas.height * zoomLevel > canvasContainer.clientHeight;
  }

  function updateCursor(): void {
    if (isDragging) canvas.style.cursor = 'grabbing';
    else if (isImageLargerThanViewport()) canvas.style.cursor = 'grab';
    else canvas.style.cursor = 'default';
  }

  // 드래그로 패닝
  canvas.addEventListener('mousedown', (e: MouseEvent) => {
    if (e.button !== 0 || !isImageLargerThanViewport()) return;
    isDragging = true;
    dragStartX = e.clientX + canvasContainer.scrollLeft;
    dragStartY = e.clientY + canvasContainer.scrollTop;
    canvas.style.cursor = 'grabbing';
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e: MouseEvent) => {
    if (!isDragging) return;
    canvasContainer.scrollLeft = dragStartX - e.clientX;
    canvasContainer.scrollTop = dragStartY - e.clientY;
  });

  window.addEventListener('mouseup', (e: MouseEvent) => {
    if (e.button !== 0 || !isDragging) return;
    isDragging = false;
    updateCursor();
  });

  // --- 컨텍스트 메뉴 ---
  function hideContextMenu(): void {
    contextMenu.style.display = 'none';
  }

  canvas.addEventListener('contextmenu', (e: MouseEvent) => {
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
    invoke<void>('show_in_explorer', { path: filePaths[currentIndex] }).catch(console.error);
  });

  window.addEventListener('mousedown', (e: MouseEvent) => {
    if (!contextMenu.contains(e.target as Node)) hideContextMenu();
  });

  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') hideContextMenu();
  }, true);

  // --- 상태바 ---
  function updateStatus(): void {
    if (filePaths.length === 0) {
      statusFilename.textContent = '이미지 없음';
      statusCounter.textContent = '—';
      statusZoom.textContent = '';
      progressSlider.max = '0';
      progressSlider.value = '0';
      zoomFitBtn.classList.remove('active');
      zoomActualBtn.classList.remove('active');
      return;
    }
    const filename = filePaths[currentIndex].replace(/\\/g, '/').split('/').pop()!;
    const zoomPct = Math.round(zoomLevel * 100);
    statusFilename.textContent = filename;
    statusCounter.textContent = `${currentIndex + 1} / ${filePaths.length}`;
    const rotPrefix = rotationAngle !== 0 ? `(${rotationAngle}도) ` : '';
    statusZoom.textContent = fitMode ? `${rotPrefix}Fit (${zoomPct}%)` : `${rotPrefix}${zoomPct}%`;
    progressSlider.max = String(filePaths.length - 1);
    progressSlider.value = String(currentIndex);
    zoomFitBtn.classList.toggle('active', fitMode);
    zoomActualBtn.classList.toggle('active', !fitMode && zoomLevel === 1.0);
  }

  // --- 파일 열기 ---
  async function openFileByPath(selectedFile: string): Promise<void> {
    const sep = selectedFile.includes('\\') ? '\\' : '/';
    const dir = selectedFile.substring(0, selectedFile.lastIndexOf(sep));

    const paths = await invoke<string[]>('load_directory', { dirPath: dir }).catch((e: unknown) => {
      statusFilename.textContent = `디렉토리 로드 실패: ${e}`;
      return null;
    });
    if (!paths) return;

    if (paths.length === 0) {
      statusFilename.textContent = '지원하는 이미지 파일이 없습니다.';
      return;
    }

    filePaths = paths;
    cache.clear();
    zoomLevel = 1.0;

    const startIndex = Math.max(0, paths.indexOf(selectedFile));
    currentIndex = startIndex;
    showSpinner(spinner);
    updateStatus();

    try {
      const bitmap = await loadBitmap(startIndex);
      cache.set(startIndex, bitmap);
      renderCurrentImage();
    } catch (e) {
      hideSpinner(spinner);
      statusFilename.textContent = `이미지 로드 실패: ${e}`;
    }
    schedulePreload(startIndex);
  }

  openFolderBtn.addEventListener('click', async () => {
    const selectedFile = await invoke<string | null>('select_file').catch(() => null);
    if (!selectedFile) return;
    await openFileByPath(selectedFile);
  });

  // --- 툴바 줌 버튼 ---
  zoomActualBtn.addEventListener('click', () => {
    if (filePaths.length === 0) return;
    fitMode = false;
    localStorage.setItem('fitMode', 'false');
    zoomLevel = 1.0;
    updateLayout();
    centerScroll();
    updateStatus();
  });

  zoomFitBtn.addEventListener('click', () => {
    if (filePaths.length > 0) enableFitMode();
  });

  rotateBtn.addEventListener('click', () => rotateView(90));
  saveBtn.addEventListener('click', saveRotated);

  // --- 창 상태 저장/복원 ---
  async function saveWindowState(): Promise<void> {
    const maximized = await appWindow.isMaximized();
    if (maximized) {
      localStorage.setItem('windowState', JSON.stringify({ maximized: true } satisfies WindowState));
    } else {
      const size = await appWindow.outerSize();
      const pos = await appWindow.outerPosition();
      localStorage.setItem('windowState', JSON.stringify({
        maximized: false,
        width: size.width,
        height: size.height,
        x: pos.x,
        y: pos.y,
      } satisfies WindowState));
    }
  }

  async function restoreWindowState(): Promise<void> {
    const raw = localStorage.getItem('windowState');
    if (!raw) return;
    try {
      const state: WindowState = JSON.parse(raw);
      if (state.maximized) {
        await appWindow.maximize();
      } else if (state.width && state.height) {
        await appWindow.setSize(new PhysicalSize(state.width, state.height));
        if (state.x != null && state.y != null) {
          await appWindow.setPosition(new PhysicalPosition(state.x, state.y));
        }
      }
    } catch (e) {
      console.warn('창 상태 복원 실패:', e);
    }
  }

  await restoreWindowState();

  // --- 윈도우 컨트롤 ---
  const winMaximizeBtn = document.getElementById('win-maximize') as HTMLButtonElement;

  const ICON_MAXIMIZE = `<svg viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1"/></svg>`;
  const ICON_RESTORE  = `<svg viewBox="0 0 10 10"><rect x="2" y="0" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1"/><rect x="0" y="2" width="8" height="8" fill="#111114" stroke="currentColor" stroke-width="1"/></svg>`;

  async function syncMaximizeIcon(): Promise<void> {
    const maximized = await appWindow.isMaximized();
    winMaximizeBtn.innerHTML = maximized ? ICON_RESTORE : ICON_MAXIMIZE;
    winMaximizeBtn.title = maximized ? '이전 크기로' : '최대화';
  }

  document.getElementById('win-minimize')!.addEventListener('click', () => appWindow.minimize());
  winMaximizeBtn.addEventListener('click', async () => {
    await appWindow.toggleMaximize();
    await syncMaximizeIcon();
  });
  document.getElementById('win-close')!.addEventListener('click', () => appWindow.close());

  await listen('tauri://resize', syncMaximizeIcon);
  await appWindow.onCloseRequested(async (event) => {
    event.preventDefault();
    await saveWindowState();
    await appWindow.destroy();
  });
  await syncMaximizeIcon();

  // --- 네비게이션 화살표 ---
  navPrev.addEventListener('click', () => navigate(currentIndex - 1));
  navNext.addEventListener('click', () => navigate(currentIndex + 1));

  // --- 진행 슬라이더 ---
  progressSlider.addEventListener('input', (e: Event) => {
    navigate(parseInt((e.target as HTMLInputElement).value));
  });

  // 시작 인자로 파일이 전달된 경우 자동으로 열기
  const startupFile = await invoke<string | null>('get_startup_file').catch(() => null);
  if (startupFile) {
    await openFileByPath(startupFile);
  }

  // --- 파일 드래그-드롭 ---
  await listen<DragDropPayload>('tauri://drag-drop', async (event) => {
    const paths = event.payload.paths;
    if (!Array.isArray(paths) || paths.length === 0) return;
    const supported = /\.(psd|png|jpg|jpeg|webp|bmp|gif|ico)$/i;
    const dropped = paths[0];

    if (supported.test(dropped)) {
      await openFileByPath(dropped);
    } else {
      // 폴더로 간주하고 디렉토리 내 첫 번째 파일 열기
      const dirFiles = await invoke<string[]>('load_directory', { dirPath: dropped }).catch(() => null);
      if (dirFiles && dirFiles.length > 0) await openFileByPath(dirFiles[0]);
    }
  });

  // --- 키보드 ---
  window.addEventListener('keydown', async (e: KeyboardEvent) => {
    if (deleteDialog.open || renameDialog.open) return;
    switch (e.key) {
      case 'ArrowLeft':  e.preventDefault(); await navigate(currentIndex - 1); break;
      case 'ArrowRight': e.preventDefault(); await navigate(currentIndex + 1); break;
      case 'Home':       e.preventDefault(); await navigate(0);                break;
      case 'End':        e.preventDefault(); await navigate(filePaths.length - 1); break;
      case 'Delete':     e.preventDefault(); showDeleteDialog(); break;
      case 'F2':         e.preventDefault(); showRenameDialog(); break;
      case 'F11':        e.preventDefault(); await toggleFullscreen(); break;
      case 'f':          e.preventDefault(); await toggleFullscreen(); break;
      case '1':
        e.preventDefault();
        if (filePaths.length > 0) { fitMode = false; localStorage.setItem('fitMode', 'false'); zoomLevel = 1.0; updateLayout(); centerScroll(); updateStatus(); }
        break;
      case '0':
        e.preventDefault();
        if (filePaths.length > 0) enableFitMode();
        break;
      case 'Enter':
        if (e.altKey) { e.preventDefault(); await toggleFullscreen(); }
        break;
      case 'Escape':
        if (isFullscreen) { e.preventDefault(); await toggleFullscreen(); }
        break;
      case 'r':
      case 'R':
      case ']':
        e.preventDefault(); rotateView(90); break;
      case '[':
        e.preventDefault(); rotateView(-90); break;
      case 'x':
        if (e.altKey) { e.preventDefault(); await appWindow.close(); }
        break;
      case 'w':
        if (e.ctrlKey) { e.preventDefault(); await appWindow.close(); }
        break;
    }
  });

  // --- 마우스 휠 ---
  window.addEventListener('wheel', async (e: WheelEvent) => {
    e.preventDefault();
    if (e.ctrlKey) {
      fitMode = false;
      localStorage.setItem('fitMode', 'false');
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
  function showDeleteDialog(): void {
    if (filePaths.length === 0) return;
    deleteFilename.textContent = filePaths[currentIndex].replace(/\\/g, '/').split('/').pop()!;
    deleteDialog.showModal();
  }

  deleteConfirmBtn.addEventListener('click', async () => {
    deleteDialog.close();
    try {
      await invoke<void>('delete_file', { path: filePaths[currentIndex] });
    } catch (e) {
      alert(`삭제 실패: ${e}`);
      return;
    }

    cache.shiftAfterDelete(currentIndex);
    filePaths.splice(currentIndex, 1);

    if (filePaths.length === 0) {
      canvas.width = 0; canvas.height = 0;
      updateStatus();
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
  let renameExt = '';

  function showRenameDialog(): void {
    if (filePaths.length === 0) return;
    const full = filePaths[currentIndex].replace(/\\/g, '/').split('/').pop()!;
    const dotIdx = full.lastIndexOf('.');
    if (dotIdx > 0) {
      renameExt = full.slice(dotIdx);          // e.g. ".png"
      renameInput.value = full.slice(0, dotIdx);
    } else {
      renameExt = '';
      renameInput.value = full;
    }
    renameExtSpan.textContent = renameExt;
    renameDialog.showModal();
    renameInput.select();
  }

  async function confirmRename(): Promise<void> {
    const baseName = renameInput.value.trim();
    if (!baseName) return;
    const newName = baseName + renameExt;
    renameDialog.close();
    try {
      filePaths[currentIndex] = await invoke<string>('rename_file', {
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
  renameInput.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') confirmRename();
    if (e.key === 'Escape') renameDialog.close();
  });
});
