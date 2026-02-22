import { readFileSync } from "node:fs";
import path from "node:path";

const DEFAULT_BRAND_SYNONYMS = {
  "Lock&Lock": ["락앤락", "locknlock", "lock&lock"]
};

const DEFAULT_BRAND_MAP = new Map([
  ["락앤락", "Lock&Lock"],
  ["locknlock", "Lock&Lock"],
  ["lock&lock", "Lock&Lock"],
]);

const DEFAULT_CATEGORY_SYNONYMS = {
  "밀폐용기": ["반찬통", "보관용기", "식재료통", "음식보관"],
  "텀블러": ["보온컵", "보냉컵", "휴대컵", "텀블러컵"],
  "보온병": ["보냉병", "물통", "텀블러"],
  "도시락": ["도시락통", "런치박스", "도시락용기"],
  "물병": ["물통", "보틀"],
  "프라이팬": ["후라이팬", "팬", "코팅팬"],
  "냄비": ["스텐냄비", "조리냄비", "냄비세트"],
  "주방소형가전": ["주방가전", "소형가전", "주방전기"],
};

const DEFAULT_CATEGORY_ALIAS = new Map([
  ["후라이팬", "프라이팬"],
  ["프라이팬", "프라이팬"],
  ["팬", "프라이팬"],
  ["텀블러", "텀블러"],
  ["보온컵", "텀블러"],
  ["보냉컵", "텀블러"],
  ["보온병", "보온병"],
  ["보냉병", "보온병"],
  ["도시락", "도시락"],
  ["도시락통", "도시락"],
  ["물병", "물병"],
  ["물통", "물병"],
  ["밀폐용기", "밀폐용기"],
  ["반찬통", "밀폐용기"],
  ["전기포트", "주방소형가전"],
  ["전기주전자", "주방소형가전"],
  ["토스터기", "주방소형가전"],
  ["에어프라이어", "주방소형가전"],
  ["블렌더", "주방소형가전"],
  ["전기밥솥", "주방소형가전"],
  ["전기그릴", "주방소형가전"],
  ["커피메이커", "주방소형가전"],
  ["멀티쿠커", "주방소형가전"],
  ["전기찜기", "주방소형가전"],
]);

