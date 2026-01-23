// insertPoints.js
import { qdrant } from "./qdrant.js";
import { dummyData } from "./dummyData.js";

async function insertPoints() {
  const embeddingData = buildEmbeddingText(dummyData)
  await qdrant.upsert("test_products", {
    points: embeddingData
  });

  console.log("포인트 저장 완료");
}

function buildEmbeddingText(item) {
  return `
    ${item.brand} ${item.name}
    ${item.description}
    ${item.tags.join(" ")}
  `.trim();
}

insertPoints();