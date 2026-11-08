// Reads the words on a picture, in the browser (nothing is uploaded). The OCR engine (Tesseract) is only fetched the first time a picture is sent.

type Worker = { recognize: (image: Blob) => Promise<{ data: { text: string } }> };
let worker: Promise<Worker> | null = null;

/** The picture, no larger than `max` pixels on its longest side (a phone photo is 4000 pixels: far more than reading needs), as a PNG. */
async function shrink(file: File, max = 1800): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((done, fail) => canvas.toBlob((b) => (b ? done(b) : fail(new Error("no image"))), "image/png"));
}

export async function readPicture(file: File): Promise<string> {
  if (!worker) {
    worker = import("tesseract.js").then(async (T) => (await T.createWorker("eng")) as unknown as Worker);
    worker.catch(() => (worker = null)); // a failed start (offline) can be tried again
  }
  const [w, image] = await Promise.all([worker, shrink(file)]);
  const { data } = await Promise.race([w.recognize(image), new Promise<never>((_, fail) => setTimeout(() => fail(new Error("too slow")), 90_000))]);
  return data.text;
}
