import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  try {
    // ================================
    // 1️⃣ Permitir apenas POST
    // ================================
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    // ================================
    // 2️⃣ Validação de ORIGIN (segurança)
    // Permite qualquer subdomínio lovable.app
    // ================================
    const origin = req.headers.origin || "";
    const allowedDomain = process.env.ALLOWED_ORIGIN; // deve ser: lovable.app

    if (!origin.includes(allowedDomain)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // ================================
    // 3️⃣ Variáveis de ambiente obrigatórias
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
      return res.status(500).json({ error: "Missing environment variables" });
    }

    // ================================
    // 4️⃣ Inicializar Supabase
    // ================================
    const supabase = createClient(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY
    );

    // ================================
    // 5️⃣ Pegar dados do body
    // ================================
    const { message, session_id } = req.body;

    if (!message || !session_id) {
      return res.status(400).json({ error: "Missing message or session_id" });
    }

    // ================================
    // 6️⃣ Verificar limite diário
    // ================================
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const { count, error: countError } = await supabase
      .from("conversations")
      .select("*", { count: "exact", head: true })
      .eq("session_id", session_id)
      .gte("created_at", todayStart.toISOString());

    if (countError) {
      return res.status(500).json({ error: "Error checking usage" });
    }

    if (count >= parseInt(MAX_MESSAGES_PER_DAY)) {
      return res.status(429).json({ error: "Daily limit reached" });
    }

    // ================================
    // 7️⃣ Chamar OpenAI
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
      return res.status(500).json({ error: "OpenAI API error" });
    }

    const data = await openaiResponse.json();
    const assistantReply = data.choices[0].message.content;

    // ================================
    // 8️⃣ Salvar no Supabase
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
      return res.status(500).json({ error: "Error saving conversation" });
    }

    // ================================
    // 9️⃣ Retornar resposta
    // ================================
    return res.status(200).json({ reply: assistantReply });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Internal server error" });
  }
}
