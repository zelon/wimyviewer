export function renderImage(canvas, bitmap) {
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
}

export function showSpinner(spinner) {
  spinner.style.display = 'flex';
}

export function hideSpinner(spinner) {
  spinner.style.display = 'none';
}
