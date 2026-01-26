// server.js
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import OpenAI from "openai";
import { qdrant } from "./qdrant.js";

const app = express();
const PORT = process.env.PORT || 3000;

// OpenAI 클라이언트 (서버에서만!)
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.use(cors());
app.use(express.json());

// 정적 파일 제공 (public 폴더)
app.use(express.static("public"));

async function analyzeQuery(userMessage) {
  const prompt = `
너는 쇼핑몰 검색엔진의 쿼리 분석기다.

사용자의 질문을 보고 아래 JSON 형태로 변환해라.
반드시 아래 JSON 스키마를 따라라:
{
  "search_text": string,
  "filters": {
    "max_price": number | null,
    "min_price": number | null,
    "brand": string | null,
    "category": string | null
  },
  "intent": string
}

규칙:
- search_text: 벡터 검색에 사용할 자연어 문장 (1문장)
- filters: 가격, 브랜드, 카테고리 등 명확한 조건
- must_not: 제외 조건 (없으면 빈 배열)
- intent: 사용 목적 요약

JSON 외의 다른 말은 절대 하지 마라.

사용자 질문:
"${userMessage}"
`;

  const response = await client.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      { role: "system", content: "너는 검색 쿼리 분석기다." },
      { role: "user", content: prompt },
    ],
    temperature: 0,
  });

  return JSON.parse(response.choices[0].message.content);
}

function buildQdrantFilter(filters) {
  const must = [];

  if (filters.max_price) {
    must.push({
      key: "price",
      range: { lte: filters.max_price },
    });
  }

  if (filters.brand) {
    must.push({
      key: "brand",
      match: { value: filters.brand },
    });
  }

  if (filters.category) {
    must.push({
      key: "category",
      match: { value: filters.category },
    });
  }

  return must.length ? { must } : undefined;
}

app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;

    // 1. 니즈 분석
    const analyzed = await analyzeQuery(message);
    const { search_text, filters } = analyzed;

    // 2. 임베딩 (1회)
    const embedding = await client.embeddings.create({
      model: "text-embedding-3-small",
      input: search_text,
    });

    // 3. Qdrant 검색
    const result = await qdrant.search("test_products", {
      vector: embedding.data[0].embedding,
      limit: 10,
      filter: buildQdrantFilter(filters),
    });

    res.json({
      analyzed,
      result,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "검색 실패" });
  }
});

// 임베딩

app.post("/embedding", async (req, res) => {
  try {
    console.log(req)
    return;
    const embeddings = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: texts
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "AI 호출 실패" });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});