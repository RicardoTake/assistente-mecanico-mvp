export default async function handler(req, res) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;

    const response = await fetch("https://api.openai.com/v1/vector_stores", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "OpenAI-Organization": "org-mRkCYQqUSq9Cg5JkRbYKB7fK",
        "OpenAI-Project": "proj_NDWTzxiEXJ0cZX5LFGBtf08Y"
      }
    });

    const data = await response.json();
    return res.status(200).json(data);

  } catch (error) {
    return res.status(500).json({
      error: String(error)
    });
  }
}
