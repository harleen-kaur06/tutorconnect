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
    const service = createClient(getEnv("SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const userClient = createClient(getEnv("SUPABASE_URL"), getEnv("SUPABASE_ANON_KEY"));
    const { data, error } = await userClient.auth.getUser(jwt);
    if (error || !data.user) return json({ error: "Invalid session." }, 401);

    const { data: profile } = await service.from("profiles")
      .select("role").eq("id", data.user.id).maybeSingle();
    if (profile?.role !== "tutor") return json({ connected: false, google_email: null });

    const { data: connection } = await service.from("google_calendar_connections")
      .select("google_email,refresh_token").eq("user_id", data.user.id).maybeSingle();
    if (!connection) return json({ connected: false, healthy: false, drive: false, gmail: false, google_email: null });

    // Check the stored refresh token is still valid and which permissions it carries.
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: getEnv("GOOGLE_CLIENT_ID"),
        client_secret: getEnv("GOOGLE_CLIENT_SECRET"),
        refresh_token: connection.refresh_token,
        grant_type: "refresh_token",
      }),
    });
    const tokenData = await tokenRes.json().catch(() => ({}));
    const healthy = tokenRes.ok && !!tokenData.access_token;
    const scope = String(tokenData.scope || "");
    return json({
      connected: true,
      healthy,
      drive: healthy && scope.includes("auth/drive"),
      gmail: healthy && scope.includes("gmail.send"),
      google_email: connection.google_email || null,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Could not check Google connection." }, 500);
  }
});
