FROM golang:1.23.4-alpine AS builder

WORKDIR /src/backend

COPY backend/go.mod backend/go.sum ./
RUN go mod download

COPY backend ./

RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/makeacompany-ai-backend ./cmd/makeacompany-ai-backend

FROM alpine:3.21

RUN apk add --no-cache ca-certificates

COPY --from=builder /out/makeacompany-ai-backend /usr/local/bin/makeacompany-ai-backend

ENV PORT=8080

EXPOSE 8080

CMD ["makeacompany-ai-backend"]
