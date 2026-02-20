import dotenv from "dotenv";
import OpenAI from "openai";
import { qdrant } from "./qdrant.js";
import { buildSparseVector } from "./searchUtils.js";

dotenv.config();

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const COLLECTION_NAME = "product_detail_images";
const DENSE_MODEL = "text-embedding-3-small";
const VLM_MODEL = "gpt-4.1-mini";

// 예시 이미지 URL (원하는 URL로 교체 가능)
const imageUrl = "https://locknlock2.cdn-nhncommerce.com/data/editor/goods/HFL101_8.jpg";

function buildExtractionSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      product_name: { type: "string" },
      brand: { type: "string" },
      category: { type: "string" },
      summary: { type: "string" },
      raw_text: { type: "string" },
      claims: { type: "array", items: { type: "string" } },
      specs: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            value: { type: "string" },
          },
          required: ["name", "value"],
        },
      },
      size_table: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: true,
          properties: {
            size: { type: "string" },
          },
          required: ["size"],
        },
      },
      shipping: { type: "array", items: { type: "string" } },
      promo: { type: "array", items: { type: "string" } },
      warnings: { type: "array", items: { type: "string" } },
      price_texts: { type: "array", items: { type: "string" } },
      tags: { type: "array", items: { type: "string" } },
      language: { type: "string" },
    },
    required: [
      "product_name",
      "brand",
      "category",
      "summary",
      "raw_text",
      "claims",
      "specs",
      "size_table",
      "shipping",
      "promo",
      "warnings",
      "price_texts",
      "tags",
      "language",
    ],
  };
}

function extractJsonFromResponse(response) {
  if (response?.output_parsed) return response.output_parsed;

  const text = response?.output_text;
  if (typeof text === "string" && text.trim()) {
    return JSON.parse(text);
  }

  const output = response?.output;
  if (Array.isArray(output)) {
    for (const item of output) {
      const content = item?.content;
      if (!Array.isArray(content)) continue;
      for (const part of content) {
        if (part?.parsed) return part.parsed;
        if (typeof part?.text === "string" && part.text.trim()) {
          return JSON.parse(part.text);
        }
      }
    }
  }

  throw new Error("VLM 응답에서 JSON을 파싱할 수 없습니다.");
}

async function extractProductDataFromImage(imageUrlInput) {
  const instructions = `
너는 쇼핑몰 상품 상세 이미지 OCR/구조화 추출기다.
반드시 JSON만 출력한다.
규칙:
- 이미지에서 보이는 정보만 추출한다. 추측 금지.
- 문자열이 없으면 빈 문자열, 목록이 없으면 빈 배열.
- specs는 핵심 스펙(용량/재질/구성/사이즈/원산지/제조사 등)을 name-value로 정리.
- shipping/promo/warnings/claims는 성격에 맞게 분류.
- tags는 검색에 유의미한 키워드 중심으로 5~20개.
  `.trim();

  const response = await client.responses.create({
    model: VLM_MODEL,
    instructions,
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: "이 상품상세 이미지를 구조화해줘." },
          { type: "input_image", image_url: imageUrlInput, detail: "high" },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "ProductDetailImageExtraction",
        schema: buildExtractionSchema(),
      },
    },
  });

  return extractJsonFromResponse(response);
}

function buildSearchableDocument(extracted, imageUrlInput) {
  const specsText = extracted.specs.map((s) => `${s.name}: ${s.value}`).join(" | ");
  const sizeText = extracted.size_table.map((row) => JSON.stringify(row)).join(" | ");

  return `
상품명: ${extracted.product_name}
브랜드: ${extracted.brand}
카테고리: ${extracted.category}
요약: ${extracted.summary}
클레임: ${extracted.claims.join(" ")}
스펙: ${specsText}
사이즈표: ${sizeText}
배송: ${extracted.shipping.join(" ")}
프로모션: ${extracted.promo.join(" ")}
주의사항: ${extracted.warnings.join(" ")}
가격문구: ${extracted.price_texts.join(" ")}
태그: ${extracted.tags.join(" ")}
원문텍스트: ${extracted.raw_text}
이미지URL: ${imageUrlInput}
  `.trim();
}

async function ensureCollection() {
  try {
    await qdrant.createCollection(COLLECTION_NAME, {
      vectors: {
        dense: {
          size: 1536,
          distance: "Cosine",
        },
      },
      sparse_vectors: {
        sparse: {},
      },
    });
    console.log(`[qdrant] 컬렉션 생성: ${COLLECTION_NAME}`);
  } catch (error) {
    const message = String(error?.message || "");
    if (message.includes("already exists") || message.includes("exists") || error?.status === 409) {
      console.log(`[qdrant] 기존 컬렉션 사용: ${COLLECTION_NAME}`);
      return;
    }
    throw error;
  }
}

function toPayload(extracted, imageUrlInput, searchableText) {
  return {
    image_url: imageUrlInput,
    product_name: extracted.product_name,
    brand: extracted.brand,
    category: extracted.category,
    summary: extracted.summary,
    raw_text: extracted.raw_text,
    claims: extracted.claims,
    specs: extracted.specs,
    size_table: extracted.size_table,
    shipping: extracted.shipping,
    promo: extracted.promo,
    warnings: extracted.warnings,
    price_texts: extracted.price_texts,
    tags: extracted.tags,
    language: extracted.language,
    searchable_text: searchableText,
    created_at: new Date().toISOString(),
  };
}

async function saveToVectorDb({ imageUrlInput, extracted, searchableText }) {
  const embedding = await client.embeddings.create({
    model: DENSE_MODEL,
    input: searchableText,
  });

  const dense = embedding.data[0].embedding;
  const sparse = buildSparseVector(searchableText);
  const payload = toPayload(extracted, imageUrlInput, searchableText);

  const point = {
    id: `${Date.now()}-${Math.floor(Math.random() * 1e9)}`,
    vector: {
      dense,
      sparse,
    },
    payload,
  };

  await qdrant.upsert(COLLECTION_NAME, {
    points: [point],
  });

  return {
    pointId: point.id,
    usage: embedding.usage,
  };
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY가 설정되지 않았습니다.");
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL이 설정되지 않았습니다.");
  }

  await ensureCollection();

  const extracted = await extractProductDataFromImage(imageUrl);
  const searchableText = buildSearchableDocument(extracted, imageUrl);

  const saved = await saveToVectorDb({
    imageUrlInput: imageUrl,
    extracted,
    searchableText,
  });

  console.log("[extract result]");
  console.dir(extracted, { depth: null });

  console.log("[saved]");
  console.log({ collection: COLLECTION_NAME, pointId: saved.pointId, embeddingUsage: saved.usage });
}

main().catch((error) => {
  console.error("[decode failed]", error);
  if (error?.cause) {
    console.error("[decode failed cause]", error.cause);
  }
  process.exit(1);
});
