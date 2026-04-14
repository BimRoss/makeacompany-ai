package app

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

const capabilityCatalogRedisKey = keyPrefix + ":catalog:capabilities:v1"

type CapabilityCatalog struct {
	Revision         string                      `json:"revision,omitempty"`
	CoreEmployees    []CapabilityCatalogEmployee `json:"coreEmployees"`
	Skills           []CapabilityCatalogSkill    `json:"skills"`
	EmployeeSkillIDs map[string][]string         `json:"employeeSkillIds"`
	UpdatedAt        string                      `json:"updatedAt,omitempty"`
	Source           string                      `json:"source,omitempty"`
}

type CapabilityCatalogEmployee struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Description string `json:"description"`
}

type CapabilityCatalogSkill struct {
	ID             string   `json:"id"`
	Label          string   `json:"label"`
	Description    string   `json:"description"`
	RuntimeTool    string   `json:"runtimeTool"`
	RequiredParams []string `json:"requiredParams"`
	OptionalParams []string `json:"optionalParams"`
}

var canonicalEmployeeDescriptions = map[string]string{
	"alex":   "First-principles business brain: punchy, direct, volume over perfection. I default to leverage and bottlenecks-what actually scales, what's busywork, where the constraint is. Proof beats promises; clear beats clever. I like short pain for long gain, fast decide->do loops, and input from people closest to the outcome you want-not the drama closest to you. Sales-wise: kind (real outcomes), not nice (avoiding truth); fundamentals over clever one-liners.",
	"garth":  "BimRoss intern energy: curious, earnest, a little shy in a good way. I ask clear questions, admit what I do not know, and hand off to Alex, Tim, or Ross when the thread needs sales, simplification, or automation depth. Grant is CEO-I am here to learn and help without pretending to be the decider.",
	"joanne": "Executive-operations partner lens: calm, practical, and execution-first. I focus on anticipation, prioritization, healthy boundaries, and high-discretion support. I use AI to speed drafts and repetitive tasks, but keep human judgment for context, voice, and relationship-aware decisions.",
	"ross":   "BimRoss default brain on Slack: senior partner for shipping-Go, Next.js, Docker/K8s, GitOps-with Bob Ross ease. Talent is a pursued interest; we don't pretend mistakes vanish in prod, but we iterate without shame, own the canvas (your repo, your world), and keep proof over promises. Warm tone, direct truth, low theater. Escalates security and incentive issues per policy-not 'happy accidents.'",
	"tim":    "Calm, tactical, curiosity-first. I bias toward small reversible tests, batching and delegation where they earn their keep, and relationships built over years-not transactional networking. I care about how you learn (meta-learning), how you recover from failure, and how you protect attention when everything screams urgent. Ask better questions; design experiments; say no to protect the few things that matter.",
}

func derivedRuntimeTool(employeeID, skillID string) string {
	employeeID = strings.ToLower(strings.TrimSpace(employeeID))
	skillID = normalizeCatalogSkillID(skillID)
	if employeeID == "" || skillID == "" {
		return ""
	}
	return employeeID + "-" + skillID
}

func migrateLegacyRuntimeTool(runtimeTool, skillID string, owners []string) string {
	runtimeTool = strings.ToLower(strings.TrimSpace(runtimeTool))
	skillID = normalizeCatalogSkillID(skillID)
	if len(owners) > 0 {
		return derivedRuntimeTool(owners[0], skillID)
	}
	switch runtimeTool {
	case "joanne_email":
		return derivedRuntimeTool("joanne", "write-email")
	case "joanne_google_docs":
		return derivedRuntimeTool("joanne", "write-doc")
	case "garth_twitter_lookup":
		return derivedRuntimeTool("garth", "read-twitter")
	default:
		if runtimeTool != "" {
			return runtimeTool
		}
	}
	return ""
}

func ownersBySkillID(employeeSkillIDs map[string][]string) map[string][]string {
	out := map[string][]string{}
	seenBySkill := map[string]map[string]struct{}{}
	for employeeID, skillIDs := range employeeSkillIDs {
		employeeID = strings.ToLower(strings.TrimSpace(employeeID))
		if employeeID == "" {
			continue
		}
		for _, skillID := range skillIDs {
			skillID = normalizeCatalogSkillID(skillID)
			if skillID == "" || skillID == "read-server" {
				continue
			}
			if seenBySkill[skillID] == nil {
				seenBySkill[skillID] = map[string]struct{}{}
			}
			if _, exists := seenBySkill[skillID][employeeID]; exists {
				continue
			}
			seenBySkill[skillID][employeeID] = struct{}{}
			out[skillID] = append(out[skillID], employeeID)
		}
	}
	for skillID := range out {
		sort.Strings(out[skillID])
	}
	return out
}

