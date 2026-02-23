import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  try {
    // ================================
    // 🔐 CORS CONFIG
    // ================================
    const origin = req.headers.origin || "";
    const allowedDomain = process.env.ALLOWED_ORIGIN; // lovable.app

    if (origin && origin.includes(allowedDomain)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
    }

    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Credentials", "true");

    // Permitir preflight request
    if (req.method === "OPTIONS") {
      return res.status(200).end();
    }

    // ================================
    // Permitir apenas POST
    // ================================
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    // ================================
    // Validar origem (segurança)
    // ================================
    if (!origin.includes(allowedDomain)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // ================================
    // Variáveis obrigatórias
    // ================================
    const {
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY,
      OPENAI_API_KEY,
      MAX_MESSAGES_PER_DAY,
    } = process.env;

    if (
      !SUPABASE_URL ||
      !SUPABASE_SERVICE_ROLE_KEY ||
      !OPENAI_API_KEY ||
      !MAX_MESSAGES_PER_DAY
    ) {
      console.error("Missing environment variables");
      return res.status(500).json({ error: "Server configuration error" });
    }

    // ================================
    // Inicializar Supabase
    // ================================
    const supabase = createClient(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY
    );

    const { message, session_id } = req.body;

    if (!message || !session_id) {
      return res.status(400).json({ error: "Missing message or session_id" });
    }

    // ================================
    // Limite diário por session_id
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

    if (count >= parseInt(MAX_MESSAGES_PER_DAY)) {
      return res.status(429).json({ error: "Daily limit reached" });
    }

    // ================================
    // Chamada OpenAI
    // ================================
    const openaiResponse = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
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
            {
              role: "user",
              content: message,
            },
          ],
        }),
      }
    );

    if (!openaiResponse.ok) {
      const errorText = await openaiResponse.text();
      console.error("OpenAI error:", errorText);
      return res.status(500).json({ error: "AI service error" });
    }

    const data = await openaiResponse.json();
    const assistantReply =
      data?.choices?.[0]?.message?.content || "Erro ao gerar resposta.";

    // ================================
    // Salvar no Supabase
    // ================================
    const { error: insertError } = await supabase
      .from("conversations")
      .insert([
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
    // Retornar resposta
    // ================================
    return res.status(200).json({ reply: assistantReply });
  } catch (error) {
    console.error("Server error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}
