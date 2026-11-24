import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendGmail } from "../_shared/gmail.ts";

// Called by a Database Webhook on INSERT into public.profiles.
// verify_jwt is off for this function; the shared secret below is the check.
Deno.serve(async (req) => {
  if (!Deno.env.get("WEBHOOK_SECRET") || req.headers.get("x-webhook-secret") !== Deno.env.get("WEBHOOK_SECRET")) {
    return new Response("forbidden", { status: 403 });
  }
  try {
    const { record } = await req.json();
    if (!record || record.role !== "student") return new Response("skipped");
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: tutor } = await db.from("profiles").select("id,email").eq("role", "tutor").limit(1).maybeSingle();
    if (!tutor?.email) return new Response("no tutor");
    const appUrl = Deno.env.get("APP_URL") || "";
    await sendGmail(db, tutor.id, tutor.email,
      `New registration: ${record.full_name || record.email}`,
      `A new student has registered and is waiting for your approval.\n\n` +
      `Parent/guardian: ${record.full_name || "-"}\nEmail: ${record.email}\n` +
      `Child: ${record.child_name || "-"}\nGrade: ${record.grade || "-"}\nLearning needs: ${record.learning_needs || "-"}\n\n` +
      `Review and approve in the portal (Students tab): ${appUrl}\n`);
    return new Response("ok");
  } catch (e) {
    return new Response(e instanceof Error ? e.message : "failed", { status: 500 });
  }
});
