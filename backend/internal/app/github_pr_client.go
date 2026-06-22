package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"time"

	"makeacompany-ai/backend/internal/upstream"
)

// FirstMergedPRFinder returns the timestamp of the earliest PR merged into the
// default branch of `owner/repo`. ok=false means the repo exists but has no
// merged PRs yet (a legit pre-activation state, not an error). Errors are
// reserved for transport / 4xx / 5xx that the caller shouldn't paper over;
// 404 maps to (zero, false, nil) so a renamed-or-deleted user repo doesn't
// crash the sweep.
type FirstMergedPRFinder interface {
	FirstMergedPRAt(ctx context.Context, owner, repo string) (time.Time, bool, error)
}

// githubPRClient implements FirstMergedPRFinder against the public GitHub REST API.
// One auth token, no caching — the sweeper already skips users with a stamped
// `first_pr_merged_at`, so we never re-query a user once they've activated.
type githubPRClient struct {
	httpClient *http.Client
	token      string
	baseURL    string // injectable for tests; defaults to https://api.github.com
}

func newGitHubPRClient(token string) *githubPRClient {
	return &githubPRClient{
		httpClient: upstream.WrapClient("github", &http.Client{Timeout: 15 * time.Second}),
		token:      token,
		baseURL:    "https://api.github.com",
	}
}

// pullsResponse mirrors the subset of /repos/{owner}/{repo}/pulls we care about.
// Closed PRs come back with `merged_at` nullable: nil means closed-without-merge.
type pullsResponseItem struct {
	Number   int        `json:"number"`
	MergedAt *time.Time `json:"merged_at"`
	Base     struct {
		Ref string `json:"ref"`
	} `json:"base"`
}

// FirstMergedPRAt walks the closed PRs ascending by creation, returning the
// earliest `merged_at` whose base branch is `main` or `master`. We don't trust
// `direction=asc` on creation order to also mean ascending merge order (a PR
// opened first can merge last), so we scan the whole closed set and keep the
// minimum merged_at. In practice fresh user repos have <30 closed PRs, so one
// page is enough; pagination is a follow-up if a real user passes that bar.
func (c *githubPRClient) FirstMergedPRAt(ctx context.Context, owner, repo string) (time.Time, bool, error) {
	if c == nil || c.token == "" {
		return time.Time{}, false, errors.New("github client unconfigured")
	}
	q := url.Values{}
	q.Set("state", "closed")
	q.Set("sort", "created")
	q.Set("direction", "asc")
	q.Set("per_page", "100")
	endpoint := fmt.Sprintf("%s/repos/%s/%s/pulls?%s", c.baseURL, owner, repo, q.Encode())

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return time.Time{}, false, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return time.Time{}, false, fmt.Errorf("do: %w", err)
	}
	defer resp.Body.Close()

	switch {
	case resp.StatusCode == http.StatusNotFound:
		// Repo gone or renamed since the autoadd hook stamped site_host. Not
		// the sweeper's job to repair; just skip this user this tick.
		return time.Time{}, false, nil
	case resp.StatusCode >= 400:
		return time.Time{}, false, fmt.Errorf("github %s: status %d", endpoint, resp.StatusCode)
	}

	var items []pullsResponseItem
	if err := json.NewDecoder(resp.Body).Decode(&items); err != nil {
		return time.Time{}, false, fmt.Errorf("decode: %w", err)
	}

	var earliest time.Time
	found := false
	for _, it := range items {
		if it.MergedAt == nil {
			continue
		}
		if it.Base.Ref != "main" && it.Base.Ref != "master" {
			continue
		}
		if !found || it.MergedAt.Before(earliest) {
			earliest = *it.MergedAt
			found = true
		}
	}
	return earliest, found, nil
}
