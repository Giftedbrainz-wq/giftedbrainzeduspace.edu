import zlib from "node:zlib";

export function decodePdfAscii85(value) {
  const text = Buffer.from(value).toString("latin1").replace(/\s+/g, "").replace(/^<~/, "").replace(/~>.*$/, "");
  const out = [];
  let group = [];
  const flush = (chars, partial = false) => {
    if (!chars.length) return;
    const originalLength = chars.length;
    while (chars.length < 5) chars.push(117); // 'u' is the ASCII85 padding digit.
    let n = 0;
    for (const c of chars) n = n * 85 + (c - 33);
    if (!Number.isFinite(n) || n > 0xffffffff) return;
    const bytes = [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
    out.push(...bytes.slice(0, partial ? Math.max(0, originalLength - 1) : 4));
  };
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (text[i] === "z" && group.length === 0) { out.push(0, 0, 0, 0); continue; }
    if (code < 33 || code > 117) continue;
    group.push(code);
    if (group.length === 5) { flush(group); group = []; }
  }
  if (group.length > 1) flush(group, true);
  return Buffer.from(out);
}
function pngCrc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function pdfPngChunk(type, data) {
  const name = Buffer.from(type, "ascii"), payload = Buffer.from(data || []);
  const out = Buffer.alloc(12 + payload.length);
  out.writeUInt32BE(payload.length, 0); name.copy(out, 4); payload.copy(out, 8);
  out.writeUInt32BE(pngCrc32(Buffer.concat([name, payload])), 8 + payload.length);
  return out;
}
export function pdfFlateImageToPng(data, dict) {
  const width = Number(/\/Width\s+(\d+)/i.exec(dict)?.[1] || 0);
  const height = Number(/\/Height\s+(\d+)/i.exec(dict)?.[1] || 0);
  const bits = Number(/\/BitsPerComponent\s+(\d+)/i.exec(dict)?.[1] || 0);
  const colorSpace = /\/ColorSpace\s*(?:\/([A-Za-z0-9]+)|\[\s*\/([A-Za-z0-9]+))/i.exec(dict);
  const space = colorSpace?.[1] || colorSpace?.[2] || "";
  const colors = /DeviceRGB|RGB/i.test(space) ? 3 : /DeviceGray|G/i.test(space) ? 1 : 0;
  if (!width || !height || width * height > 40000000 || bits !== 8 || !colors) return null;
  const rowBytes = width * colors, bytesPerPixel = colors;
  const decodeParms = /\/DecodeParms\s*(?:\[([\s\S]*?)\]|<<(.*?)>>)/i.exec(dict);
  const params = `${decodeParms?.[1] || ""} ${decodeParms?.[2] || ""}`;
  const predictor = Number(/\/Predictor\s+(\d+)/i.exec(params)?.[1] || 1);
  const columns = Number(/\/Columns\s+(\d+)/i.exec(params)?.[1] || width);
  const parmColors = Number(/\/Colors\s+(\d+)/i.exec(params)?.[1] || colors);
  if (columns !== width || parmColors !== colors) return null;
  const hasRowTag = data.length === height * (rowBytes + 1);
  if (!hasRowTag && data.length !== height * rowBytes) return null;
  const rgba = Buffer.alloc(height * rowBytes), previous = Buffer.alloc(rowBytes);
  let off = 0;
  const paeth = (a, b, c) => { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  for (let y = 0; y < height; y++) {
    const filter = hasRowTag ? data[off++] : (predictor >= 10 && predictor <= 14 ? predictor - 10 : 0);
    const encoded = data.subarray(off, off + rowBytes); off += rowBytes;
    const row = Buffer.from(encoded);
    if (predictor === 2) {
      for (let x = bytesPerPixel; x < rowBytes; x++) row[x] = (row[x] + row[x - bytesPerPixel]) & 255;
    } else if (predictor >= 10 && predictor <= 15) {
      if (filter > 4) return null;
      for (let x = 0; x < rowBytes; x++) {
        const left = x >= bytesPerPixel ? row[x - bytesPerPixel] : 0;
        const up = previous[x] || 0;
        const upperLeft = x >= bytesPerPixel ? (previous[x - bytesPerPixel] || 0) : 0;
        if (filter === 1) row[x] = (row[x] + left) & 255;
        else if (filter === 2) row[x] = (row[x] + up) & 255;
        else if (filter === 3) row[x] = (row[x] + Math.floor((left + up) / 2)) & 255;
        else if (filter === 4) row[x] = (row[x] + paeth(left, up, upperLeft)) & 255;
      }
    } else if (filter !== 0) return null;
    row.copy(rgba, y * rowBytes); row.copy(previous);
  }
  // PDF diagrams are often embedded as a small drawing surrounded by a large
  // white scan/page margin. Trim that border conservatively so students see the
  // actual figure more clearly. Keep a small safety margin around the content.
  let crop = { left: 0, top: 0, right: width - 1, bottom: height - 1 };
  let minX = width, minY = height, maxX = -1, maxY = -1;
  const threshold = 246;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = y * rowBytes + x * colors;
      const r = rgba[at], g = colors === 3 ? rgba[at + 1] : r, b = colors === 3 ? rgba[at + 2] : r;
      const visible = Math.min(r, g, b) < threshold || Math.max(r, g, b) - Math.min(r, g, b) > 18;
      if (visible) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
  }
  if (maxX >= minX && maxY >= minY) {
    const contentW = maxX - minX + 1, contentH = maxY - minY + 1;
    const marginX = Math.max(3, Math.round(width * 0.025)), marginY = Math.max(3, Math.round(height * 0.025));
    const left = Math.max(0, minX - marginX), top = Math.max(0, minY - marginY);
    const right = Math.min(width - 1, maxX + marginX), bottom = Math.min(height - 1, maxY + marginY);
    // Do not crop merely because a few tiny marks appear on an otherwise blank page.
    if (contentW >= width * 0.12 && contentH >= height * 0.12 && (left > width * 0.02 || top > height * 0.02 || right < width * 0.98 || bottom < height * 0.98)) {
      crop = { left, top, right, bottom };
    }
  }
  const outWidth = crop.right - crop.left + 1, outHeight = crop.bottom - crop.top + 1;
  const pngRows = Buffer.alloc(outHeight * (outWidth * colors + 1));
  const outRowBytes = outWidth * colors;
  for (let y = 0; y < outHeight; y++) {
    const from = (crop.top + y) * rowBytes + crop.left * colors;
    const to = y * (outRowBytes + 1) + 1;
    rgba.copy(pngRows, to, from, from + outRowBytes);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(outWidth, 0); ihdr.writeUInt32BE(outHeight, 4);
  ihdr[8] = 8; ihdr[9] = colors === 3 ? 2 : 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), pdfPngChunk("IHDR", ihdr), pdfPngChunk("IDAT", zlib.deflateSync(pngRows)), pdfPngChunk("IEND", Buffer.alloc(0))]);
}
export function extractPdfImageAssets(buffer) {
  const ascii = Buffer.from(buffer).toString("latin1");
  const assets = new Map();
  let index = 0;
  for (const m of ascii.matchAll(/<<([\s\S]*?\/Subtype\s*\/Image[\s\S]*?)>>\s*stream\r?\n/g)) {
    const dict = m[1];
    const streamStart = m.index + m[0].length;
    const end = ascii.indexOf("endstream", streamStart);
    if (end < 0) continue;
    const raw = Buffer.from(ascii.slice(streamStart, end).replace(/\r?\n$/, ""), "latin1");
    const arrayFilter = /\/Filter\s*\[([\s\S]*?)\]/i.exec(dict);
    const singleFilter = /\/Filter\s*\/([A-Za-z0-9]+)/i.exec(dict);
    const filters = arrayFilter ? [...arrayFilter[1].matchAll(/\/([A-Za-z0-9]+)/g)].map(x => x[1]) : (singleFilter ? [singleFilter[1]] : []);
    let data = raw, supported = true;
    for (const filter of filters) {
      try {
        if (/^ASCII85Decode$/i.test(filter)) data = decodePdfAscii85(data);
        else if (/^ASCIIHexDecode$/i.test(filter)) data = Buffer.from(data.toString("latin1").replace(/\s+/g, "").replace(/>.*/, "").replace(/[^0-9a-f]/gi, ""), "hex");
        else if (/^FlateDecode$/i.test(filter)) data = zlib.inflateSync(data, { maxOutputLength: 128 * 1024 * 1024 });
        else if (/^(?:DCTDecode|JPXDecode)$/i.test(filter)) {
          // JPEG/JPX is already a self-contained image encoding; only harmless
          // transport encodings should precede it in the filter list.
          const type = /^DCTDecode$/i.test(filter) ? "image/jpeg" : "image/jp2";
          const ext = /^DCTDecode$/i.test(filter) ? ".jpg" : ".jp2";
          const marker = `[[GBIMG:PDF:${index++}]]`;
          assets.set(marker, { marker, rid: marker, fileName: `figure-${index}${ext}`, contentType: type, data });
          data = null; break;
        } else { supported = false; break; }
      } catch { supported = false; break; }
    }
    if (!supported || !data) continue;
    // Flate-compressed DeviceRGB/DeviceGray images are common in exported
    // teaching PDFs. Rebuild them as standards-compliant PNGs instead of
    // attaching undecodable compressed bytes. Unsupported colour spaces and
    // bit depths are skipped safely; they never masquerade as image files.
    if (filters.some(x => /^FlateDecode$/i.test(x)) || filters.length === 0) {
      const png = pdfFlateImageToPng(data, dict);
      if (png) {
        const marker = `[[GBIMG:PDF:${index++}]]`;
        assets.set(marker, { marker, rid: marker, fileName: `figure-${index}.png`, contentType: "image/png", data: png });
      }
    }
  }
  return assets;
}
