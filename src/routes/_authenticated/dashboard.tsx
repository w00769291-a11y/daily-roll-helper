import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { QrCode, Users, ScanLine, ClipboardList, LogOut } from "lucide-react";
import EmployeeManager from "@/components/hr/EmployeeManager";
import AttendanceList from "@/components/hr/AttendanceList";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Attendance dashboard — TapAttend" },
      { name: "description", content: "Manage staff, scan QR codes and review attendance records in one place." },
      { property: "og:title", content: "Attendance dashboard — TapAttend" },
      { property: "og:description", content: "Manage staff, scan QR codes and review attendance records in one place." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const navigate = useNavigate();
  const [email, setEmail] = useState<string>("");

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
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-3 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
              <QrCode className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-bold sm:text-lg">TapAttend HR</h1>
              <p className="truncate text-xs text-muted-foreground">{email}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" asChild>
              <Link to="/scanner"><ScanLine className="h-4 w-4 sm:mr-2" /><span className="hidden sm:inline">Scanner station</span></Link>
            </Button>
            <Button variant="outline" size="sm" onClick={signOut}>
              <LogOut className="h-4 w-4 sm:mr-2" /><span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-3 py-4 sm:px-6 sm:py-6">
        <Tabs defaultValue="employees" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="employees" className="gap-1.5 text-xs sm:text-sm"><Users className="h-4 w-4" /><span className="hidden xs:inline sm:inline">Employees</span></TabsTrigger>
            <TabsTrigger value="attendance" className="gap-1.5 text-xs sm:text-sm"><ClipboardList className="h-4 w-4" /><span>Records</span></TabsTrigger>
          </TabsList>
          <TabsContent value="employees" className="mt-4"><EmployeeManager /></TabsContent>
          <TabsContent value="attendance" className="mt-4"><AttendanceList /></TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
