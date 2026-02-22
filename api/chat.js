export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: message,
        tools: [
          {
            type: "file_search",
            vector_store_ids: [process.env.OPENAI_VECTOR_STORE_ID],
          },
        ],
      }),
    });

    const data = await response.json();

    console.log("FULL RESPONSE:", JSON.stringify(data, null, 2));

    let reply = "Sem resposta do modelo.";

    // Nova forma mais segura de extrair texto
    if (data.output_text) {
      reply = data.output_text;
    } else if (data.output && data.output.length > 0) {
      const messageOutput = data.output.find(o => o.type === "message");
      if (messageOutput && messageOutput.content) {
        const textParts = messageOutput.content
          .filter(item => item.type === "output_text")
          .map(item => item.text);
        if (textParts.length > 0) {
          reply = textParts.join("\n");
        }
      }
    }

    return res.status(200).json({ reply });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Internal server error" });
  }
}
