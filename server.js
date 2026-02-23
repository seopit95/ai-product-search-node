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
  const keywords = ["추천", "찾아", "검색", "어떤 제품", "무슨 제품", "영양제", "상품", "있어", "파는", "구매", "살만한"];
  return keywords.some((k) => text.includes(k));
}

function isFollowupEffectQuestion(message) {
  const text = String(message || "").toLowerCase();
  const keywords = ["효능", "부작용", "주의", "상호작용", "대상", "누가", "먹어도", "먹으면", "필요", "도움"];
  return keywords.some((k) => text.includes(k));
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
  if (stage === 1) {
    return "어떤 목적/증상이 있으신가요? (예: 피로, 면역, 장건강, 혈당, 수면)";
  }
  return "주의하실 점이 있을까요? (임신/수유, 지병, 복용 중인 약, 알레르기, 예산 등)";
}

function isNegativeAnswer(text) {
  const raw = String(text || "").toLowerCase().trim();
  const negatives = ["아니", "아니요", "없어", "없어요", "없음", "괜찮아", "괜찮아요", "무", "무관"];
  return negatives.some((v) => raw === v || raw.includes(v));
}

function hasNeedKeywords(text) {
  const raw = String(text || "").toLowerCase();
  const keywords = ["피로", "면역", "장", "혈당", "혈압", "수면", "눈", "관절", "간", "위", "스트레스", "기억", "집중"];
  return keywords.some((k) => raw.includes(k));
}

function extractCautionKeywords(text) {
  const raw = String(text || "").toLowerCase();
  const keywords = [
    "임신", "수유", "임산부", "수유부",
    "어린이", "소아", "청소년",
    "간질환", "간", "신장", "신장질환",
    "당뇨", "혈당", "고혈압", "심장", "심혈관",
    "항응고", "혈액", "혈전",
    "알레르기", "과민",
    "항생제", "항우울", "스테로이드", "면역억제",
    "약", "복용",
  ];
  return keywords.filter((k) => raw.includes(k));
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
    return [
      "임신 중에는 일부 건강기능식품이 태아에 영향을 줄 수 있어 조금 더 신중하게 확인하는 게 좋아요.",
      "문의하신 성분은 임산부 대상 안전성 근거가 충분하지 않은 편이라",
      "전문의와 상담 후 복용 여부를 결정하시는 것을 권장드립니다.",
    ].join("\n");
  }

  if (hasBreastfeeding) {
    return [
      "수유 중에는 일부 성분이 모유를 통해 전달될 수 있어 조금 더 주의가 필요해요.",
      "문의하신 성분은 수유부 대상 안전성 근거가 충분하지 않을 수 있어",
      "전문의와 상담 후 복용 여부를 결정하시는 것을 권장드립니다.",
    ].join("\n");
  }

  if (hasChild) {
    return [
      "어린이/청소년은 성장 단계라 성분에 대한 민감도가 높을 수 있어요.",
      "문의하신 성분은 해당 연령대 안전성 근거가 충분하지 않을 수 있어",
      "전문의와 상담 후 복용 여부를 결정하시는 것을 권장드립니다.",
    ].join("\n");
  }

  return "주의 대상에 해당하는 성분이 많아 지금은 안전하게 추천드릴 제품이 없어요. 의료 전문가와 상담 후 결정하시는 것을 권장드립니다.";
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
        return res.json({ mode: "answer", text: "원하시는 목적이나 증상을 간단히 알려주시면 그에 맞게 추천드릴게요." });
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
          text: "조건에 맞는 상품을 찾지 못했어요. 목적이나 조건을 조금만 바꿔서 알려주시면 다시 찾아드릴게요.",
        });
      }

      const safeResults = (result || []).filter((item) => !isHighRiskForProduct(item?.payload, cautionKeywords));
      if (!safeResults.length) {
        session.lastResults = [];
        const text = cautionKeywords.length
          ? buildNoRecommendationMessage(cautionKeywords)
          : "조건에 맞는 상품을 찾지 못했어요. 목적이나 조건을 조금만 바꿔서 알려주시면 다시 찾아드릴게요.";
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
          return res.json({ mode: "answer", text: "어떤 상품을 기준으로 설명해드릴까요? 상품명을 알려주시면 도와드릴게요." });
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
        return res.json({ mode: "answer", text: "추천을 원하시면 어떤 목적/증상인지 알려주세요. 그에 맞게 도와드릴게요." });
      }

      return res.json({ mode: "answer", text: "제품 추천을 원하시면 원하는 효능이나 목적을 알려주세요. 그에 맞게 찾아드릴게요." });
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
        text: "조건에 맞는 상품을 찾지 못했어요. 목적이나 조건을 조금만 바꿔서 알려주시면 다시 찾아드릴게요.",
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