func defaultCapabilityCatalog() CapabilityCatalog {
	return CapabilityCatalog{
		Revision: "default",
		CoreEmployees: []CapabilityCatalogEmployee{
			{ID: "alex", Label: "Alex", Description: canonicalEmployeeDescriptions["alex"]},
			{ID: "tim", Label: "Tim", Description: canonicalEmployeeDescriptions["tim"]},
			{ID: "ross", Label: "Ross", Description: canonicalEmployeeDescriptions["ross"]},
			{ID: "garth", Label: "Garth", Description: canonicalEmployeeDescriptions["garth"]},
			{ID: "joanne", Label: "Joanne", Description: canonicalEmployeeDescriptions["joanne"]},
		},
		Skills: []CapabilityCatalogSkill{
			{
				ID:             "write-email",
				Label:          "Write Email",
				Description:    "Draft, send, and triage email communication.",
				RuntimeTool:    "joanne-write-email",
				RequiredParams: []string{"intent", "subject", "to"},
				OptionalParams: []string{"button", "commenters", "editors", "link", "viewers"},
			},
			{
				ID:             "write-doc",
				Label:          "Write Doc",
				Description:    "Create, edit, and organize working docs.",
				RuntimeTool:    "joanne-write-doc",
				RequiredParams: []string{"intent", "title", "type"},
				OptionalParams: []string{"commenters", "editors", "viewers"},
			},
			{
				ID:             "read-slack",
				Label:          "Read Slack",
				Description:    "List channels and read recent channel messages for onboarding context.",
				RuntimeTool:    "joanne-read-slack",
				RequiredParams: []string{"action", "intent"},
				OptionalParams: []string{"channel", "channel_name", "count", "reason"},
			},
			{
				ID:             "write-slack",
				Label:          "Write Slack",
				Description:    "Create channels and invite requesters to channels for onboarding setup.",
				RuntimeTool:    "joanne-write-slack",
				RequiredParams: []string{"action", "intent"},
				OptionalParams: []string{"channel", "channel_name", "is_private", "reason"},
			},
			{
				ID:             "read-twitter",
				Label:          "Read Twitter",
				Description:    "Discover and search high-impression tweets quickly.",
				RuntimeTool:    "garth-read-twitter",
				RequiredParams: []string{"intent", "query"},
				OptionalParams: []string{"count"},
			},
		},
		EmployeeSkillIDs: map[string][]string{
			"alex":   {},
			"tim":    {},
			"ross":   {},
			"garth":  {"read-twitter"},
			"joanne": {"read-slack", "write-email", "write-doc", "write-slack"},
		},
		UpdatedAt: time.Now().UTC().Format(time.RFC3339),
		Source:    "default",
	}
}

func normalizeCatalogSkillID(raw string) string {
	id := strings.TrimSpace(raw)
	if id == "write-docs" {
		return "write-doc"
	}
	return id
}

func normalizeCatalogSkillParamName(raw string) string {
	value := strings.TrimSpace(raw)
	if value == "" {
		return ""
	}
	switch value {
	case "additionalCommenters":
		return "commenters"
	case "additionalEditors":
		return "editors"
	case "additionalViewers":
		return "viewers"
	case "ctaText", "cta_text":
		return "button"
	case "ctaUrl", "ctaURL", "cta_url":
		return "link"
	case "bodyText":
		return "intent"
	case "docType":
		return "type"
	case "maxResults":
		return "count"
	case "bodyInstruction", "goal", "lengthTarget", "tableRequest", "deadline", "tone", "timeRange", "sortBy":
		return ""
	default:
		return value
	}
}

