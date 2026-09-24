// Browser-only face recognition helpers (loaded lazily so SSR never imports the library).
type FaceApi = typeof import("@vladmandic/face-api");

const MODEL_URL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/model";
export const MATCH_THRESHOLD = 0.5;

let apiPromise: Promise<FaceApi> | null = null;

export function loadFaceApi(): Promise<FaceApi> {
  if (!apiPromise) {
    apiPromise = (async () => {
      const faceapi = await import("@vladmandic/face-api");
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      ]);
      return faceapi;
    })().catch((e) => { apiPromise = null; throw e; });
  }
  return apiPromise;
}

const cache = new Map<string, Float32Array | null>();

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    img.src = src;
  });
}

export async function descriptorFor(input: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement): Promise<Float32Array | null> {
  const faceapi = await loadFaceApi();
  const res = await faceapi
    .detectSingleFace(input, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }))
    .withFaceLandmarks()
    .withFaceDescriptor();
  return res?.descriptor ?? null;
}

export async function descriptorForPhoto(key: string, src: string): Promise<Float32Array | null> {
  const k = key + ":" + src.length;
  if (cache.has(k)) return cache.get(k)!;
  let d: Float32Array | null = null;
  try { d = await descriptorFor(await loadImage(src)); } catch { d = null; }
  cache.set(k, d);
  return d;
}

export function distance(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) { const x = a[i]! - b[i]!; s += x * x; }
  return Math.sqrt(s);
}
