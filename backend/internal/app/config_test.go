package app

import "testing"

func TestLoadConfig_Defaults(t *testing.T) {
	t.Setenv("PORT", "")
	t.Setenv("REDIS_URL", "")
	c := LoadConfig()
	if c.Port != 8080 {
		t.Fatalf("port: %d", c.Port)
	}
	if c.RedisURL == "" {
		t.Fatal("expected default redis url")
	}
	if c.CompanyChannelsRedisKey != "employee-factory:company_channels" {
		t.Fatalf("company channels redis key: %q", c.CompanyChannelsRedisKey)
	}
}
