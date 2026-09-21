/** Turn a picked file (PNG / JPG / WebP / PDF) into a downscaled JPEG data URL the AI can read. */
export interface PreparedImage {
  dataUrl: string;
  width: number;
  height: number;
  name: string;
}

const MAX_SIDE = 2400;

export async function prepareImage(file: File): Promise<PreparedImage> {
  const canvas = document.createElement("canvas");
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    const pdfjs = await import("pdfjs-dist");
    // @ts-expect-error Vite resolves the ?url import; it has no type declaration
    const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default as string;
    pdfjs.GlobalWorkerOptions.workerSrc = worker;
    const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(4, MAX_SIDE / Math.max(base.width, base.height)) });
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, canvas, viewport }).promise;
  } else {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    canvas.width = Math.round(bmp.width * k);
    canvas.height = Math.round(bmp.height * k);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  }
  return { dataUrl: canvas.toDataURL("image/jpeg", 0.9), width: canvas.width, height: canvas.height, name: file.name.replace(/\.[^.]+$/, "") };
}

export async function prepareFromUrl(url: string, name: string): Promise<PreparedImage> {
  const blob = await (await fetch(url)).blob();
  return prepareImage(new File([blob], `${name}.png`, { type: blob.type }));
}
