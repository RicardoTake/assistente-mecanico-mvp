export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = req.body || {};
    const messages = body.messages || [];
    const singleMessage = body.message || null;

    const apiKey = process.env.OPENAI_API_KEY;
    const projectId = process.env.OPENAI_PROJECT_ID;
    const orgId = process.env.OPENAI_ORG_ID;
    const model = process.env.OPENAI_MODEL;
    const instructions = process.env.ASSISTANT_INSTRUCTIONS;

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!apiKey || !projectId || !orgId || !model || !instructions) {
      return res.status(500).json({ error: "Missing OpenAI environment variables" });
    }

    // 🔹 Import dinâmico do Supabase
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 🔹 Definir input
    let input;
    if (messages.length > 0) {
      input = messages.slice(-8);
    } else {
      input = singleMessage;
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

    const sessionId = body.session_id || crypto.randomUUID();

    // 🔹 Salvar mensagem do usuário
    if (singleMessage) {
      await supabase.from("conversations").insert({
        session_id: sessionId,
        role: "user",
        message: singleMessage,
      });
    }

    // 🔹 Salvar resposta do assistente
    await supabase.from("conversations").insert({
      session_id: sessionId,
      role: "assistant",
      message: reply,
    });

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