func normalizeCapabilityCatalog(c CapabilityCatalog) CapabilityCatalog {
	ownersBySkill := ownersBySkillID(c.EmployeeSkillIDs)
	next := CapabilityCatalog{
		Revision:         strings.TrimSpace(c.Revision),
		CoreEmployees:    make([]CapabilityCatalogEmployee, 0, len(c.CoreEmployees)),
		Skills:           make([]CapabilityCatalogSkill, 0, len(c.Skills)),
		EmployeeSkillIDs: map[string][]string{},
		UpdatedAt:        c.UpdatedAt,
		Source:           c.Source,
	}

	for _, employee := range c.CoreEmployees {
		id := strings.ToLower(strings.TrimSpace(employee.ID))
		if id == "" {
			continue
		}
		description := strings.TrimSpace(employee.Description)
		if canonical, ok := canonicalEmployeeDescriptions[id]; ok {
			description = canonical
		}
		next.CoreEmployees = append(next.CoreEmployees, CapabilityCatalogEmployee{
			ID:          id,
			Label:       strings.TrimSpace(employee.Label),
			Description: description,
		})
	}

	for _, skill := range c.Skills {
		id := normalizeCatalogSkillID(skill.ID)
		if id == "read-server" || id == "" {
			continue
		}
		required := normalizeCatalogParamList(skill.RequiredParams)
		optional := normalizeCatalogParamList(skill.OptionalParams)
		required = normalizeCatalogParamList(mapCatalogParams(required))
		optional = normalizeCatalogParamList(mapCatalogParams(optional))

		switch id {
		case "write-email":
			skill.Label = "Write Email"
			required = []string{"intent", "subject", "to"}
			optional = []string{"button", "commenters", "editors", "link", "viewers"}
		case "write-doc":
			skill.Label = "Write Doc"
			required = []string{"intent", "title", "type"}
			optional = []string{"commenters", "editors", "viewers"}
		case "read-slack":
			skill.Label = "Read Slack"
			required = []string{"action", "intent"}
			optional = []string{"channel", "channel_name", "count", "reason"}
		case "write-slack":
			skill.Label = "Write Slack"
			required = []string{"action", "intent"}
			optional = []string{"channel", "channel_name", "is_private", "reason"}
		case "read-twitter":
			optional = []string{"count"}
		}

		overlap := map[string]struct{}{}
		for _, param := range required {
			overlap[param] = struct{}{}
		}
		filteredOptional := make([]string, 0, len(optional))
		for _, param := range optional {
			if _, exists := overlap[param]; exists {
				continue
			}
			filteredOptional = append(filteredOptional, param)
		}
		skill.OptionalParams = normalizeCatalogParamList(filteredOptional)
		skill.RequiredParams = normalizeCatalogParamList(required)
		skill.ID = id
		skill.RuntimeTool = migrateLegacyRuntimeTool(skill.RuntimeTool, id, ownersBySkill[id])
		skill.Label = strings.TrimSpace(skill.Label)
		skill.Description = strings.TrimSpace(skill.Description)
		next.Skills = append(next.Skills, skill)
	}

	skillIDs := map[string]struct{}{}
	for _, skill := range next.Skills {
		skillIDs[skill.ID] = struct{}{}
	}
	normalizedEmployeeSkillIDs := map[string][]string{}
	for employeeID, mapped := range c.EmployeeSkillIDs {
		normalizedEmployeeSkillIDs[strings.ToLower(strings.TrimSpace(employeeID))] = mapped
	}
	for _, employee := range next.CoreEmployees {
		mapped := normalizedEmployeeSkillIDs[employee.ID]
		out := make([]string, 0, len(mapped))
		seen := map[string]struct{}{}
		for _, skillID := range mapped {
			id := normalizeCatalogSkillID(skillID)
			if id == "read-server" {
				continue
			}
			if _, ok := skillIDs[id]; !ok {
				continue
			}
			if _, exists := seen[id]; exists {
				continue
			}
			seen[id] = struct{}{}
			out = append(out, id)
		}
		sort.Strings(out)
		next.EmployeeSkillIDs[employee.ID] = out
	}

	return next
}

func mapCatalogParams(in []string) []string {
	out := make([]string, 0, len(in))
	for _, value := range in {
		mapped := normalizeCatalogSkillParamName(value)
		if mapped == "" {
			continue
		}
		out = append(out, mapped)
	}
	return out
}

func normalizeCatalogParamList(in []string) []string {
	if len(in) == 0 {
		return nil
	}
	seen := map[string]struct{}{}
	out := make([]string, 0, len(in))
	for _, item := range in {
		clean := strings.TrimSpace(item)
		if clean == "" {
			continue
		}
		if _, exists := seen[clean]; exists {
			continue
		}
		seen[clean] = struct{}{}
		out = append(out, clean)
	}
	sort.Strings(out)
	return out
}

