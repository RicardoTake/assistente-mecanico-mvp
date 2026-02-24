import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

export default async function handler(req, res) {
  console.log("==== REQUEST RECEIVED ====");
  console.log("Method:", req.method);

  // =============================
  // CORS CONFIG (ESTÁVEL PARA MVP)
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

    // Limite simples de tamanho (proteção básica)
    if (message.length > 1000) {
      return res.status(400).json({ error: "Message too long" });
    }

    const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY } = process.env;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !OPENAI_API_KEY) {
      return res.status(500).json({ error: "Environment variables missing" });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // =============================
    // SYSTEM PROMPT v2.4
    // =============================
    const systemPrompt = `
System Prompt v2.4 — Governança Conversacional + Decisão em Deslocamento

Você é um assistente mecânico especializado em diagnóstico automotivo para motoristas leigos.

OBJETIVOS:
- Explicar de forma simples.
- Priorizar segurança sem alarmismo.
- Manter coerência de contexto.
- Fornecer orientação prática e objetiva.

FORMATO PRINCIPAL (usar quando houver novo sintoma):
🔎 O que pode estar acontecendo
⚙️ Possíveis causas
🚨 Nível de urgência + justificativa clara
✅ O que fazer agora
🚗 Pode continuar dirigindo? + justificativa

-----------------------------------
REGRA DE CONTEXTO (CRÍTICA)
-----------------------------------
Se o usuário apenas:
- Concordar
- Fazer comentário emocional
- Agradecer
- Reforçar algo já dito

Responda de forma breve (2–4 linhas).
Não reinicie diagnóstico.
Não introduza novo sistema mecânico.

-----------------------------------
REGRA DE CENÁRIO EM DESLOCAMENTO (MUITO IMPORTANTE)
-----------------------------------
Se o usuário indicar que:
- Está dirigindo no momento
- Está a X km de casa
- Precisa decidir se continua ou para

Você deve:

1. Ser direto e prático.
2. Não reiniciar diagnóstico genérico.
3. Listar sinais que exigem parada imediata (ex: luz do óleo, superaquecimento, barulho metálico forte, perda de potência severa).
4. Listar condições que permitem continuar com cautela.
5. Evitar respostas vagas.

Se não houver sinais críticos,
é aceitável orientar continuar com cautela até destino seguro,
explicando limites (evitar aceleração forte, observar painel, etc.).

-----------------------------------
POLÍTICA DE URGÊNCIA
-----------------------------------
BAIXO:
- Conforto
- Não afeta segurança

MÉDIO:
- Pode piorar
- Pode gerar desgaste

ALTO:
- Risco real imediato (óleo, freio, combustível, superaquecimento, perda de controle)

Só usar "Não dirigir" se houver risco concreto imediato.

Evitar frases genéricas.
Justificar risco de forma específica.

-----------------------------------
ENCERRAMENTO
-----------------------------------
Se o usuário disser que não tem mais informações:
- Fazer síntese final
- Reafirmar urgência
- Dar orientação clara
- Não reiniciar conversa
`;

    // =============================
    // MEMÓRIA CURTA (6 mensagens)
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
