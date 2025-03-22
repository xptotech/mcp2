FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json* ./

# 개발 의존성을 포함하여 모든 의존성 설치 (TypeScript 타입 정의 포함)
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

# TypeScript 컴파일
RUN npx tsc

# 개발 환경으로 설정
ENV NODE_ENV=development

CMD ["node", "dist/index.js"]
