package app

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/redis/go-redis/v9"
)

const slackMemberChannelsSnapshotKey = keyPrefix + ":admin:slack_member_channels_snapshot"

const slackMemberChannelsSnapshotTTL = time.Duration(0)

type slackMemberChannelsSnapshotEnvelope struct {
	FetchedAt      string          `json:"fetchedAt"`
	MemberChannels json.RawMessage `json:"member_channels"`
}

func (s *Store) SaveSlackMemberChannelsSnapshot(ctx context.Context, fetchedAt string, orchestratorJSON []byte) error {
	if s == nil {
		return errors.New("nil store")
	}
	env := slackMemberChannelsSnapshotEnvelope{
		FetchedAt:      fetchedAt,
		MemberChannels: json.RawMessage(orchestratorJSON),
	}
	blob, err := json.Marshal(env)
	if err != nil {
		return err
	}
	return s.rdb.Set(ctx, slackMemberChannelsSnapshotKey, blob, slackMemberChannelsSnapshotTTL).Err()
}

var ErrSlackMemberChannelsSnapshotMissing = errors.New("slack member channels snapshot missing")

func (s *Store) GetSlackMemberChannelsSnapshotBytes(ctx context.Context) ([]byte, error) {
	if s == nil {
		return nil, errors.New("nil store")
	}
	raw, err := s.rdb.Get(ctx, slackMemberChannelsSnapshotKey).Result()
	if err == redis.Nil {
		return nil, ErrSlackMemberChannelsSnapshotMissing
	}
	if err != nil {
		return nil, err
	}
	return []byte(raw), nil
}
