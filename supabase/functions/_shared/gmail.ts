// Sends a plain-text email from the tutor's connected Google account.
// deno-lint-ignore no-explicit-any
export async function sendGmail(db: any, tutorId: string, to: string, subject: string, text: string) {
  const { data: conn } = await db.from("google_calendar_connections")
    .select("refresh_token,google_email").eq("user_id", tutorId).maybeSingle();
  if (!conn?.refresh_token) throw new Error("Google is not connected.");
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
      refresh_token: conn.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const t = await tokenRes.json();
  if (!tokenRes.ok || !t.access_token) throw new Error("Google authorization expired.");
  const enc = new TextEncoder();
  const b64 = (b: Uint8Array) => { let s = ""; b.forEach((x) => (s += String.fromCharCode(x))); return btoa(s); };
  const safe = (v: string) => v.replace(/[\r\n]+/g, " ").trim();
  const mime = [
    `From: ${safe(conn.google_email)}`,
    `To: ${safe(to)}`,
    `Subject: =?UTF-8?B?${b64(enc.encode(safe(subject)))}?=`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    b64(enc.encode(text)),
  ].join("\r\n");
  const raw = b64(enc.encode(mime)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${t.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
  });
  if (!res.ok) throw new Error(`Gmail error (${res.status}).`);
}
