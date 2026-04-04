interface ToolbarProps {
  fitMode: boolean;
  zoomLevel: number;
  saveDisabled: boolean;
  isMaximized: boolean;
  onOpen: () => void;
  onZoomActual: () => void;
  onZoomFit: () => void;
  onRotate: () => void;
  onSave: () => void;
  onMinimize: () => void;
  onMaximize: () => void;
  onClose: () => void;
}

export default function Toolbar({
  fitMode,
  zoomLevel,
  saveDisabled,
  isMaximized,
  onOpen,
  onZoomActual,
  onZoomFit,
  onRotate,
  onSave,
  onMinimize,
  onMaximize,
  onClose,
}: ToolbarProps) {
  return (
    <div id="toolbar" data-tauri-drag-region="">
      <span className="app-title" data-tauri-drag-region="">WimyViewer</span>
      <div className="toolbar-actions">
        <button className="tool-btn" title="파일 열기" onClick={onOpen}>열기</button>
        <div className="toolbar-sep" />
        <button
          className={`tool-btn${!fitMode && zoomLevel === 1.0 ? ' active' : ''}`}
          title="실제 크기 (1)"
          onClick={onZoomActual}
        >
          1:1
        </button>
        <button
          className={`tool-btn${fitMode ? ' active' : ''}`}
          title="화면 맞춤 (0)"
          onClick={onZoomFit}
        >
          Fit
        </button>
        <div className="toolbar-sep" />
        <button className="tool-btn" title="시계 방향 90도 회전 (R)" onClick={onRotate}>회전</button>
        <button
          className="tool-btn"
          title="회전된 상태로 파일 저장"
          disabled={saveDisabled}
          onClick={onSave}
        >
          저장
        </button>
      </div>
      <div className="win-controls">
        <button id="win-minimize" className="win-btn" title="최소화" onClick={onMinimize}>
          <svg viewBox="0 0 10 1"><rect width="10" height="1" /></svg>
        </button>
        <button
          id="win-maximize"
          className="win-btn"
          title={isMaximized ? '이전 크기로' : '최대화'}
          onClick={onMaximize}
        >
          {isMaximized ? (
            <svg viewBox="0 0 10 10">
              <rect x="2" y="0" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1" />
              <rect x="0" y="2" width="8" height="8" fill="#111114" stroke="currentColor" strokeWidth="1" />
            </svg>
          ) : (
            <svg viewBox="0 0 10 10">
              <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" />
            </svg>
          )}
        </button>
        <button id="win-close" className="win-btn" title="닫기" onClick={onClose}>
          <svg viewBox="0 0 10 10">
            <line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" strokeWidth="1.2" />
            <line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
      </div>
    </div>
  );
}
