FROM golang:1.26-alpine AS builder

WORKDIR /src/backend

COPY backend/go.mod backend/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod,id=go-mod \
    --mount=type=cache,target=/root/.cache/go-build,id=go-build \
    go mod download

COPY backend ./

RUN --mount=type=cache,target=/go/pkg/mod,id=go-mod \
    --mount=type=cache,target=/root/.cache/go-build,id=go-build \
    CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o /out/makeacompany-ai-backend ./cmd/makeacompany-ai-backend

FROM alpine:3.21

RUN apk add --no-cache ca-certificates

COPY --from=builder /out/makeacompany-ai-backend /usr/local/bin/makeacompany-ai-backend

ENV PORT=8080

EXPOSE 8080

CMD ["makeacompany-ai-backend"]
