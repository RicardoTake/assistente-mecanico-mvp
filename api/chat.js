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
    const vectorStoreId = process.env.OPENAI_VECTOR_STORE_ID;

    if (!apiKey) return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    if (!vectorStoreId) return res.status(500).json({ error: "Missing OPENAI_VECTOR_STORE_ID" });

    const PROJECT_ID = "proj_NDWTzxiEXJ0cZX5LFGBtf08Y";
    const ORG_ID = "org_XXXXXXXX"; // <-- TROQUE PELO SEU ORG ID

    const baseHeaders = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "OpenAI-Project": PROJECT_ID,
      "OpenAI-Organization": ORG_ID,
    };

    // 1) PROVA: a key consegue enxergar a vector store?
    const vsCheck = await fetch(`https://api.openai.com/v1/vector_stores/${vectorStoreId}`, {
      method: "GET",
      headers: baseHeaders,
    });

    const vsCheckData = await vsCheck.json().catch(() => ({}));

    if (!vsCheck.ok) {
      // Se cair aqui com "not found", não é payload. É escopo (org/projeto).
      return res.status(500).json({
        error: "Vector store not visible to this API key (scope/org/project issue).",
        details: vsCheckData,
        debug: { vectorStoreId, PROJECT_ID, ORG_ID },
      });
    }

    // 2) Agora sim: Responses + file_search (formato oficial atual)
    const payload = {
      model: "gpt-4.1-mini",
      instructions:
        "Você é um assistente mecânico digital. Use prioritariamente a base técnica via file_search. Responda com clareza e destaque níveis de urgência quando aplicável.",
      input: message,
      tools: [{ type: "file_search" }],
      tool_resources: {
        file_search: {
          vector_store_ids: [vectorStoreId],
        },
      },
    };

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: baseHeaders,
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({ error: "OpenAI API error", details: data });
    }

    const reply =
      data.output_text ||
      data?.output?.[0]?.content?.[0]?.text ||
      "Sem resposta do modelo.";

    return res.status(200).json({ reply });
  } catch (error) {
    return res.status(500).json({
      error: "Internal server error",
      details: String(error?.message || error),
    });
  }
}
