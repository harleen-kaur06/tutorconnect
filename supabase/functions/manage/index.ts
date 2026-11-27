import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendGmail } from "../_shared/gmail.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

const PERMISSION_MSG =
  "Google permission is missing or expired. Click “Connect Google Calendar” again.";

// deno-lint-ignore no-explicit-any
async function googleAccessToken(service: any, tutorId: string) {
  const { data: conn } = await service.from("google_calendar_connections")
    .select("refresh_token").eq("user_id", tutorId).maybeSingle();
  if (!conn?.refresh_token) throw new Error("Google is not connected. Click “Connect Google Calendar” first.");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: getEnv("GOOGLE_CLIENT_ID"),
      client_secret: getEnv("GOOGLE_CLIENT_SECRET"),
      refresh_token: conn.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) throw new Error(PERMISSION_MSG);
  return data.access_token as string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "Sign in first." }, 401);

    const supabaseUrl = getEnv("SUPABASE_URL");
    const service = createClient(supabaseUrl, getEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const userClient = createClient(supabaseUrl, getEnv("SUPABASE_ANON_KEY"));
    const { data: authData, error: authError } = await userClient.auth.getUser(jwt);
    if (authError || !authData.user) return json({ error: "Your session is invalid. Sign in again." }, 401);
    const userId = authData.user.id;

    const { data: me } = await service.from("profiles").select("role").eq("id", userId).maybeSingle();
    if (me?.role !== "tutor") return json({ error: "Only the tutor can do this." }, 403);

    const body = await req.json();
    const op = `${body.target}.${body.action}`;

    // ---------- students ----------
    if (op === "student.approve" || op === "student.decline") {
      const id = String(body.student_id || "");
      const { data: st } = await service.from("profiles")
        .select("id,role,approved,email,full_name,child_name,welcome_sent_at").eq("id", id).maybeSingle();
      if (!st || st.role !== "student") return json({ error: "Student not found." }, 404);

      if (op === "student.approve") {
        const { error } = await service.from("profiles").update({ approved: true }).eq("id", id);
        if (error) throw error;
        // Welcome email (best effort: approval still succeeds if email fails)
        let welcome = "skipped";
        let welcomeError = "";
        if (st.email && !st.welcome_sent_at) {
          try {
            await sendGmail(service, userId, st.email, "Welcome to Harleen Tutoring",
              `Hi ${st.full_name || "there"},\n\nThank you for registering${st.child_name ? " " + st.child_name : ""}. ` +
              `Your account has been approved and you can sign in here: ${Deno.env.get("APP_URL") || ""}\n\n` +
              `I'll be in touch shortly to talk about your child's goals and the best way to support them.\n\nHarleen`);
            await service.from("profiles").update({ welcome_sent_at: new Date().toISOString() }).eq("id", id);
            welcome = "sent";
          } catch (e) { welcome = "failed"; welcomeError = e instanceof Error ? e.message : "Unknown error"; }
        }
        return json({ ok: true, welcome, welcomeError });
      }
      if (st.approved) return json({ error: "Approved students can't be removed here." }, 400);
      const { error } = await service.auth.admin.deleteUser(id);
      if (error) throw error;
      await service.from("profiles").delete().eq("id", id); // in case there is no cascade
      return json({ ok: true });
    }

    // ---------- homework ----------
    if (op === "homework.update" || op === "homework.delete") {
      const id = String(body.homework_id || "");
      const { data: hw } = await service.from("homework")
        .select("id,tutor_id,drive_file_id,file_url").eq("id", id).maybeSingle();
      if (!hw || hw.tutor_id !== userId) return json({ error: "Homework not found." }, 404);
      const { data: existing } = await service.from("submissions").select("id").eq("homework_id", id).limit(1);
      if (existing?.length) return json({ error: "The student has already submitted, so this homework can't be changed." }, 409);

      if (op === "homework.update") {
        const title = String(body.title || "").trim();
        if (!title) return json({ error: "Title is required." }, 400);
        const { error } = await service.from("homework").update({
          title,
          description: String(body.description || ""),
          due_date: String(body.due_date || "") || null,
        }).eq("id", id);
        if (error) throw error;
        return json({ ok: true });
      }

      // delete (attachments are removed best-effort)
      const { data: extraFiles } = await service.from("homework_files").select("drive_file_id").eq("homework_id", id);
      const driveIds = [hw.drive_file_id, ...(extraFiles || []).map((f: { drive_file_id: string }) => f.drive_file_id)].filter(Boolean);
      if (driveIds.length) {
        try {
          const token = await googleAccessToken(service, userId);
          for (const fileId of driveIds) {
            await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`, {
              method: "DELETE",
              headers: { Authorization: `Bearer ${token}` },
            });
          }
        } catch { /* ignore */ }
      }
      if (hw.file_url) {
        try { await service.storage.from("homework-files").remove([hw.file_url]); } catch { /* ignore */ }
      }
      const { error } = await service.from("homework").delete().eq("id", id);
      if (error) throw error;
      return json({ ok: true });
    }

    // ---------- classes ----------
    if (op === "class.cancel" || op === "class.reschedule") {
      const id = String(body.class_id || "");
      const { data: cls } = await service.from("classes")
        .select("id,tutor_id,google_event_id,meeting_status").eq("id", id).maybeSingle();
      if (!cls || cls.tutor_id !== userId) return json({ error: "Class not found." }, 404);
      if (cls.meeting_status === "cancelled") return json({ error: "This class is already cancelled." }, 409);

      if (op === "class.cancel") {
        if (cls.google_event_id) {
          const token = await googleAccessToken(service, userId);
          const res = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(cls.google_event_id)}?sendUpdates=all`,
            { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
          );
          if (!res.ok && res.status !== 404 && res.status !== 410) {
            return json({ error: res.status === 401 || res.status === 403 ? PERMISSION_MSG : `Google Calendar error (${res.status}).` }, 502);
          }
        }
        const { error } = await service.from("classes").update({ meeting_status: "cancelled" }).eq("id", id);
        if (error) throw error;
        return json({ ok: true });
      }

      const startsAt = new Date(String(body.starts_at || ""));
      const duration = Math.min(180, Math.max(15, Number(body.duration_minutes) || 60));
      if (Number.isNaN(startsAt.getTime())) return json({ error: "Choose a valid date and time." }, 400);
      if (startsAt.getTime() < Date.now() - 60_000) return json({ error: "Choose a time in the future." }, 400);
      const endsAt = new Date(startsAt.getTime() + duration * 60_000);

      if (cls.google_event_id) {
        const token = await googleAccessToken(service, userId);
        const res = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(cls.google_event_id)}?sendUpdates=all`,
          {
            method: "PATCH",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              start: { dateTime: startsAt.toISOString() },
              end: { dateTime: endsAt.toISOString() },
            }),
          },
        );
        if (!res.ok) {
          return json({ error: res.status === 401 || res.status === 403 ? PERMISSION_MSG : `Google Calendar error (${res.status}).` }, 502);
        }
      }
      const { error } = await service.from("classes")
        .update({ starts_at: startsAt.toISOString(), duration_minutes: duration }).eq("id", id);
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : (error as { message?: string })?.message || "Request failed." }, 500);
  }
});
