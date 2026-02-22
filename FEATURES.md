# 프로젝트 기능 요약

이 문서는 주요 기능과 실행 흐름, 파일별 역할을 정리한 연구 일지용 요약입니다.

## 기능별 설명

1. 이미지 OCR + 구조화(상품 상세 이미지)
- 목적: 이미지에서 텍스트를 추출하고, 검색에 쓸 구조화 데이터를 생성
- 흐름:
  1) Google Vision API로 OCR 수행
  2) OCR 텍스트를 OpenAI 모델로 구조화(JSON)
  3) 구조화 결과를 포인트 payload에 저장
- 실행 위치: `insertPoints.js`

2. 벡터 생성 및 Qdrant 업서트
- 목적: 상품 텍스트를 dense/sparse 벡터로 변환해 검색 가능한 형태로 저장
- 흐름:
  1) 상품 문서 텍스트 생성
  2) OpenAI Embedding으로 dense 벡터 생성
  3) 해시 기반 sparse 벡터 생성
  4) Qdrant에 포인트 업서트
- 실행 위치: `insertPoints.js`

3. 검색(하이브리드: dense + sparse)
- 목적: 의미 검색 + 키워드 검색을 결합해 정확도/재현율 개선
- 흐름:
  1) 사용자 쿼리 분석(의도/필터 추출)
  2) 쿼리 텍스트 생성 및 임베딩
  3) sparse 벡터 생성
  4) Qdrant 하이브리드 검색 수행
- 실행 위치: `server.js`

4. 정규화 자동화(브랜드/카테고리)
- 목적: 브랜드/카테고리 표기 변형을 자동 수집하고 표준화
- 흐름:
  1) 인서트 시 후보(브랜드/카테고리) JSONL로 누적
  2) 배치 실행 시 후보를 집계해 정규화 사전 생성
  3) 검색 시 자동 생성된 사전 우선 사용
- 실행 위치: `insertPoints.js`, `scripts/buildNormalization.js`, `searchUtils.js`

## 실행 방법

1. 벡터 인서트
```
npm run vectorDev
```

2. 정규화 사전 생성(배치)
```
npm run buildNormalization
```

3. 서버 실행
```
npm run start
```

## 파일별 역할

- `server.js`
  - 검색 API 서버
  - 쿼리 분석, 임베딩 생성, Qdrant 검색 수행

- `insertPoints.js`
  - OCR → 구조화 → 벡터 생성 → Qdrant 업서트
  - 정규화 후보 수집

- `searchUtils.js`
  - 텍스트 정규화/토큰화
  - sparse 벡터 생성
  - 쿼리/문서 텍스트 생성
  - 브랜드/카테고리 표준화

- `visionOcr.js`
  - Google Cloud Vision OCR 래퍼

- `scripts/buildNormalization.js`
  - 후보 데이터로 정규화 사전 생성

- `qdrant.js`
  - Qdrant 클라이언트 설정

- `dummyData.js`
  - 테스트용 상품 데이터

- `package.json`
  - 스크립트 및 의존성 정의

- `public/index.js`
  - 프론트엔드 데모용 스크립트

- `FEATURES.md`
  - 기능/실행/파일 설명 문서(현재 파일)
