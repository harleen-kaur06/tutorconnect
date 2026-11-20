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

const ALLOWED: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};
const MAX_BYTES = 10 * 1024 * 1024;
const FOLDER_MIME = "application/vnd.google-apps.folder";
const PERMISSION_MSG =
  "Google Drive permission is missing or expired. The tutor must click “Connect Google Calendar” again and allow Drive access.";

const cleanName = (s: string) => s.replace(/[\\/:*?"<>|\r\n]+/g, " ").trim().slice(0, 80);
const escQuery = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

async function getAccessToken(refreshToken: string) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: getEnv("GOOGLE_CLIENT_ID"),
      client_secret: getEnv("GOOGLE_CLIENT_SECRET"),
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) throw new Error(PERMISSION_MSG);
  return data.access_token as string;
}

async function driveError(res: Response) {
  if (res.status === 401 || res.status === 403) return new Error(PERMISSION_MSG);
  if (res.status === 404) {
    return new Error("Drive folder not found. Check DRIVE_ROOT_FOLDER_ID and that the connected Google account can edit that folder.");
  }
  let detail = "";
  try { detail = (await res.json())?.error?.message || ""; } catch { /* ignore */ }
  return new Error(`Google Drive error (${res.status}). ${detail}`.trim());
}

async function findOrCreateFolder(token: string, name: string, parentId: string) {
  const headers = { Authorization: `Bearer ${token}` };
  const q = `mimeType='${FOLDER_MIME}' and name='${escQuery(name)}' and '${parentId}' in parents and trashed=false`;
  const list = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { headers },
  );
  if (!list.ok) throw await driveError(list);
  const found = (await list.json()).files?.[0]?.id;
  if (found) return found as string;

  const create = await fetch("https://www.googleapis.com/drive/v3/files?fields=id&supportsAllDrives=true", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
  });
  if (!create.ok) throw await driveError(create);
  return (await create.json()).id as string;
}

async function uploadToDrive(token: string, folderId: string, name: string, mime: string, bytes: Uint8Array) {
  const boundary = `b${crypto.randomUUID()}`;
  const enc = new TextEncoder();
  const head = enc.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify({ name, parents: [folderId] })}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`,
  );
  const tail = enc.encode(`\r\n--${boundary}--`);
  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id&supportsAllDrives=true",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
      body: new Blob([head, bytes, tail]),
    },
  );
  if (!res.ok) throw await driveError(res);
  return (await res.json()).id as string;
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

    const form = await req.formData();
    const kind = String(form.get("kind") || "");
    const file = form.get("file");
    if (!(file instanceof File)) return json({ error: "Choose a file to upload." }, 400);

    const ext = (file.name.split(".").pop() || "").toLowerCase();
    const mime = ALLOWED[ext];
    if (!mime) return json({ error: "Only PDF, DOC, DOCX, JPG and PNG files are allowed." }, 400);
    if (file.size > MAX_BYTES) return json({ error: "File is too large. Maximum size is 10 MB." }, 400);

    let tutorId = "";
    let studentId = "";
    let homeworkId = "";
    let hwFields = { title: "", description: "", due_date: "" };

    if (kind === "homework") {
      if (me?.role !== "tutor") return json({ error: "Only tutors can attach files to homework." }, 403);
      tutorId = userId;
      studentId = String(form.get("student_id") || "");
      hwFields = {
        title: String(form.get("title") || "").trim(),
        description: String(form.get("description") || ""),
        due_date: String(form.get("due_date") || ""),
      };
      if (!studentId || !hwFields.title) return json({ error: "Homework title and student are required." }, 400);
    } else if (kind === "submission") {
      if (me?.role !== "student") return json({ error: "Only students can submit homework." }, 403);
      homeworkId = String(form.get("homework_id") || "");
      const { data: hw } = await service.from("homework").select("id,tutor_id,student_id").eq("id", homeworkId).maybeSingle();
      if (!hw || hw.student_id !== userId) return json({ error: "This homework is not assigned to you." }, 403);
      tutorId = hw.tutor_id;
      studentId = userId;
    } else {
      return json({ error: "Unknown upload type." }, 400);
    }

    const { data: student } = await service.from("profiles").select("full_name,email").eq("id", studentId).maybeSingle();
    if (!student) return json({ error: "Student account not found." }, 404);

    const { data: conn } = await service.from("google_calendar_connections")
      .select("refresh_token").eq("user_id", tutorId).maybeSingle();
    if (!conn?.refresh_token) return json({ error: "The tutor has not connected Google yet." }, 409);

    const token = await getAccessToken(conn.refresh_token);
    const rootId = getEnv("DRIVE_ROOT_FOLDER_ID");
    const studentFolder = await findOrCreateFolder(token, cleanName(student.full_name || student.email) || "Student", rootId);
    const typeFolder = await findOrCreateFolder(
      token,
      kind === "homework" ? "Homework assigned" : "Homework submitted",
      studentFolder,
    );

    const driveName = `${new Date().toISOString().slice(0, 10)} - ${cleanName(file.name)}`;
    const driveFileId = await uploadToDrive(token, typeFolder, driveName, mime, new Uint8Array(await file.arrayBuffer()));

    const fileInfo = { drive_file_id: driveFileId, file_name: file.name, file_mime: mime };
    const { data: row, error: saveError } = kind === "homework"
      ? await service.from("homework").insert({
        title: hwFields.title,
        description: hwFields.description,
        due_date: hwFields.due_date || null,
        student_id: studentId,
        tutor_id: tutorId,
        ...fileInfo,
      }).select("id").single()
      : await service.from("submissions").insert({
        homework_id: homeworkId,
        student_id: studentId,
        file_url: "",
        ...fileInfo,
      }).select("id").single();

    if (saveError) {
      await fetch(`https://www.googleapis.com/drive/v3/files/${driveFileId}?supportsAllDrives=true`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      throw saveError;
    }

    return json({ id: row.id, ...fileInfo, message: kind === "homework" ? "Homework published." : "Homework submitted." });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Upload failed." }, 500);
  }
});