func validateCapabilityCatalog(c CapabilityCatalog) error {
	c = normalizeCapabilityCatalog(c)
	if len(c.CoreEmployees) == 0 {
		return fmt.Errorf("coreEmployees is required")
	}
	if len(c.Skills) == 0 {
		return fmt.Errorf("skills is required")
	}
	if len(c.EmployeeSkillIDs) == 0 {
		return fmt.Errorf("employeeSkillIds is required")
	}

	coreIDs := map[string]struct{}{}
	for _, employee := range c.CoreEmployees {
		id := strings.ToLower(strings.TrimSpace(employee.ID))
		if id == "" || strings.TrimSpace(employee.Label) == "" || strings.TrimSpace(employee.Description) == "" {
			return fmt.Errorf("invalid core employee entry")
		}
		coreIDs[id] = struct{}{}
	}

	skillIDs := map[string]CapabilityCatalogSkill{}
	for _, skill := range c.Skills {
		id := strings.TrimSpace(skill.ID)
		if id == "" || strings.TrimSpace(skill.Label) == "" || strings.TrimSpace(skill.Description) == "" {
			return fmt.Errorf("invalid skill entry")
		}
		if len(skill.RequiredParams) == 0 {
			return fmt.Errorf("skill %s missing requiredParams", id)
		}
		required := normalizeCatalogParamList(skill.RequiredParams)
		optional := normalizeCatalogParamList(skill.OptionalParams)
		overlap := map[string]struct{}{}
		for _, p := range required {
			overlap[p] = struct{}{}
		}
		for _, p := range optional {
			if _, exists := overlap[p]; exists {
				return fmt.Errorf("skill %s has parameter %q in both required and optional", id, p)
			}
		}
		skillIDs[id] = skill
	}

	for employeeID, skillList := range c.EmployeeSkillIDs {
		normalizedEmployeeID := strings.ToLower(strings.TrimSpace(employeeID))
		if _, ok := coreIDs[normalizedEmployeeID]; !ok {
			return fmt.Errorf("unknown employee in employeeSkillIds: %s", employeeID)
		}
		for _, skillID := range skillList {
			if _, ok := skillIDs[strings.TrimSpace(skillID)]; !ok {
				return fmt.Errorf("employee %s references unknown skill %s", employeeID, skillID)
			}
		}
	}
	for coreID := range coreIDs {
		if _, ok := c.EmployeeSkillIDs[coreID]; !ok {
			return fmt.Errorf("employeeSkillIds missing core employee %s", coreID)
		}
	}
	return nil
}

func (s *Store) GetCapabilityCatalog(ctx context.Context) (CapabilityCatalog, error) {
	raw, err := s.rdb.Get(ctx, capabilityCatalogRedisKey).Bytes()
	if err == redis.Nil {
		catalog := defaultCapabilityCatalog()
		catalog.Source = "redis_seed"
		body, marshalErr := json.Marshal(catalog)
		if marshalErr == nil {
			_ = s.rdb.Set(ctx, capabilityCatalogRedisKey, body, 0).Err()
		}
		return catalog, nil
	}
	if err != nil {
		return CapabilityCatalog{}, err
	}
	var catalog CapabilityCatalog
	if err := json.Unmarshal(raw, &catalog); err != nil {
		return CapabilityCatalog{}, fmt.Errorf("decode catalog: %w", err)
	}
	catalog = normalizeCapabilityCatalog(catalog)
	if err := validateCapabilityCatalog(catalog); err != nil {
		return CapabilityCatalog{}, err
	}
	catalog.Source = "redis"
	return catalog, nil
}

func (s *Store) PutCapabilityCatalog(ctx context.Context, catalog CapabilityCatalog) error {
	catalog = normalizeCapabilityCatalog(catalog)
	if err := validateCapabilityCatalog(catalog); err != nil {
		return err
	}
	catalog.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	catalog.Source = "redis"
	body, err := json.Marshal(catalog)
	if err != nil {
		return fmt.Errorf("encode catalog: %w", err)
	}
	return s.rdb.Set(ctx, capabilityCatalogRedisKey, body, 0).Err()
}
