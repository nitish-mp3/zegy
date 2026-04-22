export async function consumeMjpegStream(
  body: ReadableStream<Uint8Array>,
  onFrame: (bmp: ImageBitmap) => void,
  signal: AbortSignal,
): Promise<void> {
  const reader = body.getReader();
  let buf = new Uint8Array(0);
  const append = (chunk: Uint8Array) => {
    const next = new Uint8Array(buf.length + chunk.length);
    next.set(buf);
    next.set(chunk, buf.length);
    buf = next;
  };
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      append(value);
      while (true) {
        let soi = -1;
        for (let i = 0; i < buf.length - 1; i++) {
          if (buf[i] === 0xff && buf[i + 1] === 0xd8) { soi = i; break; }
        }
        if (soi === -1) { buf = new Uint8Array(0); break; }
        if (soi > 0) buf = buf.slice(soi);
        let eoi = -1;
        for (let i = 2; i < buf.length - 1; i++) {
          if (buf[i] === 0xff && buf[i + 1] === 0xd9) { eoi = i + 2; break; }
        }
        if (eoi === -1) break;
        const jpeg = buf.slice(0, eoi);
        buf = buf.slice(eoi);
        try {
          const bmp = await createImageBitmap(new Blob([jpeg], { type: "image/jpeg" }));
          onFrame(bmp);
        } catch { /* skip corrupt frame */ }
      }
    }
  } finally {
    reader.releaseLock();
  }
}