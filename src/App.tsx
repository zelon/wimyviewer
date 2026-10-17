import { useState, useRef, useEffect, useCallback } from 'react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { PhysicalSize, PhysicalPosition } from '@tauri-apps/api/dpi';
import { SlidingWindowCache } from './cache';
import { renderImage } from './renderer';
import type { DragDropPayload, WindowState } from './types';
import Toolbar from './components/Toolbar';
import Viewer from './components/Viewer';
import StatusBar from './components/StatusBar';
import DeleteDialog from './components/DeleteDialog';
import RenameDialog from './components/RenameDialog';
import ContextMenu from './components/ContextMenu';

const appWindow = getCurrentWindow();

// React 마운트 전에 즉시 시작 — useEffect 지연 없이 JS 로드 시점에 실행됨
const _startupFilePromise = invoke<string | null>('get_startup_file').catch(() => null);
const _windowStateRestored = (async () => {
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
})();

export default function App() {
  // ── React 상태 (재렌더링 트리거) ────────────────────────────────
  const [filePaths, setFilePaths] = useState<string[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(1.0);
  const [fitMode, setFitMode] = useState(() => localStorage.getItem('fitMode') === 'true');
  const [rotationAngle, setRotationAngle] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [dialog, setDialog] = useState<'none' | 'delete' | 'rename'>('none');
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const [saveDisabled, setSaveDisabled] = useState(true);

  // ── 뮤터블 레퍼런스 (안정적인 콜백에서 최신 값 참조) ───────────
  const filePathsRef = useRef<string[]>([]);
  const currentIndexRef = useRef(0);
  const zoomLevelRef = useRef(1.0);
  const fitModeRef = useRef(localStorage.getItem('fitMode') === 'true');
  const rotationAngleRef = useRef(0);
  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartYRef = useRef(0);
  const isFullscreenRef = useRef(false);
  const dialogRef = useRef<'none' | 'delete' | 'rename'>('none');
  const contextMenuOpenRef = useRef(false);
  const renameExtRef = useRef('');

  // ── DOM 레퍼런스 ─────────────────────────────────────────────────
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const canvasInnerRef = useRef<HTMLDivElement>(null);

  // ── 캐시 ─────────────────────────────────────────────────────────
  const cache = useRef(new SlidingWindowCache<ImageBitmap>(5));

  // ── 동기 세터 (ref + state 동시 업데이트) ────────────────────────
  // 이 함수들은 useCallback(fn, []) 클로저 내부에서 캡처되므로
  // 첫 렌더 시점의 함수가 캡처되지만, 내부적으로 stable ref/setter만 사용하므로 안전함
  const setFP = (paths: string[]) => { filePathsRef.current = paths; setFilePaths(paths); };
  const setCI = (i: number) => { currentIndexRef.current = i; setCurrentIndex(i); };
  const setZL = (z: number) => { zoomLevelRef.current = z; setZoomLevel(z); };
  const setFM = (f: boolean) => {
    fitModeRef.current = f;
    setFitMode(f);
    localStorage.setItem('fitMode', String(f));
  };
  const setFS = (f: boolean) => { isFullscreenRef.current = f; setIsFullscreen(f); };
  const setDlg = (d: 'none' | 'delete' | 'rename') => { dialogRef.current = d; setDialog(d); };
  const openContextMenu = (pos: { x: number; y: number }) => {
    contextMenuOpenRef.current = true;
    setContextMenuPos(pos);
  };
  const closeContextMenu = useCallback(() => {
    contextMenuOpenRef.current = false;
    setContextMenuPos(null);
  }, []);

  // ── 핵심 함수들 (stable callbacks — 모두 ref를 통해 최신 상태 접근) ──

  const calcFitZoom = useCallback((): number => {
    const canvas = canvasRef.current;
    const container = canvasContainerRef.current;
    if (!canvas || !container) return 1.0;
    return Math.min(
      container.clientWidth / canvas.width,
      container.clientHeight / canvas.height
    );
  }, []);

  const updateLayout = useCallback((): void => {
    const canvas = canvasRef.current;
    const container = canvasContainerRef.current;
    const inner = canvasInnerRef.current;
    if (!canvas || !container || !inner) return;

    let zoom = zoomLevelRef.current;
    if (fitModeRef.current && canvas.width > 0 && canvas.height > 0) {
      zoom = calcFitZoom();
      zoomLevelRef.current = zoom;
      setZoomLevel(zoom);
    }

    const iw = canvas.width * zoom;
    const ih = canvas.height * zoom;
    const cw = container.clientWidth;
    const ch = container.clientHeight;

    inner.style.width = `${Math.max(iw, cw)}px`;
    inner.style.height = `${Math.max(ih, ch)}px`;
    canvas.style.left = `${Math.max(0, (cw - iw) / 2)}px`;
    canvas.style.top = `${Math.max(0, (ch - ih) / 2)}px`;
    canvas.style.transform = `scale(${zoom})`;

    // 커서 업데이트
    const largerThanViewport =
      canvas.width * zoom > container.clientWidth ||
      canvas.height * zoom > container.clientHeight;
    if (isDraggingRef.current) canvas.style.cursor = 'grabbing';
    else if (largerThanViewport) canvas.style.cursor = 'grab';
    else canvas.style.cursor = 'default';
  }, [calcFitZoom]);

  const centerScroll = useCallback((): void => {
    const canvas = canvasRef.current;
    const container = canvasContainerRef.current;
    if (!canvas || !container) return;
    const zoom = zoomLevelRef.current;
    const iw = canvas.width * zoom;
    const ih = canvas.height * zoom;
    container.scrollLeft = Math.max(0, (iw - container.clientWidth) / 2);
    container.scrollTop = Math.max(0, (ih - container.clientHeight) / 2);
  }, []);

  const renderCurrentImage = useCallback((): void => {
    const canvas = canvasRef.current;
    if (!canvas || !cache.current.has(currentIndexRef.current)) return;
    renderImage(canvas, cache.current.get(currentIndexRef.current)!, rotationAngleRef.current);
    updateLayout();
    centerScroll();
    setIsLoading(false);
  }, [updateLayout, centerScroll]);

  const loadBitmap = useCallback(async (index: number): Promise<ImageBitmap> => {
    const path = filePathsRef.current[index];
    const ext = path.replace(/\\/g, '/').split('.').pop()!.toLowerCase();

    if (ext === 'psd') {
      const b64 = await invoke<string>('prepare_psd', { path });
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: 'image/png' });
      return createImageBitmap(blob);
    }

    const url = convertFileSrc(path);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`파일 로드 실패: ${response.status} ${path}`);
    const blob = await response.blob();
    return createImageBitmap(blob);
  }, []);

  const schedulePreload = useCallback((index: number): void => {
    cache.current.evict(index);
    const needed = cache.current.getNeeded(index, filePathsRef.current.length);
    for (const i of needed) {
      void (async () => {
        if (i < 0 || i >= filePathsRef.current.length) return;
        if (cache.current.has(i)) return;
        try {
          const bitmap = await loadBitmap(i);
          cache.current.set(i, bitmap);
          if (i === currentIndexRef.current) renderCurrentImage();
        } catch (e) {
          console.error(`프리로드 실패 (index ${i}):`, e);
        }
      })();
    }
  }, [loadBitmap, renderCurrentImage]);

  const navigate = useCallback(async (index: number): Promise<void> => {
    const paths = filePathsRef.current;
    if (paths.length === 0) return;
    index = Math.max(0, Math.min(paths.length - 1, index));
    if (index === currentIndexRef.current && cache.current.has(index)) return;

    setCI(index);
    rotationAngleRef.current = 0;
    setRotationAngle(0);
    setSaveDisabled(true);

    if (cache.current.has(index)) {
      renderCurrentImage();
    } else {
      setIsLoading(true);
      try {
        const bitmap = await loadBitmap(index);
        cache.current.set(index, bitmap);
        renderCurrentImage();
      } catch (e) {
        setIsLoading(false);
        console.error('이미지 로드 실패:', e);
      }
    }

    schedulePreload(index);
  }, [loadBitmap, renderCurrentImage, schedulePreload]);

  const rotateView = useCallback((delta = 90): void => {
    if (filePathsRef.current.length === 0) return;
    const newAngle = ((rotationAngleRef.current + delta) % 360 + 360) % 360;
    rotationAngleRef.current = newAngle;
    setRotationAngle(newAngle);
    setSaveDisabled(newAngle === 0);
    renderCurrentImage();
  }, [renderCurrentImage]);

  const saveRotated = useCallback(async (): Promise<void> => {
    if (filePathsRef.current.length === 0 || rotationAngleRef.current === 0) return;
    setSaveDisabled(true);
    try {
      const b64 = await invoke<string>('rotate_and_save', {
        path: filePathsRef.current[currentIndexRef.current],
        degrees: rotationAngleRef.current,
      });
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: 'image/png' });
      const bitmap = await createImageBitmap(blob);
      cache.current.invalidate(currentIndexRef.current);
      rotationAngleRef.current = 0;
      setRotationAngle(0);
      setSaveDisabled(true);
      cache.current.set(currentIndexRef.current, bitmap);
      renderCurrentImage();
      schedulePreload(currentIndexRef.current);
    } catch (e) {
      alert(`저장 실패: ${e}`);
      setSaveDisabled(false);
    }
  }, [renderCurrentImage, schedulePreload]);

  const enableFitMode = useCallback((): void => {
    fitModeRef.current = true;
    setFitMode(true);
    localStorage.setItem('fitMode', 'true');
    updateLayout();
    centerScroll();
  }, [updateLayout, centerScroll]);

  const openFileByPath = useCallback(async (selectedFile: string): Promise<void> => {
    const sep = selectedFile.includes('\\') ? '\\' : '/';
    const dir = selectedFile.substring(0, selectedFile.lastIndexOf(sep));

    const paths = await invoke<string[]>('load_directory', { dirPath: dir }).catch(() => null);
    if (!paths || paths.length === 0) return;

    setFP(paths);
    cache.current.clear();
    zoomLevelRef.current = 1.0;
    setZoomLevel(1.0);

    const startIndex = Math.max(0, paths.indexOf(selectedFile));
    setCI(startIndex);
    setIsLoading(true);

    try {
      const bitmap = await loadBitmap(startIndex);
      cache.current.set(startIndex, bitmap);
      renderCurrentImage();
    } catch (e) {
      setIsLoading(false);
      console.error(`이미지 로드 실패: ${e}`);
    }
    schedulePreload(startIndex);
  }, [loadBitmap, renderCurrentImage, schedulePreload]);

  const toggleFullscreen = useCallback(async (): Promise<void> => {
    const next = !isFullscreenRef.current;
    setFS(next);
    await appWindow.setFullscreen(next);
  }, []);

  const syncMaximizeIcon = useCallback(async (): Promise<void> => {
    const maximized = await appWindow.isMaximized();
    setIsMaximized(maximized);
  }, []);

  const saveWindowState = useCallback(async (): Promise<void> => {
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
  }, []);

  const showDeleteDialog = useCallback((): void => {
    if (filePathsRef.current.length === 0) return;
    setDlg('delete');
  }, []);

  const confirmDelete = useCallback(async (): Promise<void> => {
    setDlg('none');
    try {
      await invoke<void>('delete_file', { path: filePathsRef.current[currentIndexRef.current] });
    } catch (e) {
      alert(`삭제 실패: ${e}`);
      return;
    }

    cache.current.shiftAfterDelete(currentIndexRef.current);
    const newPaths = [...filePathsRef.current];
    newPaths.splice(currentIndexRef.current, 1);

    if (newPaths.length === 0) {
      const canvas = canvasRef.current;
      if (canvas) { canvas.width = 0; canvas.height = 0; }
      setFP([]);
      return;
    }

    let newIndex = currentIndexRef.current;
    if (newIndex >= newPaths.length) newIndex = newPaths.length - 1;

    setFP(newPaths);
    setCI(newIndex);

    if (cache.current.has(newIndex)) {
      renderCurrentImage();
    } else {
      setIsLoading(true);
    }
    schedulePreload(newIndex);
  }, [renderCurrentImage, schedulePreload]);

  const showRenameDialog = useCallback((): void => {
    if (filePathsRef.current.length === 0) return;
    const full = filePathsRef.current[currentIndexRef.current].replace(/\\/g, '/').split('/').pop()!;
    const dotIdx = full.lastIndexOf('.');
    renameExtRef.current = dotIdx > 0 ? full.slice(dotIdx) : '';
    setDlg('rename');
  }, []);

  const confirmRename = useCallback(async (baseName: string): Promise<void> => {
    const newName = baseName + renameExtRef.current;
    setDlg('none');
    try {
      const newPath = await invoke<string>('rename_file', {
        oldPath: filePathsRef.current[currentIndexRef.current],
        newName,
      });
      const newPaths = [...filePathsRef.current];
      newPaths[currentIndexRef.current] = newPath;
      setFP(newPaths);
    } catch (e) {
      alert(`이름 변경 실패: ${e}`);
    }
  }, []);

  // ── 초기화 (마운트 시 한 번만) ────────────────────────────────────
  useEffect(() => {
    void (async () => {
      await _windowStateRestored;
      await syncMaximizeIcon();
      const startupFile = await _startupFilePromise;
      if (startupFile) await openFileByPath(startupFile);
    })();

    let unlistenResize: (() => void) | null = null;
    let unlistenDragDrop: (() => void) | null = null;
    let unlistenClose: (() => void) | null = null;

    void listen('tauri://resize', () => { void syncMaximizeIcon(); })
      .then((fn) => { unlistenResize = fn; });

    void listen<DragDropPayload>('tauri://drag-drop', async (event) => {
      const paths = event.payload.paths;
      if (!Array.isArray(paths) || paths.length === 0) return;
      const supported = /\.(psd|png|jpg|jpeg|webp|bmp|gif|ico)$/i;
      const dropped = paths[0];
      if (supported.test(dropped)) {
        await openFileByPath(dropped);
      } else {
        const dirFiles = await invoke<string[]>('load_directory', { dirPath: dropped }).catch(() => null);
        if (dirFiles && dirFiles.length > 0) await openFileByPath(dirFiles[0]);
      }
    }).then((fn) => { unlistenDragDrop = fn; });

    void appWindow.onCloseRequested(async (event) => {
      event.preventDefault();
      await saveWindowState();
      await appWindow.destroy();
    }).then((fn) => { unlistenClose = fn; });

    return () => {
      unlistenResize?.();
      unlistenDragDrop?.();
      unlistenClose?.();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 창 리사이즈 ──────────────────────────────────────────────────
  useEffect(() => {
    const handleResize = () => {
      if (filePathsRef.current.length > 0) updateLayout();
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [updateLayout]);

  // ── 키보드 단축키 ─────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (dialogRef.current !== 'none') return;

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          await navigate(currentIndexRef.current - 1);
          break;
        case 'ArrowRight':
          e.preventDefault();
          await navigate(currentIndexRef.current + 1);
          break;
        case 'Home':
          e.preventDefault();
          await navigate(0);
          break;
        case 'End':
          e.preventDefault();
          await navigate(filePathsRef.current.length - 1);
          break;
        case 'Delete':
          e.preventDefault();
          showDeleteDialog();
          break;
        case 'F2':
          e.preventDefault();
          showRenameDialog();
          break;
        case 'F11':
          e.preventDefault();
          await toggleFullscreen();
          break;
        case 'f':
          e.preventDefault();
          await toggleFullscreen();
          break;
        case '1':
          e.preventDefault();
          if (filePathsRef.current.length > 0) {
            setFM(false);
            setZL(1.0);
            updateLayout();
            centerScroll();
          }
          break;
        case '0':
          e.preventDefault();
          if (filePathsRef.current.length > 0) enableFitMode();
          break;
        case 'Enter':
          if (e.altKey) { e.preventDefault(); await toggleFullscreen(); }
          break;
        case 'Escape':
          if (contextMenuOpenRef.current) {
            closeContextMenu();
          } else if (isFullscreenRef.current) {
            e.preventDefault();
            await toggleFullscreen();
          }
          break;
        case 'r':
        case 'R':
        case ']':
          e.preventDefault();
          rotateView(90);
          break;
        case '[':
          e.preventDefault();
          rotateView(-90);
          break;
        case 'x':
          if (e.altKey) { e.preventDefault(); await appWindow.close(); }
          break;
        case 'w':
          if (e.ctrlKey) { e.preventDefault(); await appWindow.close(); }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigate, showDeleteDialog, showRenameDialog, toggleFullscreen, enableFitMode, rotateView, closeContextMenu, updateLayout, centerScroll]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 마우스 드래그 (패닝) ─────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = canvasContainerRef.current;
    if (!canvas || !container) return;

    const handleMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const zoom = zoomLevelRef.current;
      const larger =
        canvas.width * zoom > container.clientWidth ||
        canvas.height * zoom > container.clientHeight;
      if (!larger) return;
      isDraggingRef.current = true;
      dragStartXRef.current = e.clientX + container.scrollLeft;
      dragStartYRef.current = e.clientY + container.scrollTop;
      canvas.style.cursor = 'grabbing';
      e.preventDefault();
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      container.scrollLeft = dragStartXRef.current - e.clientX;
      container.scrollTop = dragStartYRef.current - e.clientY;
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (e.button !== 0 || !isDraggingRef.current) return;
      isDraggingRef.current = false;
      updateLayout();
    };

    canvas.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [updateLayout]);

  // ── 마우스 휠 (줌 / 이미지 이동) ────────────────────────────────
  useEffect(() => {
    const handleWheel = async (e: WheelEvent) => {
      e.preventDefault();
      const canvas = canvasRef.current;
      const container = canvasContainerRef.current;
      if (!canvas || !container) return;

      if (e.ctrlKey) {
        fitModeRef.current = false;
        setFitMode(false);
        localStorage.setItem('fitMode', 'false');

        const oldZoom = zoomLevelRef.current;
        const cw = container.clientWidth;
        const ch = container.clientHeight;
        const oldLeft = Math.max(0, (cw - canvas.width * oldZoom) / 2);
        const oldTop  = Math.max(0, (ch - canvas.height * oldZoom) / 2);
        const imgPx = (container.scrollLeft + cw / 2 - oldLeft) / oldZoom;
        const imgPy = (container.scrollTop  + ch / 2 - oldTop)  / oldZoom;

        const newZoom = Math.max(0.1, Math.min(10.0, oldZoom + (e.deltaY > 0 ? -0.1 : 0.1)));
        zoomLevelRef.current = newZoom;
        setZoomLevel(newZoom);
        updateLayout();

        const newLeft = Math.max(0, (cw - canvas.width * newZoom) / 2);
        const newTop  = Math.max(0, (ch - canvas.height * newZoom) / 2);
        container.scrollLeft = imgPx * newZoom + newLeft - cw / 2;
        container.scrollTop  = imgPy * newZoom + newTop  - ch / 2;
      } else {
        await navigate(currentIndexRef.current + (e.deltaY > 0 ? 1 : -1));
      }
    };

    window.addEventListener('wheel', handleWheel, { passive: false });
    return () => window.removeEventListener('wheel', handleWheel);
  }, [navigate, updateLayout]);

  // ── 캔버스 우클릭 컨텍스트 메뉴 ─────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleContextMenu = (e: MouseEvent) => {
      if (filePathsRef.current.length === 0) return;
      e.preventDefault();
      const x = Math.min(e.clientX, window.innerWidth - 184);
      const y = Math.min(e.clientY, window.innerHeight - 40);
      openContextMenu({ x, y });
    };

    canvas.addEventListener('contextmenu', handleContextMenu);
    return () => canvas.removeEventListener('contextmenu', handleContextMenu);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openFileDialog = async (): Promise<void> => {
    const selected = await invoke<string | null>('select_file').catch(() => null);
    if (selected) await openFileByPath(selected);
  };

  // ── JSX용 파생 값 ─────────────────────────────────────────────────
  const filename = filePaths.length > 0
    ? filePaths[currentIndex].replace(/\\/g, '/').split('/').pop()!
    : '폴더를 열어 이미지를 불러오세요.';

  const zoomPct = Math.round(zoomLevel * 100);
  const rotPrefix = rotationAngle !== 0 ? `(${rotationAngle}도) ` : '';
  const zoomText = filePaths.length > 0
    ? (fitMode ? `${rotPrefix}Fit (${zoomPct}%)` : `${rotPrefix}${zoomPct}%`)
    : '';

  const renameInitialName = (() => {
    if (filePaths.length === 0) return '';
    const full = filePaths[currentIndex].replace(/\\/g, '/').split('/').pop()!;
    const dotIdx = full.lastIndexOf('.');
    return dotIdx > 0 ? full.slice(0, dotIdx) : full;
  })();

  const deleteFilename = filePaths.length > 0
    ? filePaths[currentIndex].replace(/\\/g, '/').split('/').pop()!
    : '';

  return (
    <>
      {!isFullscreen && (
        <Toolbar
          fitMode={fitMode}
          zoomLevel={zoomLevel}
          saveDisabled={saveDisabled}
          isMaximized={isMaximized}
          onOpen={() => { void openFileDialog(); }}
          onZoomActual={() => {
            if (filePaths.length === 0) return;
            setFM(false);
            setZL(1.0);
            updateLayout();
            centerScroll();
          }}
          onZoomFit={() => {
            if (filePaths.length > 0) enableFitMode();
          }}
          onRotate={() => rotateView(90)}
          onSave={() => { void saveRotated(); }}
          onMinimize={() => { void appWindow.minimize(); }}
          onMaximize={async () => {
            await appWindow.toggleMaximize();
            await syncMaximizeIcon();
          }}
          onClose={() => { void appWindow.close(); }}
        />
      )}
      <Viewer
        canvasRef={canvasRef}
        canvasContainerRef={canvasContainerRef}
        canvasInnerRef={canvasInnerRef}
        isLoading={isLoading}
        isEmpty={filePaths.length === 0}
        onOpen={() => { void openFileDialog(); }}
        onPrev={() => { void navigate(currentIndexRef.current - 1); }}
        onNext={() => { void navigate(currentIndexRef.current + 1); }}
      />
      {!isFullscreen && (
        <StatusBar
          filename={filename}
          counter={filePaths.length > 0 ? `${currentIndex + 1} / ${filePaths.length}` : '—'}
          zoomText={zoomText}
          sliderMax={Math.max(0, filePaths.length - 1)}
          sliderValue={filePaths.length > 0 ? currentIndex : 0}
          onSliderChange={(v) => { void navigate(v); }}
        />
      )}
      <DeleteDialog
        open={dialog === 'delete'}
        filename={deleteFilename}
        onConfirm={() => { void confirmDelete(); }}
        onCancel={() => setDlg('none')}
      />
      <RenameDialog
        open={dialog === 'rename'}
        initialName={renameInitialName}
        ext={renameExtRef.current}
        onConfirm={(name) => { void confirmRename(name); }}
        onCancel={() => setDlg('none')}
      />
      {contextMenuPos && (
        <ContextMenu
          x={contextMenuPos.x}
          y={contextMenuPos.y}
          onShowInExplorer={() => {
            closeContextMenu();
            void invoke<void>('show_in_explorer', {
              path: filePathsRef.current[currentIndexRef.current],
            }).catch(console.error);
          }}
          onClose={closeContextMenu}
        />
      )}
    </>
  );
}
