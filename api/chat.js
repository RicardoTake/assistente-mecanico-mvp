export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = req.body || {};
    const singleMessage = body.message;
    const messages = Array.isArray(body.messages) ? body.messages : null;

    if (!singleMessage && (!messages || messages.length === 0)) {
      return res.status(400).json({ error: "Message or messages[] is required" });
    }

    // 🔐 Variáveis de ambiente
    const apiKey = process.env.OPENAI_API_KEY;
    const projectId = process.env.OPENAI_PROJECT_ID;
    const orgId = process.env.OPENAI_ORG_ID;
    const model = process.env.OPENAI_MODEL;
    const instructions = process.env.ASSISTANT_INSTRUCTIONS;

    if (!apiKey || !projectId || !orgId || !model || !instructions) {
      return res.status(500).json({ error: "Missing required environment variables" });
    }

    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "OpenAI-Organization": orgId,
      "OpenAI-Project": projectId,
    };

    // ✅ Monta o input de conversa (memória simples)
    // Recomendação MVP: mandar só as últimas 8 mensagens para manter custo/latência sob controle.
    const MAX_TURNS = 8;

    let input;
    if (messages) {
      const clipped = messages.slice(-MAX_TURNS).map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: String(m.content ?? ""),
      }));
      input = clipped;
    } else {
      input = String(singleMessage);
    }

    const payload = {
      model,
      instructions,
      input,
    };

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({ error: "OpenAI API error", details: data });
    }

    // 🔎 Parsing robusto
    let reply = "Sem resposta do modelo.";
    if (data.output && Array.isArray(data.output)) {
      for (const item of data.output) {
        if (item.content && Array.isArray(item.content)) {
          for (const content of item.content) {
            if (content.type === "output_text" && content.text) reply = content.text;
          }
        }
      }
    }

    return res.status(200).json({ reply });
  } catch (error) {
    return res.status(500).json({
      error: "Internal server error",
      details: String(error?.message || error),
    });
  }
}
