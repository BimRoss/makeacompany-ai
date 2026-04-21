package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"makeacompany-ai/backend/internal/app"
)

func main() {
	logger := log.New(os.Stdout, "", log.LstdFlags)
	cfg := app.LoadConfig()
	store, err := app.NewStore(cfg.RedisURL, cfg.CompanyChannelsRedisURL, cfg.SlackOrchestratorCapabilityCatalogURL)
	if err != nil {
		logger.Fatalf("redis: %v", err)
	}
	defer store.Close()
	primary := strings.TrimSpace(cfg.RedisURL)
	cc := strings.TrimSpace(cfg.CompanyChannelsRedisURL)
	if cc != "" && cc != primary {
		logger.Printf("redis: employee-factory keys (company channels, channel knowledge digest) use COMPANY_CHANNELS_REDIS_URL")
	} else {
		logger.Printf("redis: employee-factory keys use primary REDIS_URL (set COMPANY_CHANNELS_REDIS_URL when compose backend must read host :6379)")
	}

	srv, err := app.NewServer(cfg, logger, store)
	if err != nil {
		logger.Fatalf("server: %v", err)
	}

	httpServer := &http.Server{
		Addr:              fmt.Sprintf(":%d", cfg.Port),
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		logger.Printf("makeacompany-ai backend listening on :%d", cfg.Port)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Fatalf("listen: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = httpServer.Shutdown(ctx)
}
