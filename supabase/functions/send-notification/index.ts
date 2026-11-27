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

const toBase64 = (bytes: Uint8Array) => {
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s);
};
const toBase64Url = (bytes: Uint8Array) => toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const headerSafe = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

// From header with a display name, e.g. "Harleen Tutoring" <me@gmail.com>
function fromHeader(name: string, email: string) {
  const clean = name.replace(/[\r\n"\\]+/g, " ").trim();
  if (!clean) return email;
  if (/^[\x20-\x7e]+$/.test(clean)) return `"${clean}" <${email}>`;
  return `=?UTF-8?B?${toBase64(new TextEncoder().encode(clean))}?= <${email}>`;
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

    const { type, id } = await req.json();
    // deno-lint-ignore no-explicit-any
    let hw: any = null;

    if (type === "homework_assigned") {
      const r = await service.from("homework").select("id,title,due_date,tutor_id,student_id").eq("id", id).maybeSingle();
      hw = r.data;
      if (!hw || hw.tutor_id !== userId) return json({ error: "Not allowed." }, 403);
    } else if (type === "submission_received" || type === "feedback_sent") {
      const r = await service.from("submissions").select("id,homework_id,student_id,reviewed_at").eq("id", id).maybeSingle();
      const sub = r.data;
      if (!sub) return json({ error: "Submission not found." }, 404);
      const h = await service.from("homework").select("id,title,due_date,tutor_id,student_id").eq("id", sub.homework_id).maybeSingle();
      hw = h.data;
      if (!hw) return json({ error: "Homework not found." }, 404);
      if (type === "submission_received" && sub.student_id !== userId) return json({ error: "Not allowed." }, 403);
      if (type === "feedback_sent" && (hw.tutor_id !== userId || !sub.reviewed_at)) return json({ error: "Not allowed." }, 403);
    } else {
      return json({ error: "Unknown notification type." }, 400);
    }

    const { data: tutor } = await service.from("profiles").select("full_name,email").eq("id", hw.tutor_id).maybeSingle();
    const { data: student } = await service.from("profiles").select("full_name,email").eq("id", hw.student_id).maybeSingle();
    const recipient = type === "submission_received" ? tutor : student;
    if (!recipient?.email) return json({ sent: false, reason: "No recipient email." });

    const { data: conn } = await service.from("google_calendar_connections")
      .select("refresh_token,google_email").eq("user_id", hw.tutor_id).maybeSingle();
    if (!conn?.refresh_token || !conn.google_email) return json({ sent: false, reason: "Google not connected." });

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
    if (!tokenRes.ok || !tokenData.access_token) return json({ sent: false, reason: "Google authorization expired." });
    if (!String(tokenData.scope || "").includes("gmail.send")) return json({ sent: false, reason: "Gmail permission missing." });

    const appUrl = Deno.env.get("APP_URL") || "";
    const tutorName = tutor?.full_name || "Your tutor";
    const studentName = student?.full_name || "there";
    const due = hw.due_date ? ` It is due on ${hw.due_date}.` : "";
    let subject = "";
    let text = "";
    if (type === "homework_assigned") {
      subject = `New homework: ${hw.title}`;
      text = `Hi ${studentName},\n\n${tutorName} assigned new homework: "${hw.title}".${due}\n\nOpen the portal to see the details: ${appUrl}\n\n- Harleen Tutoring Portal`;
    } else if (type === "submission_received") {
      subject = `Homework submitted: ${hw.title}`;
      text = `Hi ${tutorName},\n\n${studentName} submitted "${hw.title}". It is ready for your review.\n\nOpen the portal: ${appUrl}\n\n- Harleen Tutoring Portal`;
    } else {
      subject = `Feedback on your homework: ${hw.title}`;
      text = `Hi ${studentName},\n\n${tutorName} reviewed "${hw.title}" and left feedback for you.\n\nOpen the portal to read it: ${appUrl}\n\n- Harleen Tutoring Portal`;
    }

    const enc = new TextEncoder();
    const mime = [
      `From: ${fromHeader(Deno.env.get("SENDER_NAME") || "Harleen Tutoring", headerSafe(conn.google_email))}`,
      `To: ${headerSafe(recipient.email)}`,
      `Subject: =?UTF-8?B?${toBase64(enc.encode(headerSafe(subject)))}?=`,
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      toBase64(enc.encode(text)),
    ].join("\r\n");

    const send = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenData.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw: toBase64Url(enc.encode(mime)) }),
    });
    if (!send.ok) return json({ sent: false, reason: `Gmail error (${send.status}).` });
    return json({ sent: true });
  } catch (error) {
    return json({ sent: false, reason: error instanceof Error ? error.message : "Notification failed." });
  }
});
