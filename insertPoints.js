// insertPoints.js

import dotenv from "dotenv";
dotenv.config();
import { qdrant } from "./qdrant.js";
import { dummyData } from "./dummyData.js";
import OpenAI from "openai";
import { buildDocumentText, buildSparseVector } from "./searchUtils.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const COLLECTION_NAME = process.env.COLLECTION_NAME || "test_products";
const CACHE_DIR = path.resolve(".cache");
const CACHE_FILE = path.join(CACHE_DIR, "image-extraction-cache.json");
const IMAGE_VLM_MODEL = "gpt-4.1-mini";
const EMBEDDING_MODEL = "text-embedding-3-small";
const IMAGE_EXTRACTION_CONCURRENCY = 3;

function getImageUrl(point) {
  return (
    point?.payload?.image_url
    || point?.payload?.imageUrl
    || point?.payload?.detail_image_url
    || null
  );
}

async function loadExtractionCache() {
  try {
    const raw = await readFile(CACHE_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveExtractionCache(cache) {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(CACHE_FILE, JSON.stringify(cache, null, 2), "utf8");
}

function extractJsonFromResponse(response) {
  if (response?.output_parsed) return response.output_parsed;
  if (typeof response?.output_text === "string" && response.output_text.trim()) {
    return JSON.parse(response.output_text);
  }

  const output = response?.output;
  if (Array.isArray(output)) {
    for (const item of output) {
      if (!Array.isArray(item?.content)) continue;
      for (const part of item.content) {
        if (part?.parsed) return part.parsed;
        if (typeof part?.text === "string" && part.text.trim()) return JSON.parse(part.text);
      }
    }
  }
  throw new Error("Failed to parse VLM JSON response");
}

async function extractImageData(imageUrl) {
  const response = await client.responses.create({
    model: IMAGE_VLM_MODEL,
    instructions: [
      "너는 상품 상세 이미지 정보 추출기다.",
      "이미지에 보이는 내용만 JSON으로 구조화한다.",
      "추측 금지, 없으면 빈 문자열/빈 배열로 반환한다.",
      "검색 향상을 위한 키워드(tags), 핵심 클레임(claims), 스펙(specs), 요약(summary), 원문(raw_text)를 포함한다.",
    ].join("\n"),
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: "상품 상세 이미지를 검색용 구조 데이터로 추출해줘." },
          { type: "input_image", image_url: imageUrl, detail: "high" },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "ImageProductExtraction",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            summary: { type: "string" },
            raw_text: { type: "string" },
            claims: { type: "array", items: { type: "string" } },
            tags: { type: "array", items: { type: "string" } },
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
          },
          required: ["summary", "raw_text", "claims", "tags", "specs"],
        },
      },
    },
  });

  return extractJsonFromResponse(response);
}

function imageDataToText(imageData) {
  if (!imageData) return "";
  const specs = Array.isArray(imageData.specs)
    ? imageData.specs.map((s) => `${s.name}: ${s.value}`).join(" | ")
    : "";

  return [
    `이미지요약: ${imageData.summary || ""}`,
    `이미지클레임: ${(imageData.claims || []).join(" ")}`,
    `이미지스펙: ${specs}`,
    `이미지태그: ${(imageData.tags || []).join(" ")}`,
    `이미지원문: ${imageData.raw_text || ""}`,
  ].join("\n");
}

function mergeTags(baseTags, imageData) {
  const base = Array.isArray(baseTags) ? baseTags : [];
  const imageTags = Array.isArray(imageData?.tags) ? imageData.tags : [];
  const claims = Array.isArray(imageData?.claims) ? imageData.claims : [];
  return Array.from(
    new Set(
      [...base, ...imageTags, ...claims]
        .map((v) => (typeof v === "string" ? v.trim() : ""))
        .filter(Boolean),
    ),
  );
}

async function mapWithConcurrency(items, concurrency, task) {
  const out = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await task(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, () => worker()),
  );

  return out;
}

async function enrichWithImageData(points) {
  const cache = await loadExtractionCache();
  let cacheChanged = false;

  const enriched = await mapWithConcurrency(points, IMAGE_EXTRACTION_CONCURRENCY, async (point, index) => {
    if (index !== 0) {
      if (!point?.payload) return point;
      const { image_url, imageUrl, detail_image_url, image_extracted, ...restPayload } = point.payload;
      return {
        ...point,
        payload: restPayload,
      };
    }

    const imageUrl = getImageUrl(point);
    if (!imageUrl) return point;

    let imageData = cache[imageUrl];
    if (!imageData) {
      try {
        imageData = await extractImageData(imageUrl);
        cache[imageUrl] = imageData;
        cacheChanged = true;
        console.log(`[image extracted] ${imageUrl}`);
      } catch (error) {
        console.warn(`[image extract skipped] ${imageUrl}`);
        console.warn(error?.message || error);
        return point;
      }
    } else {
      console.log(`[image cache hit] ${imageUrl}`);
    }

    return {
      ...point,
      payload: {
        ...point.payload,
        tags: mergeTags(point.payload?.tags, imageData),
        image_summary: imageData.summary || "",
        image_claims: Array.isArray(imageData.claims) ? imageData.claims : [],
        image_specs: Array.isArray(imageData.specs) ? imageData.specs : [],
        image_raw_text: imageData.raw_text || "",
        image_url: imageUrl,
        image_extracted: imageData,
      },
    };
  });

  if (cacheChanged) {
    await saveExtractionCache(cache);
  }

  return enriched;
}

async function insertPoints() {
  console.log(`[start] preparing points for collection=${COLLECTION_NAME}`);
  const sourcePoints = await enrichWithImageData(dummyData);

  const texts = sourcePoints.map((item) => {
    const baseText = buildDocumentText(item);
    const imageText = imageDataToText(item.payload?.image_extracted);
    return [baseText, imageText].filter(Boolean).join("\n");
  });

  let pointsToUpsert = sourcePoints;

  try {
    console.log(`[embedding] creating dense vectors for ${texts.length} points`);
    const embeddings = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: texts,
    });

    pointsToUpsert = sourcePoints.map((data, idx) => {
      const dense = embeddings.data[idx].embedding;
      const sparse = buildSparseVector(texts[idx]);
      return {
        ...data,
        vector: { dense, sparse },
      };
    });
  } catch (e) {
    console.error("[embedding failed]", e);
    if (e?.cause) console.error("[embedding failed cause]", e.cause);
    throw e;
  }

  console.log("[qdrant] upserting points");
  await qdrant.upsert(COLLECTION_NAME, {
    points: pointsToUpsert,
  });

  console.log(`포인트 저장 완료: collection=${COLLECTION_NAME}, count=${pointsToUpsert.length}`);
}

insertPoints().catch((error) => {
  console.error("[insertPoints failed]", error);
  if (error?.cause) console.error("[insertPoints failed cause]", error.cause);
  process.exit(1);
});
