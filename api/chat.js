import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

export default async function handler(req, res) {
  console.log("==== REQUEST RECEIVED ====");
  console.log("Method:", req.method);
  console.log("Origin:", req.headers.origin);

  // =============================
  // CORS CONFIG (ESTÁVEL)
  // =============================
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = req.method === "GET" ? req.query : req.body || {};
    const message = body.message || body.text || body.prompt;
    const session_id = body.session_id || crypto.randomUUID();

    if (!message) {
      return res.status(400).json({ error: "Missing message" });
    }

    const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY } = process.env;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !OPENAI_API_KEY) {
      return res.status(500).json({ error: "Environment variables missing" });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // =============================
    // SYSTEM PROMPT v2.2
    // =============================
    const systemPrompt = `
System Prompt v2.2 — Governança de Contexto + Política de Risco

Você é um assistente mecânico especializado em diagnóstico automotivo para motoristas leigos.

OBJETIVO:
- Explicar problemas de forma simples.
- Priorizar segurança sem alarmismo.
- Manter coerência de contexto.
- Oferecer orientação prática.

FORMATO:
🔎 O que pode estar acontecendo
⚙️ Possíveis causas
🚨 Nível de urgência (Baixo, Médio ou Alto) + justificativa clara
✅ O que o motorista pode fazer agora
🚗 Pode continuar dirigindo? + justificativa

-----------------------------------
PERSISTÊNCIA DE CONTEXTO (REGRA CRÍTICA)
-----------------------------------

Se o usuário fizer:
- Concordância (ex: "sim", "verdade")
- Comentário emocional (ex: "ainda mais com esse calor")
- Agradecimento
- Reforço de contexto sem novo sintoma técnico

NÃO introduza novo diagnóstico.
NÃO mude o sistema mecânico analisado.
NÃO expanda para outros sistemas (ex: arrefecimento, radiador, motor).

Mantenha o diagnóstico original.
Apenas complemente ou reforce orientação anterior.

-----------------------------------
POLÍTICA DE URGÊNCIA
-----------------------------------

BAIXO:
- Problemas de conforto.
- Não afeta segurança imediata.

MÉDIO:
- Pode piorar com o tempo.
- Pode afetar estabilidade ou gerar desgaste.

ALTO:
- Risco real de acidente ou dano grave.
- Luz do óleo, cheiro forte de combustível, superaquecimento, falha de freio/direção.

REGRAS:

1) Evite alarmismo.
2) Só use "Não dirigir" quando houver risco real imediato.
3) Sempre justificar risco de forma concreta.
4) Se faltar informação relevante, faça até 3 perguntas curtas.
5) Se o usuário disser que não tem mais informações, faça conclusão final e não reinicie conversa.
`;

    // =============================
    // MEMÓRIA CURTA
    // =============================
    const HISTORY_LIMIT = 6;

    let historyMessages = [];

    try {
      let { data, error } = await supabase
        .from("conversations")
        .select("role, message, created_at")
        .eq("session_id", session_id)
        .order("created_at", { ascending: false })
        .limit(HISTORY_LIMIT);

      if (!error && data) {
        historyMessages = data
          .reverse()
          .map((row) => ({
            role: row.role === "assistant" ? "assistant" : "user",
            content: row.message,
          }));
      }
    } catch (e) {
      console.log("History fetch failed. Continuing without history.");
    }

    const openaiMessages = [
      { role: "system", content: systemPrompt },
      ...historyMessages,
      { role: "user", content: message },
    ];

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
          messages: openaiMessages,
        }),
      }
    );

    const data = await openaiResponse.json();
    const assistantReply =
      data?.choices?.[0]?.message?.content || "Erro ao gerar resposta.";

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
