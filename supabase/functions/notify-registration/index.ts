import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendGmail } from "../_shared/gmail.ts";

// Called by a database trigger when a profile is created (verify_jwt = false).
// It ignores everything in the request except the profile id, reads the real
// record itself, and emails the tutor at most once per registration.
Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let id = "";
  try {
    id = String((await req.json())?.id || "");
    if (!id) return new Response("skipped");

    // Claim the registration so it can only ever be announced once.
    const { data: claimed } = await db.from("profiles")
      .update({ notified_at: new Date().toISOString() })
      .eq("id", id).eq("role", "student").eq("approved", false).is("notified_at", null)
      .select("full_name,email,child_name,grade,learning_needs").maybeSingle();
    if (!claimed) return new Response("skipped");

    const { data: tutor } = await db.from("profiles").select("id,email").eq("role", "tutor").limit(1).maybeSingle();
    if (!tutor?.email) throw new Error("No tutor account found.");

    const appUrl = Deno.env.get("APP_URL") || "";
    await sendGmail(db, tutor.id, tutor.email,
      `New registration: ${claimed.full_name || claimed.email}`,
      `A new student has registered and is waiting for your approval.\n\n` +
      `Parent/guardian: ${claimed.full_name || "-"}\nEmail: ${claimed.email}\n` +
      `Child: ${claimed.child_name || "-"}\nGrade: ${claimed.grade || "-"}\n` +
      `Learning needs: ${claimed.learning_needs || "-"}\n\n` +
      `Log in and approve in the portal (Students tab): ${appUrl}\n`);
    return new Response("ok");
  } catch (e) {
    if (id) await db.from("profiles").update({ notified_at: null }).eq("id", id); // allow a retry
    console.error("registration notification failed:", e instanceof Error ? e.message : e);
    return new Response("failed", { status: 500 });
  }
});
