import "dotenv/config";
import OpenAI from "openai";
import express from "express";

const app = express();
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// async function embedText(text) {
//   const res = await openai.embeddings.create({
//     model: "text-embedding-3-small", // 1536차원
//     input: text,
//   });
//
//   return res.data[0].embedding;
// }
app.post("/chat", async (req, res) => {
  const { message } = req.body;

  if (!message) {
    return res.status(400).json({ error: "message is required" });
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "너는 쇼핑 도우미 AI야." },
        { role: "user", content: message },
      ],
    });

    res.json({
      answer: response.choices[0].message.content,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});