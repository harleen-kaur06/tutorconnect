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
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "Sign in first." }, 401);

    const url = getEnv("SUPABASE_URL");
    const anon = getEnv("SUPABASE_ANON_KEY");
    const service = createClient(url, getEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const userClient = createClient(url, anon);
    const { data: userData, error: userError } = await userClient.auth.getUser(jwt);
    if (userError || !userData.user) return json({ error: "Your session is invalid. Sign in again." }, 401);

    const { data: profile } = await service.from("profiles")
      .select("role").eq("id", userData.user.id).maybeSingle();
    if (profile?.role !== "tutor") return json({ error: "Only the tutor account can connect the calendar." }, 403);

    const state = crypto.randomUUID();
    const { error: stateError } = await service.from("google_oauth_states").insert({
      state,
      user_id: userData.user.id,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });
    if (stateError) throw stateError;

    const redirectUri = getEnv("GOOGLE_REDIRECT_URI");
    const params = new URLSearchParams({
      client_id: getEnv("GOOGLE_CLIENT_ID"),
      redirect_uri: redirectUri,
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      scope: "openid email https://www.googleapis.com/auth/calendar.events",
      state,
    });

    return json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Could not start Google authorization." }, 500);
  }
});
