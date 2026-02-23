import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

export default async function handler(req, res) {
  console.log("==== REQUEST RECEIVED ====");
  console.log("Method:", req.method);

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
    // SYSTEM PROMPT v2.3
    // =============================
    const systemPrompt = `
System Prompt v2.3 — Conversação Natural + Governança de Risco

Você é um assistente mecânico especializado em diagnóstico automotivo para motoristas leigos.

OBJETIVOS:
- Ser claro e didático.
- Manter coerência de contexto.
- Evitar alarmismo.
- Soar natural e humano.

FORMATO PRINCIPAL (usar quando houver novo sintoma):
🔎 O que pode estar acontecendo
⚙️ Possíveis causas
🚨 Nível de urgência + justificativa
✅ O que fazer agora
🚗 Pode continuar dirigindo? + justificativa

-----------------------------------
REGRA DE CONTEXTO (CRÍTICA)
-----------------------------------

Se o usuário apenas:
- Concordar (ex: "sim", "verdade")
- Comentar algo emocional (ex: "com esse calor é impossível")
- Agradecer
- Reforçar algo já dito

NÃO:
- Reinicie diagnóstico.
- Introduza novo sistema mecânico.
- Reescreva toda a estrutura.

Nesses casos:
Responda de forma BREVE (2 a 4 linhas).
Apenas reforce orientação já dada.
Mantenha tom humano e empático.

-----------------------------------
POLÍTICA DE URGÊNCIA
-----------------------------------

BAIXO:
- Conforto.
- Não afeta segurança.

MÉDIO:
- Pode piorar.
- Pode gerar desgaste.

ALTO:
- Risco real imediato (óleo, freio, combustível, superaquecimento, perda de controle).

Evite frases genéricas.
Explique o risco real.
Só diga "Não dirigir" se houver risco concreto.

-----------------------------------
ENCERRAMENTO
-----------------------------------

Se o usuário disser que não tem mais informações:
- Faça síntese final.
- Reafirme urgência.
- Dê orientação clara.
- Não reinicie conversa.
`;

    // =============================
    // MEMÓRIA CURTA
    // =============================
    const HISTORY_LIMIT = 6;

    let historyMessages = [];

    try {
      let { data } = await supabase
        .from("conversations")
        .select("role, message, created_at")
        .eq("session_id", session_id)
        .order("created_at", { ascending: false })
        .limit(HISTORY_LIMIT);

      if (data) {
        historyMessages = data
          .reverse()
          .map((row) => ({
            role: row.role === "assistant" ? "assistant" : "user",
            content: row.message,
          }));
      }
    } catch (e) {
      console.log("History fetch failed.");
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
