import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ScanLine, LogOut } from "lucide-react";
import AttendanceScanner from "@/components/hr/AttendanceScanner";

export const Route = createFileRoute("/_authenticated/scanner")({
  head: () => ({
    meta: [
      { title: "Scanner station — TapAttend" },
      { name: "description", content: "Dedicated QR scanning station that recognises staff and students automatically." },
      { property: "og:title", content: "Scanner station — TapAttend" },
      { property: "og:description", content: "Dedicated QR scanning station that recognises staff and students automatically." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ScannerStation,
});

function ScannerStation() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ""));
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-card/80 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-3 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
              <ScanLine className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-bold sm:text-lg">Scanner station</h1>
              <p className="truncate text-xs text-muted-foreground">{email}</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={signOut}>
            <LogOut className="h-4 w-4 sm:mr-2" /><span className="hidden sm:inline">Sign out</span>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-3 py-4 sm:px-6 sm:py-6">
        <AttendanceScanner />
      </main>
    </div>
  );
}
