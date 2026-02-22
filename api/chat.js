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
        input: [
          {
            role: "system",
            content:
              "Você é um especialista em mecânica automotiva. Sempre utilize a base técnica fornecida para responder de forma técnica e estruturada.",
          },
          {
            role: "user",
            content: message,
          },
        ],
        tools: [
          {
            type: "file_search",
            vector_store_ids: [process.env.OPENAI_VECTOR_STORE_ID],
          },
        ],
        tool_choice: "auto"
      }),
    });

    const data = await response.json();

    let reply = data.output_text || "Sem resposta do modelo.";

    return res.status(200).json({ reply });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Internal server error" });
  }
}
