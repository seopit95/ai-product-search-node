// search.js
import { qdrant } from "./qdrant.js";

async function search() {
  const result = await qdrant.search("test_products", {
    vector: [0.88, 0.12, 0.1], // "레드 신발" 같은 의미
    limit: 1
  });

  console.log(result);
}

search();