function loadNormalization() {
  try {
    const filePath = path.resolve(process.cwd(), "data", "normalization.json");
    const raw = readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const AUTO_NORMALIZATION = loadNormalization();

const BRAND_SYNONYMS = AUTO_NORMALIZATION?.brand_synonyms || DEFAULT_BRAND_SYNONYMS;
const BRAND_MAP = AUTO_NORMALIZATION?.brand_alias
  ? new Map(Object.entries(AUTO_NORMALIZATION.brand_alias))
  : DEFAULT_BRAND_MAP;
const CATEGORY_SYNONYMS = AUTO_NORMALIZATION?.category_synonyms || DEFAULT_CATEGORY_SYNONYMS;
const CATEGORY_ALIAS = AUTO_NORMALIZATION?.category_alias
  ? new Map(Object.entries(AUTO_NORMALIZATION.category_alias))
  : DEFAULT_CATEGORY_ALIAS;

// 정규화 과정에서 자주 쓰는 오타/표기 교정 목록
const NORMALIZE_REPLACEMENTS = [
  ["전자렌지", "전자레인지"],
  ["렌지", "레인지"],
];

const SPARSE_HASH_BUCKETS = 1 << 18;

// 텍스트를 정규화해서 토큰화가 안정적으로 되도록 한다
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

// 정규화된 텍스트를 토큰으로 분리한다
function tokenize(text) {
  if (!text) return [];
  const tokens = normalizeText(text).split(" ");
  return tokens.filter((t) => {
    if (!t) return false;
    if (/[a-z0-9]/i.test(t) && t.length < 2) return false;
    return true;
  });
}

// 토큰을 해시 버킷 인덱스로 변환한다
function hashToken(token) {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**  문서/쿼리 텍스트를 "키워드 기반 희소 벡터"로 변환
 *
 *   1. 텍스트 정규화
 *       - 소문자화, 특수문자 제거, 공백 정리
 *   2. 토큰화
 *       - 공백 단위로 단어 분리
 *   3. 해싱
 *       - 각 토큰을 고정된 버킷(지금은 2^18개) 인덱스로 변환
 *       - 실제 단어 사전을 쓰는 대신 해시로 "희소 벡터"를 만듦
 *   4. TF 가중치
 *       - 같은 단어가 많이 나오면 가중치 증가
 *   5. L2 정규화
 *       - 벡터 길이를 맞춰서 비교 가능하게 만듦
 * @param text
 * @returns {{indices: *[], values: *[]}}
 */
// 하이브리드 검색용 해시 기반 sparse 벡터를 만든다
function buildSparseVector(text) {
  const tokens = tokenize(text);
  const freq = new Map();
  tokens.forEach((token) => {
    const idx = hashToken(token) % SPARSE_HASH_BUCKETS;
    freq.set(idx, (freq.get(idx) || 0) + 1);
  });

  const indices = [];
  const values = [];
  let norm = 0;
  [...freq.entries()].sort((a, b) => a[0] - b[0]).forEach(([idx, tf]) => {
    const value = 1 + Math.log(tf);
    indices.push(idx);
    values.push(value);
    norm += value * value;
  });

  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < values.length; i += 1) {
    values[i] /= norm;
  }

  return { indices, values };
}

// 브랜드 입력을 alias 테이블로 표준화한다
function normalizeBrand(brand) {
  if (!brand) return null;
  const raw = normalizeText(brand).replace(/\s+/g, "");
  return BRAND_MAP.get(raw) || brand;
}

// 카테고리 입력을 alias 테이블로 표준화한다
function normalizeCategory(category) {
  if (!category) return null;
  const raw = normalizeText(category);
  return CATEGORY_ALIAS.get(raw) || category;
}

// 검색 recall을 높이기 위해 쿼리 텍스트를 동의어로 확장한다
function expandQueryText(text, filters) {
  const baseTokens = new Set(tokenize(text));
  const extras = new Set();

  const addAll = (arr) => {
    if (!arr) return;
    arr.forEach((token) => {
      const t = normalizeText(token);
      if (t && !baseTokens.has(t)) extras.add(t);
    });
  };

  if (filters?.category) {
    addAll(CATEGORY_SYNONYMS[filters.category]);
  }

  if (filters?.brand && BRAND_SYNONYMS[filters.brand]) {
    addAll(BRAND_SYNONYMS[filters.brand]);
  }

  baseTokens.forEach((token) => {
    const normalizedCategory = CATEGORY_ALIAS.get(token);
    if (normalizedCategory) {
      addAll([normalizedCategory, ...(CATEGORY_SYNONYMS[normalizedCategory] || [])]);
    }
  });

  if (!extras.size) return text;
  return `${text} ${Array.from(extras).join(" ")}`.trim();
}

// 임베딩/sparse 검색에 사용할 최종 쿼리 텍스트를 만든다
function buildQueryText({ semantic_query, filters, userMessage }) {
  const base = normalizeText(`${semantic_query} ${userMessage}`);
  const expanded = expandQueryText(base, filters);
  const brand = filters?.brand ? `브랜드: ${filters.brand}` : "";
  const category = filters?.category ? `카테고리: ${filters.category}` : "";
  const price = (filters?.min_price || filters?.max_price)
    ? `가격: ${filters.min_price ?? ""}-${filters.max_price ?? ""}` : "";

  return `
상품명: ${expanded}
설명: ${base}
${brand}
${category}
${price}
  `.trim();
}

// 임베딩/sparse 검색에 사용할 문서 텍스트를 만든다
function buildDocumentText(item) {
  return `
상품명: ${item.payload.name}
브랜드: ${item.payload.brand}
카테고리: ${item.payload.category}
가격: ${item.payload.price}
설명: ${item.payload.description}
태그: ${item.payload.tags.join(" ")}
  `.trim();
}

export {
  buildDocumentText,
  buildQueryText,
  buildSparseVector,
  normalizeBrand,
  normalizeCategory,
  normalizeText,
  tokenize,
};
