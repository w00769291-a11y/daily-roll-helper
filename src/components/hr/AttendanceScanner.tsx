import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { Camera, StopCircle, UserRound, CheckCircle2, QrCode, ScanFace, Loader2 } from "lucide-react";
import { captureVideoFrame } from "@/lib/image";
import { loadFaceApi, descriptorFor, descriptorForPhoto, distance, MATCH_THRESHOLD } from "@/lib/face";
import type { PersonKind } from "./PersonManager";

interface P { id: string; full_name: string; code: string; photo_url: string | null; kind: PersonKind }
interface Known { person: P; desc: Float32Array }

const CFG = {
  employee: { table: "employees" as const, codeField: "employee_code", att: "attendance" as const, fk: "employee_id" },
  student: { table: "students" as const, codeField: "student_code", att: "student_attendance" as const, fk: "student_id" },
};

const FACE_COOLDOWN_MS = 60_000;

export default function AttendanceScanner() {
  const [mode, setMode] = useState<"qr" | "face">("qr");
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const containerId = "qr-scanner-region";
  const faceVideoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const loopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const knownRef = useRef<Known[]>([]);
  const faceSeenRef = useRef<Map<string, number>>(new Map());
  const busyRef = useRef(false);
  const [scanning, setScanning] = useState(false);
  const [status, setStatus] = useState("");
  const [result, setResult] = useState<{ person: P; type: "in" | "out"; snapshot: string | null; at: string } | null>(null);
  const cooldownRef = useRef<string | null>(null);

  useEffect(() => () => { void stopAll(); }, []);

  function speak(text: string) {
    try {
      if (!("speechSynthesis" in window)) return;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
    } catch { /* speech unavailable */ }
  }

  async function stopAll() {
    try {
      if (scannerRef.current) {
        await scannerRef.current.stop();
        await scannerRef.current.clear();
        scannerRef.current = null;
      }
    } catch { /* already stopped */ }
    if (loopRef.current) clearTimeout(loopRef.current);
    loopRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScanning(false);
    setStatus("");
  }

  async function switchMode(m: "qr" | "face") {
    if (m === mode) return;
    await stopAll();
    setMode(m);
  }

  // ---------- QR mode (auto punch + face verification) ----------
  async function startQr() {
    try {
      setStatus("Loading face check…");
      loadFaceApi().catch(() => {}); // warm up in background
      const html5 = new Html5Qrcode(containerId);
      scannerRef.current = html5;
      await html5.start(
        { facingMode: "user" },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        async (decoded) => {
          if (cooldownRef.current === decoded || busyRef.current) return;
          cooldownRef.current = decoded;
          setTimeout(() => { if (cooldownRef.current === decoded) cooldownRef.current = null; }, 4000);
          busyRef.current = true;
          try { await handleQr(decoded); } finally { busyRef.current = false; }
        },
        () => {},
      );
      setScanning(true);
      setStatus("Show your QR code to the camera");
    } catch (e: unknown) {
      setStatus("");
      toast.error("Camera error: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  async function handleQr(decoded: string) {
    const [prefix, rest] = decoded.includes(":") ? decoded.split(":") : [undefined, decoded];
    const hint: PersonKind | undefined = prefix === "student" ? "student" : prefix === "employee" ? "employee" : undefined;
    const person = await lookup((rest ?? "").trim(), hint);
    if (!person) { toast.error("Unknown QR code"); speak("Invalid QR code"); return; }
    const video = document.querySelector(`#${containerId} video`) as HTMLVideoElement | null;

    if (person.photo_url && video) {
      setStatus(`Checking face for ${person.full_name}…`);
      try {
        const ref = await descriptorForPhoto(person.id, person.photo_url);
        if (ref) {
          const live = await descriptorFor(video);
          if (!live) { toast.error("No face seen — look at the camera and scan again"); speak("Face not detected"); setStatus("Show your QR code to the camera"); return; }
          if (distance(ref, live) > MATCH_THRESHOLD) {
            toast.error(`Face does not match ${person.full_name}`); speak("Face does not match"); setStatus("Show your QR code to the camera"); return;
          }
        }
      } catch { /* face models unavailable — fall back to QR only */ }
    }
    await punch(person, await nextType(person), captureVideoFrame(video));
    setStatus("Show your QR code to the camera");
  }

  // ---------- Face-only mode (hands-free) ----------
  async function loadKnown(): Promise<Known[]> {
    const out: Known[] = [];
    for (const kind of ["employee", "student"] as PersonKind[]) {
      const cfg = CFG[kind];
      const { data } = await supabase.from(cfg.table).select(`id, full_name, photo_url, ${cfg.codeField}`).not("photo_url", "is", null);
      for (const r of (data ?? []) as unknown as Record<string, unknown>[]) {
        const p: P = { id: r['id'] as string, full_name: r['full_name'] as string, code: (r[cfg.codeField] as string) ?? "", photo_url: r['photo_url'] as string, kind };
        const desc = await descriptorForPhoto(p.id, p.photo_url!);
        if (desc) out.push({ person: p, desc });
      }
    }
    return out;
  }

  async function startFace() {
    try {
      setScanning(true);
      setStatus("Loading face recognition…");
      await loadFaceApi();
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
      streamRef.current = stream;
      const v = faceVideoRef.current!;
      v.srcObject = stream;
      await v.play();
      setStatus("Reading registered faces…");
      knownRef.current = await loadKnown();
      if (!knownRef.current.length) { toast.error("No usable face photos found"); await stopAll(); return; }
      setStatus(`Ready — ${knownRef.current.length} faces registered. Look at the camera.`);
      tick();
    } catch (e: unknown) {
      toast.error("Face mode error: " + (e instanceof Error ? e.message : String(e)));
      await stopAll();
    }
  }

  async function tick() {
    const v = faceVideoRef.current;
    if (!streamRef.current || !v) return;
    try {
      const live = await descriptorFor(v);
      if (live) {
        let best: Known | null = null; let bestD = Infinity;
        for (const k of knownRef.current) { const d = distance(k.desc, live); if (d < bestD) { bestD = d; best = k; } }
        if (best && bestD <= MATCH_THRESHOLD) {
          const last = faceSeenRef.current.get(best.person.id) ?? 0;
          if (Date.now() - last > FACE_COOLDOWN_MS) {
            faceSeenRef.current.set(best.person.id, Date.now());
            await punch(best.person, await nextType(best.person), captureVideoFrame(v));
          }
        } else if (best) {
          setStatus("Face not recognised");
        }
      }
    } catch { /* ignore frame errors */ }
    if (streamRef.current) loopRef.current = setTimeout(tick, 700);
  }

  // ---------- shared ----------
  async function punch(person: P, punch_type: "in" | "out", snapshot: string | null) {
    const cfg = CFG[person.kind];
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user!.id;
    const row: Record<string, unknown> = { punch_type, snapshot_url: snapshot };
    row[cfg.fk] = person.id;
    if (person.kind === "employee") row['hr_id'] = uid; else row['recorded_by'] = uid;
    const { error } = await supabase.from(cfg.att).insert(row as never);
    if (error) { toast.error(error.message); speak("Punch failed"); return; }
    const msg = `${punch_type === "in" ? "Punch in" : "Punch out"} successful for ${person.full_name}`;
    toast.success(msg);
    speak(msg);
    setResult({ person, type: punch_type, snapshot, at: new Date().toLocaleString() });
  }

  async function lookup(id: string, preferred?: PersonKind): Promise<P | null> {
    const order: PersonKind[] = preferred === "student" ? ["student", "employee"] : ["employee", "student"];
    for (const kind of order) {
      const cfg = CFG[kind];
      const { data } = await supabase.from(cfg.table)
        .select(`id, full_name, photo_url, ${cfg.codeField}`).eq("id", id).maybeSingle();
      if (data) {
        const rec = data as unknown as Record<string, unknown>;
        return {
          id: rec['id'] as string,
          full_name: rec['full_name'] as string,
          code: (rec[cfg.codeField] as string) ?? "",
          photo_url: (rec['photo_url'] as string) ?? null,
          kind,
        };
      }
    }
    return null;
  }

  async function nextType(person: P): Promise<"in" | "out"> {
    const cfg = CFG[person.kind];
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const { data } = await supabase.from(cfg.att).select("punch_type")
      .eq(cfg.fk, person.id).gte("punched_at", startOfDay.toISOString())
      .order("punched_at", { ascending: false }).limit(1).maybeSingle();
    return data?.punch_type === "in" ? "out" : "in";
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <Button variant={mode === "qr" ? "default" : "outline"} onClick={() => switchMode("qr")}><QrCode className="mr-2 h-4 w-4" />QR scan</Button>
        <Button variant={mode === "face" ? "default" : "outline"} onClick={() => switchMode("face")}><ScanFace className="mr-2 h-4 w-4" />Face only</Button>
      </div>
      <Card>
        <CardContent className="p-4">
          {mode === "qr" ? (
            <div id={containerId} className="mx-auto aspect-square w-full max-w-sm overflow-hidden rounded-lg bg-muted" />
          ) : (
            <video ref={faceVideoRef} muted playsInline className="mx-auto aspect-square w-full max-w-sm rounded-lg bg-muted object-cover" style={{ transform: "scaleX(-1)" }} />
          )}
          <div className="mt-3 flex gap-2">
            {!scanning ? (
              <Button onClick={mode === "qr" ? startQr : startFace} className="flex-1"><Camera className="mr-2 h-4 w-4" />Start {mode === "qr" ? "scanner" : "face attendance"}</Button>
            ) : (
              <Button onClick={stopAll} variant="destructive" className="flex-1"><StopCircle className="mr-2 h-4 w-4" />Stop</Button>
            )}
          </div>
          {status && <p className="mt-2 flex items-center justify-center gap-2 text-center text-sm">{status.endsWith("…") && <Loader2 className="h-4 w-4 animate-spin" />}{status}</p>}
          <p className="mt-2 text-center text-xs text-muted-foreground">
            {mode === "qr"
              ? "Punches happen automatically on scan. The face is checked against the saved photo before punching."
              : "Hands-free: stand in front of the camera and attendance is punched automatically when your face is recognised."}
          </p>
        </CardContent>
      </Card>

      {result && (
        <Card className="border-primary/50">
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center gap-2 text-primary">
              <CheckCircle2 className="h-5 w-5" />
              <p className="font-semibold">Punch {result.type === "in" ? "in" : "out"} successful</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-full bg-secondary">
                {result.person.photo_url
                  ? <img src={result.person.photo_url} alt={result.person.full_name} className="h-full w-full object-cover" />
                  : <UserRound className="h-7 w-7 text-muted-foreground" />}
              </div>
              <div className="min-w-0">
                <p className="truncate text-lg font-semibold">{result.person.full_name}</p>
                <p className="truncate text-xs text-muted-foreground"><span className="font-mono">{result.person.code}</span> · {result.person.kind === "student" ? "Student" : "Staff"} · {result.at}</p>
              </div>
              {result.snapshot && (
                <img src={result.snapshot} alt="Punch snapshot" className="ml-auto h-16 w-16 shrink-0 rounded-lg border object-cover" />
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
