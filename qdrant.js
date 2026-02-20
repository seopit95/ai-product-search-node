import dotenv from "dotenv";
import { QdrantClient } from "@qdrant/js-client-rest";

dotenv.config();

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Check your .env file.");
}

export const qdrant = new QdrantClient({
  url: process.env.DATABASE_URL,
});
