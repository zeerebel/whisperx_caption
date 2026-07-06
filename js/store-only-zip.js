/*
 * store-only-zip.js
 * Dependency-free, STORE-only (no compression) ZIP encoder for the browser.
 *
 * Bundles a sequence of {name, data:Uint8Array} entries (e.g. PNG frame Blobs
 * converted to bytes) into a single Blob('application/zip').
 *
 * Uses: local file header (0x04034b50), central directory (0x02014b50),
 * end-of-central-dir (0x06054b50), compression method 0 (STORE), correct
 * table-based CRC-32, a FIXED DOS date/time (1980-01-01, never Date.now()),
 * and the UTF-8 filename flag so names round-trip in Finder / Explorer / NLE
 * image-sequence importers. Little-endian throughout.
 */
(function () {
  "use strict";

  // ---- CRC-32 (IEEE 802.3, polynomial 0xEDB88320) — table-based ----
  const CRC32_TABLE = (function buildCrc32Table() {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  // Fixed DOS date/time = 1980-01-01 00:00:00 (Date.now() intentionally unused).
  const DOS_TIME = 0x0000;
  const DOS_DATE = 0x0021;
  const utf8 = new TextEncoder();

  // A plain (non-ZIP64) ZIP stores entry counts in 16 bits and sizes/offsets in
  // 32 bits. Rather than silently emit a corrupt archive past those limits, fail
  // loudly — the caller surfaces it and the user lowers fps / resolution / length.
  const MAX_ENTRIES = 0xffff; // 65535
  const MAX_U32 = 0xffffffff; // 4 GiB - 1

  function createStoreZip(files) {
    if (files.length > MAX_ENTRIES)
      throw new Error(
        `Too many frames for one ZIP (${files.length} > 65535). Lower the FPS or export a shorter clip.`
      );

    const records = [];
    const localParts = [];
    let offset = 0;

    for (let i = 0; i < files.length; i++) {
      const nameBytes = utf8.encode(files[i].name);
      const data = files[i].data;
      const size = data.length;
      if (size > MAX_U32 || offset > MAX_U32)
        throw new Error("Export exceeds the 4 GiB ZIP limit. Lower the resolution/FPS or shorten the clip.");
      const crc = crc32(data);

      const local = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true); // local file header signature
      lv.setUint16(4, 20, true); // version needed
      lv.setUint16(6, 0x0800, true); // flags: bit 11 = UTF-8 filename
      lv.setUint16(8, 0, true); // method: STORE
      lv.setUint16(10, DOS_TIME, true);
      lv.setUint16(12, DOS_DATE, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, size, true); // compressed size
      lv.setUint32(22, size, true); // uncompressed size
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true); // extra length
      local.set(nameBytes, 30);

      localParts.push(local, data);
      records.push({ nameBytes, crc, size, offset });
      offset += local.length + size;
    }

    const centralDirOffset = offset;
    if (centralDirOffset > MAX_U32)
      throw new Error("Export exceeds the 4 GiB ZIP limit. Lower the resolution/FPS or shorten the clip.");
    const centralParts = [];
    let centralSize = 0;
    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      const central = new Uint8Array(46 + r.nameBytes.length);
      const cv = new DataView(central.buffer);
      cv.setUint32(0, 0x02014b50, true); // central dir signature
      cv.setUint16(4, 20, true); // version made by
      cv.setUint16(6, 20, true); // version needed
      cv.setUint16(8, 0x0800, true); // flags: UTF-8
      cv.setUint16(10, 0, true); // method: STORE
      cv.setUint16(12, DOS_TIME, true);
      cv.setUint16(14, DOS_DATE, true);
      cv.setUint32(16, r.crc, true);
      cv.setUint32(20, r.size, true);
      cv.setUint32(24, r.size, true);
      cv.setUint16(28, r.nameBytes.length, true);
      cv.setUint16(30, 0, true); // extra length
      cv.setUint16(32, 0, true); // comment length
      cv.setUint16(34, 0, true); // disk number
      cv.setUint16(36, 0, true); // internal attrs
      cv.setUint32(38, 0, true); // external attrs
      cv.setUint32(42, r.offset, true);
      central.set(r.nameBytes, 46);
      centralParts.push(central);
      centralSize += central.length;
    }

    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, records.length, true);
    ev.setUint16(10, records.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, centralDirOffset, true);
    ev.setUint16(20, 0, true);

    return new Blob(localParts.concat(centralParts, [eocd]), { type: "application/zip" });
  }

  async function createStoreZipFromBlobs(frames) {
    const files = [];
    for (let i = 0; i < frames.length; i++) {
      const buf = await frames[i].blob.arrayBuffer();
      files.push({ name: frames[i].name, data: new Uint8Array(buf) });
      frames[i].blob = null; // release each source blob as it's consumed to cap peak memory
    }
    return createStoreZip(files);
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoke after a delay, not on the next tick — Firefox can cancel a large
    // .mov/.zip download if the blob URL is revoked before the save commits.
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  const WXC = (window.WXC = window.WXC || {});
  WXC.zip = { crc32, createStoreZip, createStoreZipFromBlobs, downloadBlob };
})();
