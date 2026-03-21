use image::ImageFormat;
use std::io::Cursor;

/// PSD 파일을 PNG 바이트로 변환 (브라우저가 PSD를 지원하지 않으므로 Rust에서 처리)
pub fn decode_psd(path: &str) -> Result<Vec<u8>, String> {
    let file_bytes =
        std::fs::read(path).map_err(|e| format!("PSD 파일 읽기 실패 ({}): {}", path, e))?;

    let psd =
        psd::Psd::from_bytes(&file_bytes).map_err(|e| format!("PSD 파싱 실패: {:?}", e))?;

    let img = image::RgbaImage::from_raw(psd.width(), psd.height(), psd.rgba())
        .ok_or_else(|| "PSD 픽셀 데이터로 이미지 생성 실패".to_string())?;

    let mut bytes = Vec::new();
    image::DynamicImage::ImageRgba8(img)
        .write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png)
        .map_err(|e| format!("PNG 인코딩 실패: {}", e))?;

    Ok(bytes)
}
