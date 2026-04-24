package app

import (
	"context"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func TestLookupSlackFirstNameByEmail(t *testing.T) {
	srv, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()

	rdb := redis.NewClient(&redis.Options{Addr: srv.Addr()})
	defer rdb.Close()

	store := &Store{rdb: rdb}
	ctx := context.Background()

	if got := store.LookupSlackFirstNameByEmail(ctx, "ada@example.com"); got != "" {
		t.Fatalf("missing snapshot: got %q", got)
	}

	blob, err := MarshalSlackUsersSnapshot([]SlackWorkspaceUser{
		{SlackUserID: "U1", Email: "ada@example.com", RealName: "Ada Lovelace", IsBot: false, IsDeleted: false},
		{SlackUserID: "U2", Email: "grant@bimross.com", DisplayName: "grant", RealName: "", IsBot: false, IsDeleted: false},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SaveSlackUsersSnapshot(ctx, blob); err != nil {
		t.Fatal(err)
	}

	if got := store.LookupSlackFirstNameByEmail(ctx, "Ada@Example.com"); got != "Ada" {
		t.Fatalf("got %q want Ada", got)
	}
	if got := store.LookupSlackFirstNameByEmail(ctx, "grant@bimross.com"); got != "grant" {
		t.Fatalf("got %q want grant", got)
	}
}
