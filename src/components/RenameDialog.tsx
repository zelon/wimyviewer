import { useRef, useEffect, useState } from 'react';

interface RenameDialogProps {
  open: boolean;
  initialName: string;
  ext: string;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

export default function RenameDialog({ open, initialName, ext, onConfirm, onCancel }: RenameDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');

  useEffect(() => {
    if (open) {
      setValue(initialName);
      dialogRef.current?.showModal();
      // state 반영(재렌더)을 기다리지 않고 DOM 값을 먼저 맞춘 뒤 전체 선택.
      // 재렌더 시 React는 값이 같으면 DOM을 건드리지 않으므로 선택이 유지된다.
      const input = inputRef.current;
      if (input) {
        input.value = initialName;
        input.focus();
        input.select();
      }
    } else {
      dialogRef.current?.close();
    }
  }, [open, initialName]);

  const handleConfirm = () => {
    if (value.trim()) onConfirm(value.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleConfirm();
    if (e.key === 'Escape') onCancel();
  };

  return (
    <dialog ref={dialogRef} id="rename-dialog">
      <h3>파일 이름 변경</h3>
      <div className="rename-row">
        <input
          ref={inputRef}
          type="text"
          id="rename-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          autoComplete="off"
          spellCheck={false}
        />
        <span id="rename-ext">{ext}</span>
      </div>
      <div className="dialog-buttons">
        <button className="btn-cancel" onClick={onCancel}>취소</button>
        <button id="rename-confirm" onClick={handleConfirm}>변경</button>
      </div>
    </dialog>
  );
}
