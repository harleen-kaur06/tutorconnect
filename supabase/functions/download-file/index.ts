import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    const { kind, id } = await req.json();
    let tutorId = "";
    let driveFileId = "";
    let allowed = false;

    if (kind === "homework") {
      const { data: hw } = await service.from("homework").select("student_id,tutor_id,drive_file_id").eq("id", id).maybeSingle();
      if (hw) {
        tutorId = hw.tutor_id;
        driveFileId = hw.drive_file_id || "";
        allowed = userId === hw.student_id || userId === hw.tutor_id;
      }
    } else if (kind === "homework_file") {
      const { data: f } = await service.from("homework_files").select("homework_id,drive_file_id").eq("id", id).maybeSingle();
      if (f) {
        const { data: hw } = await service.from("homework").select("student_id,tutor_id").eq("id", f.homework_id).maybeSingle();
        if (hw) {
          tutorId = hw.tutor_id;
          driveFileId = f.drive_file_id || "";
          allowed = userId === hw.student_id || userId === hw.tutor_id;
        }
      }
    } else if (kind === "submission") {
      const { data: sub } = await service.from("submissions").select("student_id,homework_id,drive_file_id").eq("id", id).maybeSingle();
      if (sub) {
        const { data: hw } = await service.from("homework").select("tutor_id").eq("id", sub.homework_id).maybeSingle();
        tutorId = hw?.tutor_id || "";
        driveFileId = sub.drive_file_id || "";
        allowed = userId === sub.student_id || (!!tutorId && userId === tutorId);
      }
    } else {
      return json({ error: "Unknown file type." }, 400);
    }

    if (!allowed) return json({ error: "You do not have access to this file." }, 403);
    if (!driveFileId) return json({ error: "This item has no file stored in Google Drive." }, 404);

    const { data: conn } = await service.from("google_calendar_connections")
      .select("refresh_token").eq("user_id", tutorId).maybeSingle();
    if (!conn?.refresh_token) return json({ error: "The tutor has not connected Google." }, 409);

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: getEnv("GOOGLE_CLIENT_ID"),
        client_secret: getEnv("GOOGLE_CLIENT_SECRET"),
        refresh_token: conn.refresh_token,
        grant_type: "refresh_token",
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) {
      return json({ error: "Google authorization expired. The tutor must reconnect Google." }, 401);
    }

    const file = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveFileId)}?alt=media&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${tokenData.access_token}` } },
    );
    if (!file.ok) return json({ error: `Could not read the file from Google Drive (${file.status}).` }, 502);

    return new Response(file.body, { headers: { ...corsHeaders, "Content-Type": "application/octet-stream" } });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Could not open the file." }, 500);
  }
});
