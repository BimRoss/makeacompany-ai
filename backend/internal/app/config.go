package app

import (
	"os"
	"strconv"
	"strings"
)

type Config struct {
	Port                    int
	RedisURL                string
	AppBaseURL              string
	StripeSecretKey         string
	StripeWebhookSecret     string
	StripePriceWaitlistTest string
	StripePriceWaitlistLive string
}

func LoadConfig() Config {
	return Config{
		Port:                    envInt("PORT", 8080),
		RedisURL:                envString("REDIS_URL", "redis://localhost:6379/0"),
		AppBaseURL:              strings.TrimRight(envString("APP_BASE_URL", "http://localhost:3000"), "/"),
		StripeSecretKey:         os.Getenv("STRIPE_SECRET_KEY"),
		StripeWebhookSecret:     os.Getenv("STRIPE_WEBHOOK_SECRET"),
		StripePriceWaitlistTest: os.Getenv("STRIPE_PRICE_ID_WAITLIST_TEST"),
		StripePriceWaitlistLive: os.Getenv("STRIPE_PRICE_ID_WAITLIST_LIVE"),
	}
}

func envString(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envInt(key string, fallback int) int {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return fallback
	}
	return n
}
