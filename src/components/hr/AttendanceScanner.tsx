import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { Camera, StopCircle, UserRound, CheckCircle2 } from "lucide-react";
import { captureVideoFrame } from "@/lib/image";
import type { PersonKind } from "./PersonManager";

interface P { id: string; full_name: string; code: string; photo_url: string | null; kind: PersonKind }

const CFG = {
  employee: { table: "employees" as const, codeField: "employee_code", att: "attendance" as const, fk: "employee_id" },
  student: { table: "students" as const, codeField: "student_code", att: "student_attendance" as const, fk: "student_id" },
};

export default function AttendanceScanner() {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const containerId = "qr-scanner-region";
  const [scanning, setScanning] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<{ person: P; type: "in" | "out"; snapshot: string | null; at: string } | null>(null);
  const cooldownRef = useRef<string | null>(null);

  useEffect(() => () => { stop(); }, []);

  function videoEl() {
    return document.querySelector(`#${containerId} video`) as HTMLVideoElement | null;
  }

  async function start() {
    try {
      const html5 = new Html5Qrcode(containerId);
      scannerRef.current = html5;
      await html5.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        async (decoded) => {
          if (cooldownRef.current === decoded) return;
          cooldownRef.current = decoded;
          setTimeout(() => { if (cooldownRef.current === decoded) cooldownRef.current = null; }, 4000);
          await handleScan(decoded);
        },
        () => {},
      );
      setScanning(true);
    } catch (e: unknown) {
      toast.error("Camera error: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  async function stop() {
    try {
      if (scannerRef.current) {
        await scannerRef.current.stop();
        await scannerRef.current.clear();
        scannerRef.current = null;
      }
    } catch { /* already stopped */ }
    setScanning(false);
  }

  function speak(text: string) {
    try {
      if (!("speechSynthesis" in window)) return;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
    } catch { /* speech unavailable */ }
  }

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

  // Resolve a scanned code with no manual staff/student switch: try the hint from
  // the QR payload first, then fall back to looking the id up in both tables.
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

  async function handleScan(decoded: string) {
    setProcessing(true);
    const [prefix, rest] = decoded.includes(":") ? decoded.split(":") : [undefined, decoded];
    const hint: PersonKind | undefined = prefix === "student" ? "student" : prefix === "employee" ? "employee" : undefined;
    const person = await lookup((rest ?? "").trim(), hint);
    if (!person) { toast.error("Unknown QR code"); speak("Invalid QR code"); setProcessing(false); return; }
    await punch(person, await nextType(person), captureVideoFrame(videoEl()));
    setProcessing(false);
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
      <Card>
        <CardContent className="p-4">
          <div id={containerId} className="mx-auto aspect-square w-full max-w-sm overflow-hidden rounded-lg bg-black" />
          <div className="mt-3 flex gap-2">
            {!scanning ? (
              <Button onClick={start} className="flex-1"><Camera className="mr-2 h-4 w-4" />Start scanner</Button>
            ) : (
              <Button onClick={stop} variant="destructive" className="flex-1"><StopCircle className="mr-2 h-4 w-4" />Stop</Button>
            )}
          </div>
          <p className="mt-2 text-center text-xs text-muted-foreground">Staff and students are recognised automatically from the QR code — a live photo is captured with each punch.</p>
        </CardContent>
      </Card>

      {result && (
        <Card className="border-emerald-500/50">
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center gap-2 text-emerald-600">
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
