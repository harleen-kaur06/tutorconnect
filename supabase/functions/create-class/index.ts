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

function redirect(url: string) {
  return new Response(null, { status: 302, headers: { Location: url } });
}

function getEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    const tutorId = authData.user.id;

    const { data: tutor } = await service.from("profiles")
      .select("role").eq("id", tutorId).maybeSingle();
    if (tutor?.role !== "tutor") return json({ error: "Only tutors can schedule classes." }, 403);

    const body = await req.json();
    const title = String(body.title || "").trim();
    const studentEmail = String(body.student_email || "").trim().toLowerCase();
    const startsAt = new Date(body.starts_at);
    const duration = Math.min(Math.max(Number(body.duration_minutes) || 60, 15), 180);
    if (!title || !studentEmail || Number.isNaN(startsAt.getTime()) || startsAt.getTime() <= Date.now()) {
      return json({ error: "Enter a class title, a valid future date/time, and the student's email." }, 400);
    }

    const { data: student } = await service.from("profiles")
      .select("id,email,full_name").eq("email", studentEmail).eq("role", "student").maybeSingle();
    if (!student) return json({ error: "Student account not found. Ask the student to register first." }, 404);

    const { data: connection } = await service.from("google_calendar_connections")
      .select("refresh_token").eq("user_id", tutorId).maybeSingle();
    if (!connection?.refresh_token) return json({ error: "Connect the tutor's Google Calendar before scheduling a class." }, 409);

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: getEnv("GOOGLE_CLIENT_ID"),
        client_secret: getEnv("GOOGLE_CLIENT_SECRET"),
        refresh_token: connection.refresh_token,
        grant_type: "refresh_token",
      }),
    });
    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenData.access_token) {
      return json({ error: "Google authorization expired or was revoked. Reconnect Google Calendar." }, 401);
    }

    const endsAt = new Date(startsAt.getTime() + duration * 60_000);
    const eventBody = {
      summary: title,
      description: `Tutoring session with ${student.full_name || student.email}.`,
      start: { dateTime: startsAt.toISOString() },
      end: { dateTime: endsAt.toISOString() },
      attendees: [{ email: student.email }],
      conferenceData: {
        createRequest: {
          requestId: crypto.randomUUID(),
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      },
    };

    const googleResponse = await fetch(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(eventBody),
      },
    );
    const event = await googleResponse.json();
    if (!googleResponse.ok) {
      return json({ error: event.error?.message || "Google Calendar could not create the event." }, 502);
    }

    // Meet conference generation is asynchronous. Check briefly for its video URL.
    let currentEvent = event;
    let meetUrl = currentEvent.conferenceData?.entryPoints?.find((p: any) => p.entryPointType === "video")?.uri || "";
    for (let attempt = 0; !meetUrl && attempt < 3; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const check = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(event.id)}`,
        { headers: { Authorization: `Bearer ${tokenData.access_token}` } },
      );
      if (check.ok) {
        currentEvent = await check.json();
        meetUrl = currentEvent.conferenceData?.entryPoints?.find((p: any) => p.entryPointType === "video")?.uri || "";
      }
    }

    const { data: savedClass, error: saveError } = await service.from("classes").insert({
      title,
      starts_at: startsAt.toISOString(),
      meet_url: meetUrl,
      student_id: student.id,
      tutor_id: tutorId,
      google_event_id: event.id,
      calendar_event_url: event.htmlLink || null,
      meeting_status: meetUrl ? "ready" : "pending",
    }).select("*").single();

    if (saveError) {
      // Avoid leaving a Google Calendar event behind if the portal could not save it.
      await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(event.id)}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${tokenData.access_token}` } },
      );
      throw saveError;
    }

    return json({
      class: savedClass,
      meet_url: meetUrl,
      meeting_status: meetUrl ? "ready" : "pending",
      message: meetUrl
        ? "Class scheduled. The Google Meet link and calendar invitation have been created."
        : "Calendar event created. Google is still generating the Meet link; refresh the Classes page shortly.",
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Could not schedule the class." }, 500);
  }
});
