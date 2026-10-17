import type React from 'react';

interface ViewerProps {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  canvasContainerRef: React.RefObject<HTMLDivElement>;
  canvasInnerRef: React.RefObject<HTMLDivElement>;
  isLoading: boolean;
  isEmpty: boolean;
  onOpen: () => void;
  onPrev: () => void;
  onNext: () => void;
}

export default function Viewer({
  canvasRef,
  canvasContainerRef,
  canvasInnerRef,
  isLoading,
  isEmpty,
  onOpen,
  onPrev,
  onNext,
}: ViewerProps) {
  return (
    <div id="viewer-wrapper">
      <div id="canvas-container" ref={canvasContainerRef}>
        <div id="canvas-inner" ref={canvasInnerRef}>
          <canvas id="viewer" ref={canvasRef} />
        </div>
        <div id="spinner" style={{ display: isLoading ? 'flex' : 'none' }}>
          <div className="spinner-ring" />
        </div>
        {isEmpty && !isLoading && (
          <div id="empty-state">
            <button id="empty-open" onClick={onOpen}>열기</button>
            <span className="empty-hint">혹은 탐색기로부터 이미지를 드래그하세요</span>
          </div>
        )}
      </div>
      <button id="nav-prev" className="nav-arrow" onClick={onPrev}>&#8249;</button>
      <button id="nav-next" className="nav-arrow" onClick={onNext}>&#8250;</button>
    </div>
  );
}
