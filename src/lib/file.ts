export async function readNumberFile(path: string): Promise<number> {
  const text = await readText(path);
  if (!text) return 0;

  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return 0;

  return Number(trimmed);
}

export async function readText(path: string): Promise<string | null> {
  try {
    return await Bun.file(path).text();
  } catch {
    return null;
  }
}

const LN = "\n".charCodeAt(0);
const textDecoder = new TextDecoder();
const MAX_LINE_LEN = 1024 * 1024; // 1MB

export async function* readLines(path: string) {
  const stream = Bun.file(path).stream();
  let lastBuffer: Uint8Array | undefined;
  for await (let chunk of stream) {
    let newlineIndex: number;
    while ((newlineIndex = chunk.indexOf(LN)) >= 0) {
      let buffer: Uint8Array;
      if (lastBuffer) {
        buffer = concatUint8Arrays(lastBuffer, chunk.subarray(0, newlineIndex));
        lastBuffer = undefined;
      } else {
        buffer = chunk.subarray(0, newlineIndex);
      }
      yield textDecoder.decode(buffer);
      chunk = chunk.subarray(newlineIndex + 1);
    }
    if (chunk.length > 0) {
      if (lastBuffer) {
        if (lastBuffer.length + chunk.length > MAX_LINE_LEN) {
          throw new Error(`Line exceeds maximum length of ${MAX_LINE_LEN} bytes`);
        }
        lastBuffer = concatUint8Arrays(lastBuffer, chunk);
      } else {
        lastBuffer = chunk;
      }
    }
  }
  if (lastBuffer && lastBuffer.length > 0) {
    yield textDecoder.decode(lastBuffer);
  }
}

function concatUint8Arrays(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}
