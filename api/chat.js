import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

export default async function handler(req, res) {
  console.log("==== REQUEST RECEIVED ====");
  console.log("Method:", req.method);
  console.log("Origin:", req.headers.origin);

  // =============================
  // CORS CONFIG (DEBUG MODE)
  // =============================
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // =============================
  // METHOD VALIDATION
  // =============================
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // =============================
    // BODY HANDLING
    // =============================
    const body =
      req.method === "GET"
        ? req.query
        : req.body || {};

    console.log("Parsed Body:", body);

    const message = body.message || body.text || body.prompt;
    const session_id = body.session_id || crypto.randomUUID();

    if (!message) {
      console.error("MESSAGE MISSING");
      return res.status(400).json({ error: "Missing message" });
    }

    // =============================
    // ENV VALIDATION
    // =============================
    const {
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY,
      OPENAI_API_KEY,
    } = process.env;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !OPENAI_API_KEY) {
      console.error("ENV ERROR");
      return res.status(500).json({ error: "Environment variables missing" });
    }

    const supabase = createClient(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY
    );

    // =============================
    // OPENAI CALL
    // =============================
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
              content: `
Você é um assistente mecânico especializado em diagnóstico automotivo.

Regras de resposta:

- Adapte a estrutura da resposta ao tipo de problema.
- Use linguagem simples e acessível para leigos.
- Evite termos excessivamente técnicos sem explicação.
- Não escreva textos longos em bloco.
- Organize a resposta com subtítulos claros quando necessário.

Sempre que aplicável, inclua:

🔎 O que pode estar acontecendo  
⚙️ Possíveis causas  
🚨 Nível de urgência (Baixo, Médio ou Alto)  
✅ O que o motorista pode fazer agora  
🚗 Pode continuar dirigindo? (Sim ou Não, com justificativa simples)

Se a situação for potencialmente perigosa, deixe isso claro.
Se for algo simples, tranquilize o usuário.
              `,
            },
            { role: "user", content: message },
          ],
        }),
      }
    );

    const data = await openaiResponse.json();

    const assistantReply =
      data?.choices?.[0]?.message?.content ||
      "Erro ao gerar resposta.";

    // =============================
    // SAVE CONVERSATION
    // =============================
    await supabase.from("conversations").insert([
      { session_id, role: "user", message },
      { session_id, role: "assistant", message: assistantReply },
    ]);

    return res.status(200).json({
      reply: assistantReply,
      session_id,
    });

  } catch (err) {
    console.error("SERVER ERROR:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
