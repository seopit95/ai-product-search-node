// server.js
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import OpenAI from "openai";
import { qdrant } from "./qdrant.js";
import {
  buildQueryText,
  buildSparseVector,
  normalizeBrand,
  normalizeCategory,
} from "./searchUtils.js";

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

사용자의 질문을 분석해서 아래 JSON으로 변환해라.

JSON 스키마:
{
  "semantic_query": string,
  "filters": {
    "max_price": number | null,
    "min_price": number | null,
    "brand": string | null,
    "category": string | null
  },
  "intent": string
}

규칙:
- semantic_query:
  - 사용자가 말한 표현과 의미를 최대한 유지한다
  - 검색에 도움이 되도록 의미를 자연스럽게 보강한다
  - 반드시 한 문장일 필요는 없다
  - 사용자가 언급하지 않은 정보는 억지로 추가하지 마라
  - 질문에서 사용자가 원하는 니즈에 맞는 키워드를 우선적으로 고려해 상품을 조회해야한다.

- filters:
  - 확실한 조건만 추출
  - 애매하면 null
- intent:
  - 사용자의 실제 목적을 한 문장으로 요약한다

JSON 외의 말은 절대 출력하지 마라.

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

  return { content: JSON.parse(response.choices[0].message.content), usage: response.usage };
}

function buildQdrantFilter(filters) {
  const must = [];

  if (filters.brand) {
    must.push({
      key: "brand",
      match: { value: filters.brand }
    });
  }

  if (filters.category) {
    must.push({
      key: "category",
      match: { value: filters.category }
    });
  }

  if (filters.min_price || filters.max_price) {
    must.push({
      key: "price",
      range: {
        gte: filters.min_price ?? undefined,
        lte: filters.max_price ?? undefined,
      }
    });
  }

  return must.length > 0 ? { must } : undefined;
}

async function searchQdrant({ denseVector, sparseVector, filters }) {
  const base = {
    limit: 5,
    score_threshold: 0.25,
    with_payload: true,
  };

  const hasSparse = sparseVector?.indices?.length > 0;
  const makePrefetch = (filter) => ([
    {
      query: { nearest: denseVector },
      using: "dense",
      limit: 50,
      filter,
    },
    ...(hasSparse ? [{
      query: { nearest: sparseVector },
      using: "sparse",
      limit: 50,
      filter,
    }] : []),
  ]);

  const runHybrid = async (filter) => qdrant.query("test_products", {
    prefetch: makePrefetch(filter),
    query: { fusion: "rrf" },
    limit: base.limit,
    score_threshold: base.score_threshold,
    with_payload: true,
    filter,
  });

  const strictFilter = buildQdrantFilter(filters);
  const resultStrict = await runHybrid(strictFilter);
  if (resultStrict?.length) return resultStrict;

  const relaxed = { ...filters, brand: null };
  const resultRelaxBrand = await runHybrid(buildQdrantFilter(relaxed));
  if (resultRelaxBrand?.length) return resultRelaxBrand;

  const relaxedCategory = { ...filters, category: null, brand: null };
  const resultRelaxCategory = await runHybrid(buildQdrantFilter(relaxedCategory));
  if (resultRelaxCategory?.length) return resultRelaxCategory;

  return runHybrid(undefined);
}

app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;
    // 1. 니즈 분석
    const { content: analyzed, usage } = await analyzeQuery(message);
    const { semantic_query } = analyzed;
    const filters = {
      ...analyzed.filters,
      brand: normalizeBrand(analyzed.filters?.brand),
      category: normalizeCategory(analyzed.filters?.category),
    };

    // 2. 임베딩 (1회)
    const queryText = buildQueryText({ semantic_query, filters, userMessage: message });
    const embedding = await client.embeddings.create({
      model: "text-embedding-3-small",
      input: queryText,
    });
    const sparseVector = buildSparseVector(queryText);

    // 3. Qdrant 검색
    const result = await searchQdrant({
      denseVector: embedding.data[0].embedding,
      sparseVector,
      filters,
    });

    res.json({
      analyzed,
      result: result,
      usage: embedding.usage
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "검색 실패" });
  }
});

// 임베딩

// app.post("/embedding", async (req, res) => {
//   try {
//     console.log(req)
//     return;
//     const embeddings = await openai.embeddings.create({
//       model: "text-embedding-3-small",
//       input: texts
//     });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: "AI 호출 실패" });
//   }
// });

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
