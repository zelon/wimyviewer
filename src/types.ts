// ─── Tauri 이벤트 페이로드 ────────────────────────────────────────

export interface DragDropPayload {
  paths: string[];
  position?: { x: number; y: number };
}

// ─── 창 상태 저장 구조 ────────────────────────────────────────────

export interface WindowState {
  maximized: boolean;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
}
