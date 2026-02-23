// server.js
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import OpenAI from "openai";
import { qdrant } from "./qdrant.js";
import { chatPolicy } from "./config/chatPolicy.js";
import {
  buildQueryText,
  buildSparseVector,
  normalizeBrand,
  normalizeCategory,
} from "./searchUtils.js";

const app = express();
const PORT = process.env.PORT || 3000;
const sessionStore = new Map();

function getSession(sessionId) {
  if (!sessionId) return null;
  if (!sessionStore.has(sessionId)) {
    sessionStore.set(sessionId, {
      history: [],
      lastResults: [],
      needStage: 0,
      pendingNeedMessage: "",
    });
  }
  return sessionStore.get(sessionId);
}

function pushHistory(session, role, content) {
  if (!session) return;
  session.history.push({ role, content, ts: new Date().toISOString() });
  if (session.history.length > 20) {
    session.history = session.history.slice(-20);
  }
}

function isProductSearchMessage(message) {
  const text = String(message || "").toLowerCase();
  return chatPolicy.intent.productSearchKeywords.some((k) => text.includes(k));
}

function isFollowupEffectQuestion(message) {
  const text = String(message || "").toLowerCase();
  return chatPolicy.intent.followupKeywords.some((k) => text.includes(k));
}

function isFollowupQuestion(message) {
  return isFollowupEffectQuestion(message);
}

function findReferencedProduct(message, results) {
  const text = String(message || "").toLowerCase();
  for (const item of results) {
    const name = String(item?.payload?.name || "").toLowerCase();
    if (name && text.includes(name)) return item;
  }
  return results[0] || null;
}

function buildNeedQuestion(stage) {
  if (stage === 1) return chatPolicy.questions.needStage1;
  return chatPolicy.questions.needStage2;
}

function isNegativeAnswer(text) {
  const raw = String(text || "").toLowerCase().trim();
  return chatPolicy.intent.negativeAnswers.some((v) => raw === v || raw.includes(v));
}

function hasNeedKeywords(text) {
  const raw = String(text || "").toLowerCase();
  return chatPolicy.intent.needKeywords.some((k) => raw.includes(k));
}

function extractCautionKeywords(text) {
  const raw = String(text || "").toLowerCase();
  return chatPolicy.caution.keywords.filter((k) => raw.includes(k));
}

function isHighRiskForProduct(payload, cautionKeywords) {
  if (!cautionKeywords?.length) return false;
  const list = Array.isArray(payload?.not_recommended_for) ? payload.not_recommended_for : [];
  if (!list.length) return false;
  const text = list.join(" ").toLowerCase();
  return cautionKeywords.some((k) => text.includes(k));
}

function buildNoRecommendationMessage(cautionKeywords) {
  const hasPregnancy = cautionKeywords.some((k) => ["임신", "임산부"].includes(k));
  const hasBreastfeeding = cautionKeywords.some((k) => ["수유", "수유부"].includes(k));
  const hasChild = cautionKeywords.some((k) => ["어린이", "소아", "청소년"].includes(k));

  if (hasPregnancy) {
    return chatPolicy.caution.messages.pregnancy;
  }

  if (hasBreastfeeding) {
    return chatPolicy.caution.messages.breastfeeding;
  }

  if (hasChild) {
    return chatPolicy.caution.messages.child;
  }

  return chatPolicy.caution.messages.default;
}

// OpenAI 클라이언트 (서버에서만!)
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.use(cors());
app.use(express.json());

// 정적 파일 제공 (public 폴더)
app.use(express.static("public"));

// 사용자 쿼리를 구조화된 검색 의도로 변환한다.
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

// Qdrant 필터 조건을 구성한다.
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

// dense + sparse 하이브리드 검색을 수행한다.
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

