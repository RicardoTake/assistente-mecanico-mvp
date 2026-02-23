import crypto from "crypto";

function parseCookies(cookieHeader = "") {
  const out = {};
  cookieHeader.split(";").forEach((part) => {
    const [k, ...v] = part.trim().split("=");
    if (!k) return;
    out[k] = decodeURIComponent(v.join("=") || "");
  });
  return out;
}

function setSessionCookie(res, sid) {
  // Cookie de sessão (HTTP-only) para não depender do frontend
  // Lax ajuda a funcionar bem no navegador
  const cookie = [
    `sid=${encodeURIComponent(sid)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Secure",
    // 14 dias
    `Max-Age=${14 * 24 * 60 * 60}`,
  ].join("; ");
  res.setHeader("Set-Cookie", cookie);
}

function originAllowed(req, allowedOriginsCsv) {
  if (!allowedOriginsCsv) return true; // se não configurar, não bloqueia
  const origin = req.headers.origin;
  if (!origin) return true; // alguns clientes não mandam origin
  const allowed = allowedOriginsCsv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return allowed.includes(origin);
}

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    // ✅ Proteção por origem (opcional, mas recomendado)
    const allowedOrigins = process.env.ALLOWED_ORIGINS || "";
    if (!originAllowed(req, allowedOrigins)) {
      return res.status(403).json({ error: "Forbidden origin" });
    }

    const body = req.body || {};
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const singleMessage = typeof body.message === "string" ? body.message : null;

    if (!singleMessage && messages.length === 0) {
      return res.status(400).json({ error: "Message or messages[] is required" });
    }

    // OpenAI envs
    const apiKey = process.env.OPENAI_API_KEY;
    const projectId = process.env.OPENAI_PROJECT_ID;
    const orgId = process.env.OPENAI_ORG_ID;
    const model = process.env.OPENAI_MODEL;
    const instructions = process.env.ASSISTANT_INSTRUCTIONS;

    // Supabase envs
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    const maxPerDay = Number(process.env.MAX_MESSAGES_PER_DAY || "30");

    if (!apiKey || !projectId || !orgId || !model || !instructions) {
      return res.status(500).json({ error: "Missing OpenAI environment variables" });
    }
    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({ error: "Missing Supabase environment variables" });
    }

    // ✅ Sessão via cookie (sem depender do Lovable)
    const cookies = parseCookies(req.headers.cookie || "");
    let sessionId = cookies.sid;

    if (!sessionId) {
      sessionId = crypto.randomUUID();
      setSessionCookie(res, sessionId);
    }

    // Criar client do Supabase
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(supabaseUrl, supabaseKey);

    // ✅ Rate limit / quota diária por sessão (atômico)
    const { data: usageCount, error: usageErr } = await supabase.rpc("increment_usage", {
      p_session_id: sessionId,
    });

    if (usageErr) {
      // Se falhar o controle, não derruba MVP — mas loga
      console.error("usage increment error:", usageErr);
    } else if (typeof usageCount === "number" && usageCount > maxPerDay) {
      return res.status(429).json({
        error: "Daily limit reached",
        details: `Você atingiu o limite diário de ${maxPerDay} mensagens. Tente novamente amanhã.`,
      });
    }

    // Definir input (memória simples: últimas 8 mensagens)
    const input = messages.length > 0 ? messages.slice(-8) : singleMessage;

    // Descobrir texto do usuário para log
    let userTextToStore = singleMessage;
    if (!userTextToStore && messages.length > 0) {
      const lastUser = [...messages].reverse().find((m) => m?.role === "user");
      userTextToStore = lastUser?.content ? String(lastUser.content) : null;
    }

    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "OpenAI-Organization": orgId,
      "OpenAI-Project": projectId,
    };

    const startTime = Date.now();

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers,
      body: JSON.stringify({ model, instructions, input }),
    });

    const data = await response.json();
    const responseTimeMs = Date.now() - startTime;

    if (!response.ok) {
      return res.status(500).json({ error: "OpenAI API error", details: data });
    }

    // Parsing do texto
    let reply = "Sem resposta do modelo.";
    if (data.output && Array.isArray(data.output)) {
      for (const item of data.output) {
        if (item.content && Array.isArray(item.content)) {
          for (const content of item.content) {
            if (content.type === "output_text" && content.text) reply = content.text;
          }
        }
      }
    }

    // ✅ Log no Supabase (não derruba o chat se falhar)
    try {
      if (userTextToStore) {
        await supabase.from("conversations").insert({
          session_id: sessionId,
          role: "user",
          message: userTextToStore,
        });
      }
      await supabase.from("conversations").insert({
        session_id: sessionId,
        role: "assistant",
        message: reply,
      });
    } catch (e) {
      console.error("supabase log error:", e);
    }

    return res.status(200).json({
      reply,
      session_id: sessionId,
      response_time_ms: responseTimeMs,
    });
  } catch (error) {
    return res.status(500).json({
      error: "Internal server error",
      details: String(error?.message || error),
    });
  }
}
