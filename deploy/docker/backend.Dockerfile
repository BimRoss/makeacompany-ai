FROM golang:1.26-alpine AS builder

WORKDIR /src/backend

COPY backend/go.mod backend/go.sum ./
RUN go mod download

COPY backend ./

RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/makeacompany-ai-backend ./cmd/makeacompany-ai-backend
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/backfill-user-engagement ./cmd/backfill-user-engagement

FROM alpine:3.21

RUN apk add --no-cache ca-certificates

COPY --from=builder /out/makeacompany-ai-backend /usr/local/bin/makeacompany-ai-backend
COPY --from=builder /out/backfill-user-engagement /usr/local/bin/backfill-user-engagement

ENV PORT=8080

EXPOSE 8080

CMD ["makeacompany-ai-backend"]
