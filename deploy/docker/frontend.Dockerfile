FROM node:22-alpine AS development

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json next.config.ts postcss.config.mjs ./
COPY src ./src

ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

EXPOSE 3000

CMD ["npm", "run", "dev", "--", "--hostname", "0.0.0.0", "--port", "3000"]

# Builder: full `npm ci` + `next build` (standalone output) — not shipped to the registry.
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json next.config.ts postcss.config.mjs eslint.config.mjs ./
COPY src ./src
COPY public ./public

ARG NEXT_PUBLIC_SITE_URL="https://makeacompany.ai"
ARG NEXT_PUBLIC_BACKEND_API_BASE_URL="https://makeacompany.ai"
ARG NEXT_PUBLIC_GA_MEASUREMENT_ID=""
ARG NEXT_PUBLIC_LINKEDIN_PARTNER_ID=""
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_BACKEND_API_BASE_URL=$NEXT_PUBLIC_BACKEND_API_BASE_URL
ENV NEXT_PUBLIC_GA_MEASUREMENT_ID=$NEXT_PUBLIC_GA_MEASUREMENT_ID
ENV NEXT_PUBLIC_LINKEDIN_PARTNER_ID=$NEXT_PUBLIC_LINKEDIN_PARTNER_ID
ENV NEXT_TELEMETRY_DISABLED=1

# Install devDependencies for the compile; `next build` runs as production.
RUN NODE_ENV=production npm run build

# Production: only standalone server + static assets (smaller layers, fewer Docker Hub upload failures).
FROM node:22-alpine AS production

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
# Next standalone `server.js` (see https://nextjs.org/docs/app/api-reference/config/next-config-js/output)
ENV HOSTNAME=0.0.0.0

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000

CMD ["node", "server.js"]
