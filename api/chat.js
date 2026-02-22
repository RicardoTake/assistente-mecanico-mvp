export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { message } = req.body || {};

    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    // 🔐 Variáveis de ambiente
    const apiKey = process.env.OPENAI_API_KEY;
    const vectorStoreId = process.env.OPENAI_VECTOR_STORE_ID;
    const projectId = process.env.OPENAI_PROJECT_ID;
    const orgId = process.env.OPENAI_ORG_ID;
    const model = process.env.OPENAI_MODEL;
    const instructions = process.env.ASSISTANT_INSTRUCTIONS;

    // ✅ Validação obrigatória
    if (!apiKey || !vectorStoreId || !projectId || !orgId || !model || !instructions) {
      return res.status(500).json({
        error: "Missing required environment variables"
      });
    }

    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "OpenAI-Organization": orgId,
      "OpenAI-Project": projectId
    };

    const payload = {
      model,
      instructions,
      input: message,
      tools: [
        {
          type: "file_search",
          vector_store_ids: [vectorStoreId]
        }
      ]
    };

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({
        error: "OpenAI API error",
        details: data
      });
    }

    // 🔎 Parsing robusto da resposta
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

    return res.status(200).json({ reply });

  } catch (error) {
    return res.status(500).json({
      error: "Internal server error",
      details: String(error?.message || error)
    });
  }
}
