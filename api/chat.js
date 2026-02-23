import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

export default async function handler(req, res) {
  console.log("==== REQUEST RECEIVED ====");
  console.log("Method:", req.method);
  console.log("Origin:", req.headers.origin);
  console.log("Body:", req.body);

  const origin = req.headers.origin || "";
  const allowedDomain = (process.env.ALLOWED_ORIGIN || "").trim();

  const isAllowedOrigin =
    (!!origin &&
      !!allowedDomain &&
      (origin.endsWith(`.${allowedDomain}`) ||
        origin.includes(allowedDomain))) ||
    origin.startsWith("http://localhost");

  if (isAllowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Credentials", "true");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  try {
    const {
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY,
      OPENAI_API_KEY,
      MAX_MESSAGES_PER_DAY,
    } = process.env;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !OPENAI_API_KEY) {
      console.error("ENV ERROR");
      return res.status(500).json({ error: "Env error" });
    }

    const body = req.body || {};
    const message = body.message || body.text || body.prompt;
    const session_id = body.session_id || crypto.randomUUID();

    console.log("Parsed message:", message);
    console.log("Session ID:", session_id);

    if (!message) {
      console.error("MESSAGE MISSING");
      return res.status(400).json({ error: "Missing message" });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const openaiResponse = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content:
                "Você é um assistente mecânico especializado em diagnóstico automotivo.",
            },
            { role: "user", content: message },
          ],
        }),
      }
    );

    const data = await openaiResponse.json();
    const assistantReply =
      data?.choices?.[0]?.message?.content ||
      "Erro ao gerar resposta.";

    await supabase.from("conversations").insert([
      { session_id, role: "user", message },
      { session_id, role: "assistant", message: assistantReply },
    ]);

    return res.status(200).json({ reply: assistantReply, session_id });
  } catch (err) {
    console.error("SERVER ERROR:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
