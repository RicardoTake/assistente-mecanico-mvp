import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

export default async function handler(req, res) {
  // ================================
  // 🔐 CORS + ORIGIN VALIDATION
  // ================================
  const origin = req.headers.origin || "";
  const allowedDomain = (process.env.ALLOWED_ORIGIN || "").trim(); // ex: lovable.app

  // Regras:
  // - Permite qualquer subdomínio do domínio informado (ex: *.lovable.app)
  // - Permite localhost (dev)
  const isAllowedOrigin =
    (!!origin &&
      !!allowedDomain &&
      (origin === allowedDomain ||
        origin.endsWith(`.${allowedDomain}`) ||
        origin.includes(`://${allowedDomain}`))) ||
    origin.startsWith("http://localhost") ||
    origin.startsWith("http://127.0.0.1");

  // Se for permitido, ecoa o origin (necessário quando credenciais = true)
  if (isAllowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Credentials", "true");

  // Preflight
  if (req.method === "OPTIONS") return res.status(200).end();

  // Só POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Bloqueia origens não permitidas (se houver origin)
  // Obs: algumas chamadas server-to-server podem vir sem origin.
  if (origin && !isAllowedOrigin) {
    return res.status(403).json({ error: "Forbidden" });
  }

  try {
    // ================================
    // 🔧 ENV VARS
    // ================================
    const {
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY,
      OPENAI_API_KEY,
      MAX_MESSAGES_PER_DAY,
    } = process.env;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !OPENAI_API_KEY) {
      console.error("Missing env vars:", {
        SUPABASE_URL: !!SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY: !!SUPABASE_SERVICE_ROLE_KEY,
        OPENAI_API_KEY: !!OPENAI_API_KEY,
      });
      return res.status(500).json({ error: "Server configuration error" });
    }

    const maxPerDay = Number.parseInt(MAX_MESSAGES_PER_DAY || "50", 10);
    if (!Number.isFinite(maxPerDay) || maxPerDay <= 0) {
      return res.status(500).json({ error: "Invalid MAX_MESSAGES_PER_DAY" });
    }

    // ================================
    // 🧠 BODY
    // ================================
    const body = req.body || {};
    const message = body.message;

    // ✅ CORREÇÃO PRINCIPAL:
    // Se o Lovable não mandar session_id, nós criamos um.
    const session_id = body.session_id || crypto.randomUUID();

    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ error: "Missing message" });
    }

    // ================================
    // 🗄️ SUPABASE
    // ================================
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ================================
    // ⏱️ DAILY LIMIT (por session_id)
    // ================================
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const { count, error: countError } = await supabase
      .from("conversations")
      .select("*", { count: "exact", head: true })
      .eq("session_id", session_id)
      .gte("created_at", todayStart.toISOString());

    if (countError) {
      console.error("Usage check error:", countError);
      return res.status(500).json({ error: "Usage check failed" });
    }

    if ((count || 0) >= maxPerDay) {
      return res.status(429).json({ error: "Daily limit reached" });
    }

    // ================================
    // 🤖 OPENAI
    // ================================
    const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "Você é um assistente mecânico especializado em diagnóstico automotivo. Seja claro, direto e prático.",
          },
          { role: "user", content: message },
        ],
      }),
    });

    if (!openaiResponse.ok) {
      const errorText = await openaiResponse.text();
      console.error("OpenAI error:", errorText);
      return res.status(500).json({ error: "AI service error" });
    }

    const data = await openaiResponse.json();
    const assistantReply =
      data?.choices?.[0]?.message?.content || "Não consegui gerar uma resposta agora.";

    // ================================
    // 💾 SAVE (user + assistant)
    // ================================
    const { error: insertError } = await supabase.from("conversations").insert([
      {
        session_id,
        role: "user",
        message,
      },
      {
        session_id,
        role: "assistant",
        message: assistantReply,
      },
    ]);

    if (insertError) {
      console.error("Insert error:", insertError);
      return res.status(500).json({ error: "Database error" });
    }

    // ================================
    // ✅ RESPONSE
    // ================================
    return res.status(200).json({
      reply: assistantReply,
      session_id, // devolve pra UI usar nas próximas
    });
  } catch (error) {
    console.error("Server error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}
