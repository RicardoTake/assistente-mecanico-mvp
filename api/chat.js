export default async function handler(req, res) {
  // CORS básico
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { message } = req.body || {};

    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    const vectorStoreId = process.env.OPENAI_VECTOR_STORE_ID;

    if (!apiKey) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY in env vars" });
    }

    if (!vectorStoreId) {
      return res.status(500).json({ error: "Missing OPENAI_VECTOR_STORE_ID in env vars" });
    }

    const payload = {
      model: "gpt-4.1-mini",

      instructions:
        "Você é um assistente mecânico digital. Use prioritariamente a base técnica fornecida via file_search. Responda com clareza, segurança e objetividade. Se houver risco mecânico, destaque o nível de urgência.",

      input: message,

      // Declara a ferramenta
      tools: [
        { type: "file_search" }
      ],

      // Conecta a ferramenta à sua Vector Store
      tool_resources: {
        file_search: {
          vector_store_ids: [vectorStoreId]
        }
      }
    };

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({
        error: "OpenAI API error",
        details: data,
      });
    }

    // Extração segura da resposta
    let reply = "Sem resposta do modelo.";

    if (data.output_text) {
      reply = data.output_text;
    } else if (data.output && data.output.length > 0) {
      const content = data.output[0].content;
      if (content && content.length > 0 && content[0].text) {
        reply = content[0].text;
      }
    }

    return res.status(200).json({
      reply,
      raw: data
    });

  } catch (error) {
    return res.status(500).json({
      error: "Internal server error",
      details: String(error?.message || error),
    });
  }
}
