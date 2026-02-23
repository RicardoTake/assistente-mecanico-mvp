import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

export default async function handler(req, res) {
  console.log("==== REQUEST RECEIVED ====");
  console.log("Method:", req.method);
  console.log("Origin:", req.headers.origin);

  // =============================
  // CORS CONFIG (DEBUG MODE - ESTÁVEL)
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
    const body = req.method === "GET" ? req.query : req.body || {};
    console.log("Parsed Body:", body);

    const message = body.message || body.text || body.prompt;

    // session_id: ideal vir do frontend. Se não vier, criamos um novo.
    const session_id = body.session_id || crypto.randomUUID();

    if (!message) {
      console.error("MESSAGE MISSING");
      return res.status(400).json({ error: "Missing message" });
    }

    // =============================
    // ENV VALIDATION
    // =============================
    const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY } =
      process.env;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !OPENAI_API_KEY) {
      console.error("ENV ERROR");
      return res.status(500).json({ error: "Environment variables missing" });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // =============================
    // SYSTEM PROMPT V2 (CONSOLIDADO)
    // =============================
    const systemPromptV2 = `
Você é um assistente mecânico especializado em diagnóstico automotivo para motoristas leigos.

Objetivo:
- Ajudar o motorista a entender o problema com linguagem simples.
- Priorizar segurança sem alarmismo.
- Orientar próximos passos práticos.
- Ser claro, escaneável e direto.

Estilo:
- Não escreva blocos longos de texto.
- Use subtítulos e listas curtas.
- Evite termos técnicos sem explicar rapidamente.
- Use emojis nos títulos.

Estrutura (adapte conforme o caso; use apenas o que fizer sentido):
🔎 O que pode estar acontecendo
⚙️ Possíveis causas (lista)
🚨 Nível de urgência (Baixo, Médio ou Alto) + justificativa específica
✅ O que o motorista pode fazer agora (passos simples)
🚗 Pode continuar dirigindo? (Sim / Sim, mas com cautela / Depende / Não) + justificativa curta

Política de urgência (muito importante):
- BAIXO: conforto, ruídos leves, falhas não relacionadas à segurança/dirigibilidade. Exemplos: ar-condicionado fraco, barulho leve em lombadas sem outros sintomas.
- MÉDIO: pode piorar, pode causar desgaste, mas geralmente permite rodar com cautela e por pouco tempo. Exemplos: vibração em alta velocidade (possível balanceamento), carro puxando levemente (alinhamento/pneu).
- ALTO: risco real de acidente, incêndio, perda de controle, falha de freio/direção, superaquecimento grave, luz de óleo, cheiro forte de combustível. Exige ação imediata.

Regras para evitar “tudo vira Médio”:
- Se o caso for claramente só conforto → BAIXO.
- Se houver dúvida e o sintoma for “zona cinzenta”, use urgência CONDICIONAL:
  - Se leve e não piora → BAIXO
  - Se piora, exige correção constante, vibração aumenta → MÉDIO
  - Se há perda de controle, cheiro forte de combustível, luz crítica, fumaça, barulho metálico forte, superaquecimento, falha de freio/direção → ALTO

Justificativas:
- Proibido justificar com frases genéricas tipo “para evitar maiores danos”.
- Sempre explique o motivo real (ex: “pode comprometer estabilidade”, “pode superaquecer”, “pode causar perda de frenagem”, “risco de incêndio”).

Regra do “Pode continuar dirigindo?”:
- Evite alarmismo.
- Só responda “NÃO” quando houver risco real de acidente/incêndio/dano grave imediato.
- Se não for grave, prefira:
  - “Sim, mas com cautela” (e diga limites: evitar alta velocidade, evitar estrada, ir direto a uma oficina).
  - “Depende” quando faltar informação e liste 2 sinais que mudam a decisão.

Coerência:
- Se você marcar urgência ALTO e “Não dirigir”, não diga “dirija até o mecânico”.
  - Em casos graves, recomende parar com segurança e considerar guincho/assistência.

Perguntas de triagem:
- Quando faltar informação para decidir urgência, faça 1–3 perguntas curtas no final (ex: “o barulho aumenta ao frear?”, “há vibração no volante?”, “há luz no painel?”).

Restrições:
- Não invente fatos. Se algo for incerto, diga que é hipótese.
- Incentive avaliação presencial quando apropriado.
`;

    // =============================
    // MEMORY: FETCH LAST N MESSAGES
    // =============================
    const HISTORY_LIMIT = 6;

    let historyMessages = [];
    try {
      // Tentativa 1: ordenar por created_at (padrão do Supabase)
      let { data: rows, error } = await supabase
        .from("conversations")
        .select("role, message, created_at")
        .eq("session_id", session_id)
        .order("created_at", { ascending: false })
        .limit(HISTORY_LIMIT);

      // Se a coluna created_at não existir ou houver erro, tentar fallback por id
      if (error) {
        console.warn("History fetch (created_at) failed:", error?.message);

        const fallback = await supabase
          .from("conversations")
          .select("role, message, id")
          .eq("session_id", session_id)
          .order("id", { ascending: false })
          .limit(HISTORY_LIMIT);

        if (fallback.error) {
          console.warn("History fetch (id) failed:", fallback.error?.message);
          rows = [];
        } else {
          rows = fallback.data || [];
        }
      }

      // rows vem DESC; reverte para ASC para manter a conversa na ordem
      const ordered = (rows || []).slice().reverse();

      historyMessages = ordered
        .filter((r) => r?.role && r?.message)
        .map((r) => ({
          role: r.role === "assistant" ? "assistant" : "user",
          content: String(r.message),
        }));
    } catch (e) {
      console.warn("History fetch exception:", e?.message || e);
      historyMessages = [];
    }

    // =============================
    // OPENAI CALL (COM CONTEXTO)
    // =============================
    const openaiMessages = [
      { role: "system", content: systemPromptV2 },
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

    // =============================
    // SAVE CONVERSATION (USER + ASSISTANT)
    // =============================
    await supabase.from("conversations").insert([
      { session_id, role: "user", message },
      { session_id, role: "assistant", message: assistantReply },
    ]);

    return res.status(200).json({
      reply: assistantReply,
      session_id,
      // opcional: útil para debug
      // history_used: historyMessages.length,
    });
  } catch (err) {
    console.error("SERVER ERROR:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
