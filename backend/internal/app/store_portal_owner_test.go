package app

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func TestOwnerEmailsForCompanyChannel(t *testing.T) {
	srv, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()
	rdb := redis.NewClient(&redis.Options{Addr: srv.Addr()})
	defer rdb.Close()
	ctx := context.Background()

	st := &Store{rdb: rdb}
	hashKey := "test:company_channels"
	chJSON := `{"company_slug":"acme","channel_id":"C0OWNERS","threads_enabled":true,"general_auto_reaction_enabled":false,"out_of_office_enabled":false,"owner_ids":["U1","U2"]}`
	if err := rdb.HSet(ctx, hashKey, "C0OWNERS", chJSON).Err(); err != nil {
		t.Fatal(err)
	}
	if err := rdb.Set(ctx, userBySlackRedisKey("U1"), "owner@example.com", 0).Err(); err != nil {
		t.Fatal(err)
	}
	if err := rdb.Set(ctx, userBySlackRedisKey("U2"), "Owner@Example.com", 0).Err(); err != nil {
		t.Fatal(err)
	}

	emails, err := st.OwnerEmailsForCompanyChannel(ctx, hashKey, "C0OWNERS")
	if err != nil {
		t.Fatal(err)
	}
	if len(emails) != 1 || emails[0] != "owner@example.com" {
		t.Fatalf("emails: %#v", emails)
	}
}

func TestOwnerStripeCustomerIDsForCompanyChannel(t *testing.T) {
	srv, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()
	rdb := redis.NewClient(&redis.Options{Addr: srv.Addr()})
	defer rdb.Close()
	ctx := context.Background()

	st := &Store{rdb: rdb}
	hashKey := "test:company_channels"
	chJSON := `{"company_slug":"acme","channel_id":"C0OWNERS","threads_enabled":true,"general_auto_reaction_enabled":false,"out_of_office_enabled":false,"owner_ids":["U1","U2"]}`
	if err := rdb.HSet(ctx, hashKey, "C0OWNERS", chJSON).Err(); err != nil {
		t.Fatal(err)
	}
	if err := rdb.Set(ctx, userBySlackRedisKey("U1"), "owner@example.com", 0).Err(); err != nil {
		t.Fatal(err)
	}
	if err := rdb.Set(ctx, userBySlackRedisKey("U2"), "co@example.com", 0).Err(); err != nil {
		t.Fatal(err)
	}
	if err := rdb.HSet(ctx, userProfileRedisKey("owner@example.com"), "email", "owner@example.com", "stripe_customer_id", "cus_owner111").Err(); err != nil {
		t.Fatal(err)
	}
	if err := rdb.HSet(ctx, userProfileRedisKey("co@example.com"), "email", "co@example.com", "stripe_customer_id", "cus_co222222").Err(); err != nil {
		t.Fatal(err)
	}

	got, err := st.OwnerStripeCustomerIDsForCompanyChannel(ctx, hashKey, "C0OWNERS")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("ids: %#v", got)
	}
}

func TestOwnerEmailsForCompanyChannel_NoSlackIndex(t *testing.T) {
	srv, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()
	rdb := redis.NewClient(&redis.Options{Addr: srv.Addr()})
	defer rdb.Close()
	ctx := context.Background()

	st := &Store{rdb: rdb}
	hashKey := "test:cc2"
	chJSON := `{"company_slug":"solo","channel_id":"C0NOEMAIL","threads_enabled":true,"general_auto_reaction_enabled":false,"out_of_office_enabled":false,"owner_ids":["U9"]}`
	if err := rdb.HSet(ctx, hashKey, "C0NOEMAIL", chJSON).Err(); err != nil {
		t.Fatal(err)
	}

	emails, err := st.OwnerEmailsForCompanyChannel(ctx, hashKey, "C0NOEMAIL")
	if err != nil {
		t.Fatal(err)
	}
	if len(emails) != 0 {
		t.Fatalf("want empty, got %#v", emails)
	}
}

func TestCreatePortalSession_Get_Delete(t *testing.T) {
	srv, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()
	rdb := redis.NewClient(&redis.Options{Addr: srv.Addr()})
	defer rdb.Close()
	ctx := context.Background()

	st := &Store{rdb: rdb}
	exp, perr := time.Parse(time.RFC3339, "2030-01-02T15:04:05Z")
	if perr != nil {
		t.Fatal(perr)
	}
	if err := st.CreatePortalSession(ctx, "tokhex", "u@example.com", "C0CHANNEL", exp); err != nil {
		t.Fatal(err)
	}
	sess, err := st.GetPortalSession(ctx, "tokhex")
	if err != nil {
		t.Fatal(err)
	}
	if sess.Email != "u@example.com" || sess.ChannelID != "C0CHANNEL" {
		t.Fatalf("session: %+v", sess)
	}
	if err := st.DeletePortalSession(ctx, "tokhex"); err != nil {
		t.Fatal(err)
	}
	if _, err := st.GetPortalSession(ctx, "tokhex"); err != redis.Nil {
		t.Fatalf("after delete: err=%v", err)
	}
}
