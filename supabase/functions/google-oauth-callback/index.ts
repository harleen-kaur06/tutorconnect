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

function appRedirect(status: string, message?: string) {
  const target = new URL(getEnv("APP_URL"));
  target.searchParams.set("google_calendar", status);
  if (message) target.searchParams.set("message", message.slice(0, 250));
  return redirect(target.toString());
}

Deno.serve(async (req) => {
  try {
    const incoming = new URL(req.url);
    const code = incoming.searchParams.get("code");
    const state = incoming.searchParams.get("state");
    const googleError = incoming.searchParams.get("error");
    if (googleError) return appRedirect("error", googleError);
    if (!code || !state) return appRedirect("error", "Missing Google authorization code or state.");

    const service = createClient(getEnv("SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const { data: stateRow, error: stateError } = await service
      .from("google_oauth_states").select("*").eq("state", state).maybeSingle();

    if (stateError || !stateRow || new Date(stateRow.expires_at).getTime() < Date.now()) {
      if (stateRow) await service.from("google_oauth_states").delete().eq("state", state);
      return appRedirect("error", "Authorization expired. Please connect Google Calendar again.");
    }
    await service.from("google_oauth_states").delete().eq("state", state);

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: getEnv("GOOGLE_CLIENT_ID"),
        client_secret: getEnv("GOOGLE_CLIENT_SECRET"),
        redirect_uri: getEnv("GOOGLE_REDIRECT_URI"),
        grant_type: "authorization_code",
      }),
    });
    const tokens = await tokenResponse.json();
    if (!tokenResponse.ok) {
      return appRedirect("error", tokens.error_description || tokens.error || "Google token exchange failed.");
    }

    const accessToken = tokens.access_token as string;
    const userInfoResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const userInfo = await userInfoResponse.json();
    if (!userInfoResponse.ok || !userInfo.email) {
      return appRedirect("error", "Google did not return an account email.");
    }

    // Google may omit refresh_token on a later authorization. Preserve an existing one.
    const { data: existing } = await service.from("google_calendar_connections")
      .select("refresh_token").eq("user_id", stateRow.user_id).maybeSingle();
    const refreshToken = tokens.refresh_token || existing?.refresh_token;
    if (!refreshToken) {
      return appRedirect("error", "Google did not provide offline access. Revoke this app in your Google Account and reconnect.");
    }

    const { error: saveError } = await service.from("google_calendar_connections").upsert({
      user_id: stateRow.user_id,
      google_email: userInfo.email,
      refresh_token: refreshToken,
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    if (saveError) throw saveError;
    return appRedirect("connected");
  } catch (error) {
    return appRedirect("error", error instanceof Error ? error.message : "Google Calendar connection failed.");
  }
});
