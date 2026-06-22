package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"makeacompany-ai/backend/internal/app"
)

func main() {
	logger := log.New(os.Stdout, "", log.LstdFlags)
	cfg := app.LoadConfig()
	if err := cfg.ValidateForProd(); err != nil {
		logger.Fatalf("%v", err)
	}
	store, err := app.NewStore(cfg.RedisURL)
	if err != nil {
		logger.Fatalf("redis: %v", err)
	}
	defer store.Close()

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

	srv.StartStripeWaitlistSnapshotWarmIfMissing()
	srv.StartSyntheticProbe()
	srv.StartPersonalAgentReconciler(context.Background())
	srv.StartLifecycleSweeper(context.Background())
	srv.StartTTFVSweeper(context.Background())
	srv.StartTTFVPRSweeper(context.Background())
	srv.StartDay7CheckinSweeper(context.Background())

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = httpServer.Shutdown(ctx)
}
