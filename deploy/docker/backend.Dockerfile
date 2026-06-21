FROM golang:1.26-alpine AS builder

WORKDIR /src/backend

COPY backend/go.mod backend/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod,id=go-mod \
    --mount=type=cache,target=/root/.cache/go-build,id=go-build \
    go mod download

COPY backend ./

RUN --mount=type=cache,target=/go/pkg/mod,id=go-mod \
    --mount=type=cache,target=/root/.cache/go-build,id=go-build \
    CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o /out/makeacompany-ai-backend ./cmd/makeacompany-ai-backend && \
    CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o /out/backfill-user-engagement ./cmd/backfill-user-engagement

FROM alpine:3.21

RUN apk add --no-cache ca-certificates

COPY --from=builder /out/makeacompany-ai-backend /usr/local/bin/makeacompany-ai-backend
COPY --from=builder /out/backfill-user-engagement /usr/local/bin/backfill-user-engagement

ENV PORT=8080

EXPOSE 8080

CMD ["makeacompany-ai-backend"]
