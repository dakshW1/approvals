// Reads GPS position and capture time from a JPEG's EXIF block, without any library.
// Returns {} when the photo carries no location (many apps strip it).
export async function readExif(file) {
  try {
    if (!/jpe?g/i.test(file.type) && !/\.jpe?g$/i.test(file.name)) return {};
    const v = new DataView(await file.slice(0, 256 * 1024).arrayBuffer());
    if (v.getUint16(0) !== 0xffd8) return {};
    let off = 2;
    while (off + 4 < v.byteLength) {
      const marker = v.getUint16(off);
      const len = v.getUint16(off + 2);
      if (marker === 0xffe1 && v.getUint32(off + 4) === 0x45786966) return parseTiff(v, off + 10);
      if ((marker & 0xff00) !== 0xff00) break;
      off += 2 + len;
    }
  } catch {
    /* unreadable EXIF: treat as no location */
  }
  return {};
}

function parseTiff(v, start) {
  const little = v.getUint16(start) === 0x4949;
  const u16 = (o) => v.getUint16(start + o, little);
  const u32 = (o) => v.getUint32(start + o, little);
  const ifd = (o) => {
    const tags = {};
    const n = u16(o);
    for (let i = 0; i < n; i++) {
      const e = o + 2 + i * 12;
      tags[u16(e)] = { count: u32(e + 4), at: e + 8 };
    }
    return tags;
  };
  const valueOffset = (tag, size) => (tag.count * size > 4 ? u32(tag.at) : tag.at);
  const ascii = (tag) => {
    const o = valueOffset(tag, 1);
    let s = '';
    for (let i = 0; i < tag.count - 1; i++) s += String.fromCharCode(v.getUint8(start + o + i));
    return s;
  };
  const dms = (tag) => {
    const o = valueOffset(tag, 8);
    const r = (i) => u32(o + i * 8) / (u32(o + i * 8 + 4) || 1);
    return r(0) + r(1) / 60 + r(2) / 3600;
  };

  const out = {};
  const ifd0 = ifd(u32(4));
  if (ifd0[0x8769]) {
    const exif = ifd(u32(ifd0[0x8769].at));
    const t = exif[0x9003] && ascii(exif[0x9003]);
    const m = t && t.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
    if (m) out.takenAt = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).toISOString();
  }
  if (ifd0[0x8825]) {
    const gps = ifd(u32(ifd0[0x8825].at));
    if (gps[2] && gps[4]) {
      const latRef = gps[1] ? ascii(gps[1]) : 'N';
      const lngRef = gps[3] ? ascii(gps[3]) : 'E';
      const lat = dms(gps[2]) * (latRef === 'S' ? -1 : 1);
      const lng = dms(gps[4]) * (lngRef === 'W' ? -1 : 1);
      if (Number.isFinite(lat) && Number.isFinite(lng) && (lat || lng)) Object.assign(out, { lat, lng });
    }
  }
  return out;
}

// Phone photos are often 3-8 MB; shrink to fit the 4 MB upload limit (after EXIF has been read).
export async function compressImage(file, maxSide = 1800, quality = 0.82) {
  if (file.size < 1.5 * 1024 * 1024 && /jpe?g|png|webp/i.test(file.type)) return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  return new File([blob], 'photo.jpg', { type: 'image/jpeg' });
}

export function currentPosition() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  });
}
