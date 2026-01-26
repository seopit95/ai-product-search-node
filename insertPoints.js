// insertPoints.js

import dotenv from "dotenv";
dotenv.config();
import { qdrant } from "./qdrant.js";
import { dummyData } from "./dummyData.js";
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function insertPoints() {
  const texts = dummyData.map(item => buildEmbeddingText(item));

  try {
    const embeddings = await client.embeddings.create({
      model: "text-embedding-3-small",
      input: texts
    });

    // 임베딩 데이터 각 포인트별 vector에 저장
    dummyData.forEach((data, idx) => {
      data.vector = embeddings.data[idx].embedding;
    })
  } catch (e) {
    console.log(e)
  }

  await qdrant.upsert("test_products", {
    points: dummyData
  });

  console.log("포인트 저장 완료");
}

function buildEmbeddingText(item) {
  return `
    상품명: ${item.payload.name}
    브랜드: ${item.payload.brand} 
    설명: ${item.payload.description}
    태그: ${item.payload.tags.join(" ")}
  `.trim();
}

insertPoints();