// 검색 요청 처리 엔드포인트
app.post("/chat", async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    const session = getSession(sessionId);
    pushHistory(session, "user", message);

    if (session?.needStage === 1) {
      if (isNegativeAnswer(message)) {
        return res.json({ mode: "answer", text: chatPolicy.responses.needOnlyPrompt });
      }
      session.pendingNeedMessage = message;
      session.needStage = 2;
      return res.json({ mode: "answer", text: buildNeedQuestion(2) });
    }

    if (session?.needStage === 2) {
      const combined = [session.pendingNeedMessage, message].filter(Boolean).join("\n");
      session.needStage = 0;
      session.pendingNeedMessage = "";
      const cautionKeywords = extractCautionKeywords(combined);
      const { content: analyzed, usage } = await analyzeQuery(combined);
      const { semantic_query } = analyzed;
      const filters = {
        ...analyzed.filters,
        brand: normalizeBrand(analyzed.filters?.brand),
        category: normalizeCategory(analyzed.filters?.category),
      };

      const queryText = buildQueryText({ semantic_query, filters, userMessage: combined });
      const embedding = await client.embeddings.create({
        model: "text-embedding-3-small",
        input: queryText,
      });
      const sparseVector = buildSparseVector(queryText);

      const result = await searchQdrant({
        denseVector: embedding.data[0].embedding,
        sparseVector,
        filters,
      });

      if (!result?.length) {
        session.lastResults = [];
        return res.json({
          mode: "answer",
          text: chatPolicy.responses.noResults,
        });
      }

      const safeResults = (result || []).filter((item) => !isHighRiskForProduct(item?.payload, cautionKeywords));
      if (!safeResults.length) {
        session.lastResults = [];
        const text = cautionKeywords.length
          ? buildNoRecommendationMessage(cautionKeywords)
          : chatPolicy.responses.noResults;
        return res.json({
          mode: "answer",
          text,
        });
      }

      if (session) {
        session.lastResults = safeResults || [];
      }
      pushHistory(session, "assistant", `검색 결과 ${safeResults?.length || 0}건`);
      return res.json({
        analyzed,
        result: safeResults,
        usage: embedding.usage
      });
    }

    const hasLastResults = session?.lastResults?.length;
    const isProductIntent = isProductSearchMessage(message);
    const isFollowup = isFollowupQuestion(message);

    if (!isProductIntent || isFollowup) {
      if (isFollowupEffectQuestion(message) && hasLastResults) {
        const target = findReferencedProduct(message, session.lastResults);
        if (!target) {
          return res.json({ mode: "answer", text: chatPolicy.responses.askProductName });
        }

        const payload = target.payload || {};
        const secondary = Array.isArray(payload.secondary_benefits) ? payload.secondary_benefits : [];
        const recommended = Array.isArray(payload.recommended_for) ? payload.recommended_for : [];
        const lines = [];
        lines.push(`"${payload.name || "이 상품"}" 기준으로 추가 효능과 추천 대상 정보를 정리해드릴게요.`);
        if (secondary.length) {
          lines.push(`부수 효능: ${secondary.slice(0, 5).join(", ")}`);
        } else {
          lines.push("부수 효능 정보는 아직 부족해요.");
        }
        if (recommended.length) {
          lines.push(`추천 대상: ${recommended.slice(0, 5).join(", ")}`);
        } else {
          lines.push("추천 대상 정보는 아직 부족해요.");
        }
        const answerText = lines.join("\n");
        pushHistory(session, "assistant", answerText);
        return res.json({ mode: "answer", text: answerText });
      }

      if (isFollowupEffectQuestion(message) && !hasLastResults && isProductIntent) {
        session.needStage = 1;
        session.pendingNeedMessage = message;
        return res.json({ mode: "answer", text: buildNeedQuestion(1) });
      }

      if (isFollowupEffectQuestion(message) && !hasLastResults) {
        return res.json({ mode: "answer", text: chatPolicy.responses.needMissing });
      }

      return res.json({ mode: "answer", text: chatPolicy.responses.recommendPrompt });
    }

    if (isProductSearchMessage(message)) {
      if (hasNeedKeywords(message)) {
        session.needStage = 2;
        session.pendingNeedMessage = message;
        return res.json({ mode: "answer", text: buildNeedQuestion(2) });
      }
      session.needStage = 1;
      session.pendingNeedMessage = message;
      return res.json({ mode: "answer", text: buildNeedQuestion(1) });
    }

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

    if (!result?.length) {
      return res.json({
        mode: "answer",
        text: chatPolicy.responses.noResults,
      });
    }

    if (session) {
      session.lastResults = result || [];
    }
    pushHistory(session, "assistant", `검색 결과 ${result?.length || 0}건`);
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
