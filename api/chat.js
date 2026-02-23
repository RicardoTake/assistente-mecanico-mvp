import crypto from "crypto";

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = req.body || {};

    // Lovable pode mandar:
    // - { message: "..." }
    // ou
    // - { messages: [{role, content}, ...] }
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const singleMessage = typeof body.message === "string" ? body.message : null;

    // OpenAI envs
    const apiKey = process.env.OPENAI_API_KEY;
    const projectId = process.env.OPENAI_PROJECT_ID;
    const orgId = process.env.OPENAI_ORG_ID;
    const model = process.env.OPENAI_MODEL;
    const instructions = process.env.ASSISTANT_INSTRUCTIONS;

    // Supabase envs
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!apiKey || !projectId || !orgId || !model || !instructions) {
      return res.status(500).json({ error: "Missing OpenAI environment variables" });
    }

    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({ error: "Missing Supabase environment variables" });
    }

    // Criar client do Supabase (backend-only)
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Definir session_id (mantém histórico)
    const sessionId = typeof body.session_id === "string" ? body.session_id : crypto.randomUUID();

    // Definir input para OpenAI
    // - Se veio messages[], usa as últimas 8 interações
    // - Senão usa message
    let input;
    if (messages.length > 0) {
      input = messages.slice(-8);
    } else {
      input = singleMessage;
    }

    if (!input) {
      return res.status(400).json({ error: "Message is required" });
    }

    // Pegar a última mensagem do usuário para salvar (sempre)
    // Se veio messages[], tenta achar a última role=user
    let userTextToStore = singleMessage;
    if (!userTextToStore && messages.length > 0) {
      const lastUserMsg = [...messages].reverse().find((m) => m?.role === "user");
      // Lovable costuma usar content
      userTextToStore = lastUserMsg?.content || null;
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
      body: JSON.stringify({
        model,
        instructions,
        input,
      }),
    });

    const data = await response.json();
    const responseTime = Date.now() - startTime;

    if (!response.ok) {
      return res.status(500).json({ error: "OpenAI API error", details: data });
    }

    // Parsing do texto final
    let reply = "Sem resposta do modelo.";
    if (data.output && Array.isArray(data.output)) {
      for (const item of data.output) {
        if (item.content && Array.isArray(item.content)) {
          for (const content of item.content) {
            if (content.type === "output_text" && content.text) {
              reply = content.text;
            }
          }
        }
      }
    }

    // --- Logging no Supabase (não pode quebrar o chat se falhar) ---
    try {
      if (userTextToStore) {
        await supabase.from("conversations").insert({
          session_id: sessionId,
          role: "user",
          message: userTextToStore,
          model: model,
        });
      }

      await supabase.from("conversations").insert({
        session_id: sessionId,
        role: "assistant",
        message: reply,
        response_time_ms: responseTime,
        model: model,
      });
    } catch (logErr) {
      // Se o log falhar, não derruba o MVP
      console.error("Supabase log error:", logErr);
    }

    // Resposta pro Lovable
    return res.status(200).json({
      reply,
      session_id: sessionId,
      response_time_ms: responseTime,
    });
  } catch (error) {
    return res.status(500).json({
      error: "Internal server error",
      details: String(error?.message || error),
    });
  }
}
