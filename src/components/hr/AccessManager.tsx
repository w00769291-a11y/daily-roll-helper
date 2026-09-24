import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ShieldCheck, RefreshCw, UserRound } from "lucide-react";
import type { AppRole } from "@/lib/roles";

interface AccountRow {
  id: string;
  full_name: string | null;
  email: string | null;
  department: string | null;
  roles: AppRole[];
}

const STAFF_ROLES: AppRole[] = ["hr", "incharge"];

export default function AccessManager() {
  const [rows, setRows] = useState<AccountRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<AccountRow | null>(null);
  const [role, setRole] = useState<AppRole | "none">("none");
  const [department, setDepartment] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: profiles, error }, { data: roleRows }] = await Promise.all([
      supabase.from("profiles").select("id, full_name, email, department").order("created_at", { ascending: false }),
      supabase.from("user_roles").select("user_id, role"),
    ]);
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    setRows((profiles ?? []).map((p) => ({
      id: p.id,
      full_name: p.full_name,
      email: p.email,
      department: p.department,
      roles: (roleRows ?? []).filter((r) => r.user_id === p.id).map((r) => r.role as AppRole),
    })));
  }, []);

  useEffect(() => { load(); }, [load]);

  function openEdit(row: AccountRow) {
    setEditing(row);
    setRole(row.roles.find((r) => STAFF_ROLES.includes(r)) ?? "none");
    setDepartment(row.department ?? "");
  }

  async function save() {
    if (!editing) return;
    setSaving(true);
    const { error: delErr } = await supabase
      .from("user_roles").delete().eq("user_id", editing.id).in("role", STAFF_ROLES);
    if (delErr) { setSaving(false); toast.error(delErr.message); return; }
    if (role !== "none") {
      const { error } = await supabase.from("user_roles").insert({ user_id: editing.id, role });
      if (error) { setSaving(false); toast.error(error.message); return; }
    }
    const { error: profErr } = await supabase
      .from("profiles").update({ department: department.trim() || null }).eq("id", editing.id);
    setSaving(false);
    if (profErr) { toast.error(profErr.message); return; }
    toast.success("Access updated");
    setEditing(null);
    await load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Accounts &amp; access</h2>
          <p className="text-sm text-muted-foreground">Set who is HR, who is a department incharge, and their department.</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className="h-4 w-4 sm:mr-2" /><span className="hidden sm:inline">Refresh</span>
        </Button>
      </div>

      <div className="grid gap-3">
        {rows.length === 0 && (
          <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">No accounts yet.</CardContent></Card>
        )}
        {rows.map((r) => (
          <Card key={r.id}>
            <CardContent className="flex items-center justify-between gap-3 p-4">
              <div className="flex min-w-0 items-center gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-secondary">
                  <UserRound className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="min-w-0">
                  <p className="truncate font-semibold">{r.full_name ?? "—"}</p>
                  <p className="truncate text-xs text-muted-foreground">{r.email ?? "—"}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {(r.roles.length ? r.roles.join(", ") : "no role")}{r.department ? ` · ${r.department}` : ""}
                  </p>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={() => openEdit(r)}>
                <ShieldCheck className="h-4 w-4 sm:mr-2" /><span className="hidden sm:inline">Set access</span>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-sm" aria-describedby={undefined}>
          <DialogHeader><DialogTitle>{editing?.full_name ?? editing?.email}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as AppRole | "none")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No staff role</SelectItem>
                  <SelectItem value="hr">HR (full access)</SelectItem>
                  <SelectItem value="incharge">Department incharge</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Department</Label>
              <Input value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="e.g. Mechanical" />
            </div>
          </div>
          <DialogFooter><Button onClick={save} disabled={saving}>{saving ? "…" : "Save"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
