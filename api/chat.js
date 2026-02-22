export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { message } = req.body || {};
    if (!message) return res.status(400).json({ error: "Message is required" });

    const apiKey = process.env.OPENAI_API_KEY;

    // 🔴 IMPORTANTE: ID corrigido com "dd"
    const vectorStoreId = "vs_699a6133ddb481919119b58576db8d19";

    if (!apiKey) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    }

    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "OpenAI-Organization": "org-mRkCYQqUSq9Cg5JkRbYKB7fK",
      "OpenAI-Project": "proj_NDWTzxiEXJ0cZX5LFGBtf08Y"
    };

    const payload = {
      model: "gpt-4.1-mini",
      instructions:
        "Você é um assistente mecânico digital. Use prioritariamente a base técnica via file_search. Responda com clareza e destaque níveis de urgência quando aplicável.",
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

    const reply =
      data.output_text ||
      data?.output?.[0]?.content?.[0]?.text ||
      "Sem resposta do modelo.";

    return res.status(200).json({ reply });

  } catch (error) {
    return res.status(500).json({
      error: "Internal server error",
      details: String(error?.message || error)
    });
  }
}
