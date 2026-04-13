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

func defaultCapabilityCatalog() CapabilityCatalog {
	return CapabilityCatalog{
		CoreEmployees: []CapabilityCatalogEmployee{
			{ID: "alex", Label: "Alex", Description: "Head of Sales frameworks, pricing, and offer design."},
			{ID: "tim", Label: "Tim", Description: "Head of Simplifying focused on leverage and decision quality."},
			{ID: "ross", Label: "Ross", Description: "Head of Automation owning technical execution and shipping."},
			{ID: "garth", Label: "Garth", Description: "Head of Interns supporting research and implementation follow-through."},
			{ID: "joanne", Label: "Joanne", Description: "Head of Executive Operations for coordination and executive support."},
		},
		Skills: []CapabilityCatalogSkill{
			{
				ID:             "write-email",
				Label:          "Write Email",
				Description:    "Draft, send, and triage email communication.",
				RuntimeTool:    "joanne_email",
				RequiredParams: []string{"intent", "subject", "to"},
				OptionalParams: []string{"commenters", "editors", "viewers", "ctaText", "ctaUrl"},
			},
			{
				ID:             "write-doc",
				Label:          "Write Doc",
				Description:    "Create, edit, and organize working docs.",
				RuntimeTool:    "joanne_google_docs",
				RequiredParams: []string{"intent", "title", "type"},
				OptionalParams: []string{"commenters", "editors", "viewers"},
			},
			{
				ID:             "read-twitter",
				Label:          "Read Twitter",
				Description:    "Discover and search high-impression tweets quickly.",
				RuntimeTool:    "garth_twitter_lookup",
				RequiredParams: []string{"intent", "query"},
				OptionalParams: []string{"count"},
			},
		},
		EmployeeSkillIDs: map[string][]string{
			"alex":   {},
			"tim":    {},
			"ross":   {},
			"garth":  {"read-twitter"},
			"joanne": {"write-email", "write-doc"},
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
	next := CapabilityCatalog{
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
		next.CoreEmployees = append(next.CoreEmployees, CapabilityCatalogEmployee{
			ID:          id,
			Label:       strings.TrimSpace(employee.Label),
			Description: strings.TrimSpace(employee.Description),
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
			optional = []string{"commenters", "ctaText", "ctaUrl", "editors", "viewers"}
		case "write-doc":
			skill.Label = "Write Doc"
			required = []string{"intent", "title", "type"}
			optional = []string{"commenters", "editors", "viewers"}
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
		skill.RuntimeTool = strings.ToLower(strings.TrimSpace(skill.RuntimeTool))
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
		if strings.TrimSpace(skill.RuntimeTool) == "" {
			return fmt.Errorf("skill %s missing runtimeTool", id)
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
