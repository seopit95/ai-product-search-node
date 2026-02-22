import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

// 정규화 전에 적용하는 대표 오타/표기 교정 목록
const NORMALIZE_REPLACEMENTS = [
  ["전자렌지", "전자레인지"],
  ["렌지", "레인지"],
];

// 표기 변형 간 일치를 위해 텍스트를 정규화한다
function normalizeText(text) {
  if (!text) return "";
  let out = text;
  NORMALIZE_REPLACEMENTS.forEach(([from, to]) => {
    out = out.replaceAll(from, to);
  });
  return out
    .replace(/&/g, " and ")
    .replace(/[^0-9a-zA-Z가-힣\s]+/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// 브랜드 키는 정규화 후 공백을 제거해 표준 키로 만든다
function normalizeBrandKey(brand) {
  return normalizeText(brand).replace(/\s+/g, "");
}

// 카테고리 키는 정규화 텍스트를 그대로 사용한다
function normalizeCategoryKey(category) {
  return normalizeText(category);
}

// 빈도 → 길이 → 정렬 순으로 대표 표기를 선택한다
function pickCanonical(variantsMap) {
  const entries = Array.from(variantsMap.entries());
  entries.sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    if (b[0].length !== a[0].length) return b[0].length - a[0].length;
    return a[0].localeCompare(b[0], "ko");
  });
  return entries[0]?.[0] || "";
}

// 후보 JSONL에서 정규화 사전을 만든다
async function buildNormalization() {
  const dataDir = path.resolve("data");
  const candidatesPath = path.join(dataDir, "normalization-candidates.jsonl");
  const outputPath = path.join(dataDir, "normalization.json");

  if (!existsSync(candidatesPath)) {
    console.log("[normalization] no candidates file found. Skipping.");
    return;
  }

  const raw = readFileSync(candidatesPath, "utf8");
  const lines = raw.split("\n").map((line) => line.trim()).filter(Boolean);

  const brandVariants = new Map();
  const categoryVariants = new Map();

  lines.forEach((line) => {
    try {
      const item = JSON.parse(line);
      if (item?.type === "brand" && typeof item.value === "string" && item.value.trim()) {
        const raw = item.value.trim();
        const key = normalizeBrandKey(raw);
        if (!key) return;
        if (!brandVariants.has(key)) brandVariants.set(key, new Map());
        const bucket = brandVariants.get(key);
        bucket.set(raw, (bucket.get(raw) || 0) + 1);
      }
      if (item?.type === "category" && typeof item.value === "string" && item.value.trim()) {
        const raw = item.value.trim();
        const key = normalizeCategoryKey(raw);
        if (!key) return;
        if (!categoryVariants.has(key)) categoryVariants.set(key, new Map());
        const bucket = categoryVariants.get(key);
        bucket.set(raw, (bucket.get(raw) || 0) + 1);
      }
    } catch {
      // skip invalid lines
    }
  });

  const brand_alias = {};
  const category_alias = {};
  const brand_synonyms = {};
  const category_synonyms = {};

  const brands = [];
  brandVariants.forEach((variantsMap, key) => {
    const canonical = pickCanonical(variantsMap);
    if (!canonical) return;
    brand_alias[key] = canonical;
    brands.push(canonical);

    const synonyms = Array.from(variantsMap.keys())
      .filter((v) => v !== canonical)
      .sort((a, b) => (variantsMap.get(b) || 0) - (variantsMap.get(a) || 0));
    if (synonyms.length) brand_synonyms[canonical] = synonyms;
  });

  const categories = [];
  categoryVariants.forEach((variantsMap, key) => {
    const canonical = pickCanonical(variantsMap);
    if (!canonical) return;
    category_alias[key] = canonical;
    categories.push(canonical);

    const synonyms = Array.from(variantsMap.keys())
      .filter((v) => v !== canonical)
      .sort((a, b) => (variantsMap.get(b) || 0) - (variantsMap.get(a) || 0));
    if (synonyms.length) category_synonyms[canonical] = synonyms;
  });

  brands.sort((a, b) => a.localeCompare(b, "ko"));
  categories.sort((a, b) => a.localeCompare(b, "ko"));

  const output = {
    generated_at: new Date().toISOString(),
    brands,
    categories,
    brand_alias,
    category_alias,
    brand_synonyms,
    category_synonyms,
  };

  await mkdir(dataDir, { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(`[normalization] generated: ${outputPath}`);
  console.log(`[normalization] brands=${brands.length}, categories=${categories.length}`);
}

buildNormalization().catch((error) => {
  console.error("[normalization] failed", error);
  process.exit(1);
});
