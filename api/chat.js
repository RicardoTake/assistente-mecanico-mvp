export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { message } = req.body || {};
    if (!message) return res.status(400).json({ error: "Message is required" });

    // Env
    const apiKey = process.env.OPENAI_API_KEY;
    const vectorStoreId = process.env.OPENAI_VECTOR_STORE_ID;
    const projectId = process.env.OPENAI_PROJECT_ID;
    const orgId = process.env.OPENAI_ORG_ID;
    const model = process.env.OPENAI_MODEL;
    const instructions = process.env.ASSISTANT_INSTRUCTIONS;

    if (!apiKey || !vectorStoreId || !projectId || !orgId || !model || !instructions) {
      return res.status(500).json({ error: "Missing required environment variables" });
    }

    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "OpenAI-Organization": orgId,
      "OpenAI-Project": projectId,
    };

    // 🔥 chave do streaming (mantém compatível com Lovable)
    const wantStream =
      req.query?.stream === "1" || req.headers.accept?.includes("text/event-stream");

    const payload = {
      model,
      instructions,
      input: message,
      // quando streaming for usado, a OpenAI vai enviar em chunks
      stream: wantStream,
    };

    const upstream = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    if (!upstream.ok) {
      const err = await upstream.json().catch(() => ({}));
      return res.status(500).json({ error: "OpenAI API error", details: err });
    }

    // ✅ MODO 1: SEM STREAM (mantém tudo como está hoje)
    if (!wantStream) {
      const data = await upstream.json();

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
    }

    // ✅ MODO 2: STREAMING (SSE)
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });

    // helper para mandar eventos SSE
    const send = (event, data) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    send("status", { ok: true });

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let fullText = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // A Responses API em streaming envia linhas estilo SSE ("data: ...")
      // Vamos processar linha a linha.
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;

        const dataStr = trimmed.replace(/^data:\s*/, "");
        if (dataStr === "[DONE]") {
          send("done", { reply: fullText });
          res.end();
          return;
        }

        let evt;
        try {
          evt = JSON.parse(dataStr);
        } catch {
          continue;
        }

        // Procurar tokens de texto nos eventos
        // (varia por tipo de evento; este parser é tolerante)
        const deltaText =
          evt?.delta?.text ||
          evt?.response?.output_text ||
          evt?.output_text ||
          evt?.text ||
          "";

        if (deltaText) {
          fullText += deltaText;
          send("delta", { text: deltaText });
        }
      }
    }

    // fallback caso não venha [DONE]
    send("done", { reply: fullText || "Sem resposta do modelo." });
    res.end();
  } catch (error) {
    return res.status(500).json({
      error: "Internal server error",
      details: String(error?.message || error),
    });
  }
}
