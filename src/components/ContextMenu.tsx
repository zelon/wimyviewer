import { useRef, useEffect } from 'react';

interface ContextMenuProps {
  x: number;
  y: number;
  onShowInExplorer: () => void;
  onClose: () => void;
}

export default function ContextMenu({ x, y, onShowInExplorer, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) {
        onCloseRef.current();
      }
    };
    window.addEventListener('mousedown', handleMouseDown);
    return () => window.removeEventListener('mousedown', handleMouseDown);
  }, []);

  return (
    <div
      ref={menuRef}
      id="context-menu"
      className="visible"
      style={{ left: `${x}px`, top: `${y}px` }}
    >
      <button id="ctx-show-in-explorer" onClick={onShowInExplorer}>탐색기에서 보기</button>
    </div>
  );
}
