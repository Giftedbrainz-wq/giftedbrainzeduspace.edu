import zlib from "node:zlib";

function decodePdfLiteralAt(source, start) {
  if (source[start] !== "(") return { value: "", end: start };
  let depth = 1, out = "", i = start + 1;
  while (i < source.length && depth > 0) {
    const c = source[i++];
    if (c === "\\") {
      if (i >= source.length) break;
      const next = source[i++];
      if (next === "\r") { if (source[i] === "\n") i++; continue; }
      if (next === "\n") continue;
      const escapes = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" };
      if (Object.prototype.hasOwnProperty.call(escapes, next)) { out += escapes[next]; continue; }
      if (/[0-7]/.test(next)) {
        let oct = next;
        for (let k = 0; k < 2 && /[0-7]/.test(source[i] || ""); k++) oct += source[i++];
        out += String.fromCharCode(parseInt(oct, 8) & 255); continue;
      }
      out += next; continue;
    }
    if (c === "(") { depth++; out += c; continue; }
    if (c === ")") { depth--; if (depth > 0) out += c; continue; }
    out += c;
  }
  return { value: out, end: i };
}
function decodePdfHexAt(source, start) {
  if (source[start] !== "<" || source[start + 1] === "<") return { value: "", end: start };
  const close = source.indexOf(">", start + 1);
  if (close < 0) return { value: "", end: source.length };
  let hex = source.slice(start + 1, close).replace(/\s+/g, "");
  if (hex.length % 2) hex += "0";
  const bytes = Buffer.from(hex, "hex");
  let value = "";
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    const units = []; for (let i = 2; i + 1 < bytes.length; i += 2) units.push(bytes.readUInt16BE(i));
    value = String.fromCharCode(...units);
  } else if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    const units = []; for (let i = 2; i + 1 < bytes.length; i += 2) units.push(bytes.readUInt16LE(i));
    value = String.fromCharCode(...units);
  } else if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    value = bytes.subarray(3).toString("utf8");
  } else if (bytes.length >= 4 && bytes.length % 2 === 0 && bytes.filter((b, i) => i % 2 === 0 && b === 0).length > bytes.length / 5) {
    const units = []; for (let i = 0; i + 1 < bytes.length; i += 2) units.push(bytes.readUInt16BE(i));
    value = String.fromCharCode(...units);
  } else {
    value = bytes.toString("latin1");
  }
  return { value, end: close + 1 };
}
function decodePdfArrayAt(source, start) {
  if (source[start] !== "[") return { value: "", end: start };
  let i = start + 1, depth = 1, pieces = [];
  while (i < source.length && depth > 0) {
    const c = source[i];
    if (c === "(") { const item = decodePdfLiteralAt(source, i); pieces.push(item.value); i = item.end; continue; }
    if (c === "<" && source[i + 1] !== "<") { const item = decodePdfHexAt(source, i); pieces.push(item.value); i = item.end; continue; }
    if (c === "[") depth++;
    else if (c === "]") { depth--; if (!depth) { i++; break; } }
    i++;
  }
  return { value: pieces.join(""), end: i };
}
function decodePdfTextStream(stream) {
  let out = "", i = 0, lastWasText = false;
  const add = value => { out += value; if (value) lastWasText = true; };
  const addLineBreak = () => { if (lastWasText && !/[\r\n]$/.test(out)) out += "\n"; lastWasText = false; };
  while (i < stream.length) {
    const c = stream[i];
    if (c === "%") { while (i < stream.length && stream[i] !== "\n" && stream[i] !== "\r") i++; continue; }
    if (c === "(") {
      const item = decodePdfLiteralAt(stream, i); let op = item.end;
      while (/\s/.test(stream[op] || "")) op++;
      if (stream.slice(op, op + 2) === "Tj" && !/[A-Za-z]/.test(stream[op + 2] || "")) { add(item.value); add(" "); i = op + 2; continue; }
      i = item.end; continue;
    }
    if (c === "[" && !/[A-Za-z]/.test(stream[i - 1] || "")) {
      const item = decodePdfArrayAt(stream, i); let op = item.end;
      while (/\s/.test(stream[op] || "")) op++;
      if (stream.slice(op, op + 2) === "TJ" && !/[A-Za-z]/.test(stream[op + 2] || "")) { add(item.value); add(" "); i = op + 2; continue; }
      i = item.end; continue;
    }
    if (c === "<" && stream[i + 1] !== "<") {
      const item = decodePdfHexAt(stream, i); let op = item.end;
      while (/\s/.test(stream[op] || "")) op++;
      if (stream.slice(op, op + 2) === "Tj" && !/[A-Za-z]/.test(stream[op + 2] || "")) { add(item.value); add(" "); i = op + 2; continue; }
      i = item.end; continue;
    }
    // Text positioning operators delimit lines in most exported exam PDFs.
    // Treat horizontal moves as a space and vertical moves as a new line.
    if (/[\d.+-]/.test(c)) {
      const op = /^\s*(-?(?:\d+(?:\.\d*)?|\.\d+))\s+(-?(?:\d+(?:\.\d*)?|\.\d+))\s+(Td|TD)\b/.exec(stream.slice(i));
      if (op) {
        const dy = Number(op[2]);
        if (Math.abs(dy) > 0.01 || op[3] === "TD") addLineBreak(); else if (lastWasText) add(" ");
        i += op[0].length; continue;
      }
    }
    const lineOp = /^(?:T\*|ET)\b/.exec(stream.slice(i));
    if (lineOp) { addLineBreak(); i += lineOp[0].length; continue; }
    i++;
  }
  return out;
}
function decodePdfText(buffer) {
  const src = Buffer.from(buffer);
  let text = "";
  const ascii = src.toString("latin1");
  const streams = [...ascii.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)];
  for (const m of streams) {
    let part = Buffer.from(m[1], "latin1");
    try {
      const before = ascii.slice(Math.max(0, m.index - 300), m.index);
      if (/FlateDecode/i.test(before)) part = zlib.inflateSync(part, { maxOutputLength: 32 * 1024 * 1024 });
      else if (/\/(?:DCTDecode|JPXDecode|CCITTFaxDecode|JBIG2Decode)\b/i.test(before)) continue;
    } catch {
      continue;
    }
    const streamText = part.toString("latin1");
    // The ordered scanner does not strip digits from TJ kerning operands inside
    // literal strings; those digits are frequently parts of exponents, indices,
    // fractions and numerical answer options.
    if (!/\b(?:Tj|TJ|BT|Tf|Td|TD|Tm|T\*)\b/.test(streamText)) continue;
    const extracted = decodePdfTextStream(streamText);
    if (extracted.trim()) text += `${extracted}\n`;
  }
  return text.replace(/[ \t]+/g, " ").replace(/[ \t]*\n[ \t]*/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export { decodePdfText };
