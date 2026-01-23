// insertPoints.js
import { qdrant } from "./qdrant.js";

async function insertPoints() {
  await qdrant.upsert("test_products", {
    points: [
      {
        id: 1,
        vector: [0.9, 0.1, 0.1],
        payload: { text: "빨간 운동화" }
      },
      {
        id: 2,
        vector: [0.85, 0.15, 0.1],
        payload: { text: "레드 스니커즈" }
      },
      {
        id: 3,
        vector: [0.1, 0.9, 0.1],
        payload: { text: "파란 셔츠" }
      }
    ]
  });

  console.log("포인트 저장 완료");
}

insertPoints();