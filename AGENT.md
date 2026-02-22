# AGENT 참고 메모

이 파일은 향후 수정/개발 시 참고할 기준을 정리한 문서입니다.

## 검색 아키텍처
- Qdrant `query` + `fusion: "rrf"` 하이브리드 검색 사용.
- named vectors:
  - `dense`: OpenAI 임베딩 (text-embedding-3-small, 1536)
  - `sparse`: 키워드 기반 스파스 벡터
- 필터는 엄격 → 완화 순으로 적용.

## 쿼리 정규화/확장
- 브랜드/카테고리 표준화 후 필터 적용.
- 동의어/별칭 확장은 쿼리 시점에만 수행.
- 저장 데이터는 가능한 깨끗하게 유지.

## 한국어 토큰화
- `open-korean-text`로 정규화/토큰화/어간 추출.
- 라이브러리 실패 시 기본 토큰화로 폴백.

## 인덱싱 규칙
- 문서 텍스트 구성:
  - name, brand, category, price, description, tags
- dense + sparse 벡터를 함께 저장.

## Qdrant 스키마
- 컬렉션 `test_products`:
  - `dense` (Cosine, size 1536)
  - `sparse` (sparse vector enabled)

## 운영 체크리스트
- 스키마 변경 시:
  - `node createCollection.js`
  - `node insertPoints.js`
- 의존성 변경 시:
  - `npm install`

## 코드 구조
- 검색 로직은 `searchUtils.js`에 집중.
- 서버 흐름은 `server.js`에서 최소한으로 유지.
- 쿼리 확장은 저장 단계가 아닌 조회 단계에서 처리.
