package app

import (
	"os"
	"strconv"
	"strings"
)

type Config struct {
	Port                        int
	RedisURL                    string
	AppBaseURL                  string
	StripeSecretKey             string
	StripeWebhookSecretSnapshot string
	StripeWebhookSecretThin     string
	StripePriceWaitlistTest     string
	StripePriceWaitlistLive     string
}

func LoadConfig() Config {
	// Webhook signing secrets: prefer *_TEST for clarity; aliases match stripe-factory / older env files.
	snapshot := envFirst(
		"STRIPE_WEBHOOK_SECRET_SNAPSHOT_TEST",
		"STRIPE_WEBHOOK_SECRET_SNAPSHOT",
		"STRIPE_WEBHOOK_SECRET",
	)
	thin := envFirst(
		"STRIPE_WEBHOOK_SECRET_THIN_TEST",
		"STRIPE_WEBHOOK_SECRET_THIN",
	)
	return Config{
		Port:                        envInt("PORT", 8080),
		RedisURL:                    envString("REDIS_URL", "redis://localhost:6379/0"),
		AppBaseURL:                  strings.TrimRight(envString("APP_BASE_URL", "http://localhost:3000"), "/"),
		StripeSecretKey:             os.Getenv("STRIPE_SECRET_KEY"),
		StripeWebhookSecretSnapshot: snapshot,
		StripeWebhookSecretThin:     thin,
		StripePriceWaitlistTest:     os.Getenv("STRIPE_PRICE_ID_WAITLIST_TEST"),
		StripePriceWaitlistLive:     os.Getenv("STRIPE_PRICE_ID_WAITLIST_LIVE"),
	}
}

// envFirst returns the first non-empty trimmed env value for the given keys.
func envFirst(keys ...string) string {
	for _, k := range keys {
		if v := strings.TrimSpace(os.Getenv(k)); v != "" {
			return v
		}
	}
	return ""
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
