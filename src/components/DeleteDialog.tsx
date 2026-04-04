import { useRef, useEffect } from 'react';

interface DeleteDialogProps {
  open: boolean;
  filename: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function DeleteDialog({ open, filename, onConfirm, onCancel }: DeleteDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (open) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [open]);

  return (
    <dialog ref={dialogRef} id="delete-dialog">
      <h3>파일 삭제</h3>
      <p>
        아래 파일을 삭제하시겠습니까?<br />
        <strong>{filename}</strong>
      </p>
      <div className="dialog-buttons">
        <button className="btn-cancel" onClick={onCancel}>취소</button>
        <button className="btn-confirm" onClick={onConfirm}>삭제</button>
      </div>
    </dialog>
  );
}
