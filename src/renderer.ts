export function renderImage(canvas: HTMLCanvasElement, bitmap: ImageBitmap, rotation = 0): void {
  const rot = ((rotation % 360) + 360) % 360;
  if (rot === 90 || rot === 270) {
    canvas.width = bitmap.height;
    canvas.height = bitmap.width;
  } else {
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
  }
  const ctx = canvas.getContext('2d')!;
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
  ctx.restore();
}

export function showSpinner(spinner: HTMLElement): void {
  spinner.style.display = 'flex';
}

export function hideSpinner(spinner: HTMLElement): void {
  spinner.style.display = 'none';
}
