interface StatusBarProps {
  filename: string;
  counter: string;
  zoomText: string;
  sliderMax: number;
  sliderValue: number;
  onSliderChange: (value: number) => void;
}

export default function StatusBar({
  filename,
  counter,
  zoomText,
  sliderMax,
  sliderValue,
  onSliderChange,
}: StatusBarProps) {
  return (
    <div id="status-bar">
      <div className="status-progress-row">
        <input
          type="range"
          id="progress-slider"
          min={0}
          max={sliderMax}
          value={sliderValue}
          onChange={(e) => onSliderChange(parseInt(e.target.value))}
        />
        <span id="status-counter">{counter}</span>
      </div>
      <div className="status-info-row">
        <span id="status-filename">{filename}</span>
        <span id="status-zoom">{zoomText}</span>
      </div>
    </div>
  );
}
