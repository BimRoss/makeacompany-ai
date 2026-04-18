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
	// Requires names backend dependencies for operator docs and cross-repo alignment (e.g. google_oauth, twitter_indexer).
	Requires []string `json:"requires,omitempty"`
}

// Default copy for empty Redis / seed only. Admin PUTs store operator-edited text in Redis;
// normalizeCapabilityCatalog must not replace descriptions from the request body.
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
	skillID = normalizeCatalogSkillID(skillID)
	rt := strings.ToLower(strings.TrimSpace(runtimeTool))

	// Historical aliases → canonical employee-skill tool names.
	switch rt {
	case "joanne_email":
		return derivedRuntimeTool("joanne", "write-email")
	case "joanne_google_docs":
		return derivedRuntimeTool("joanne", "write-doc")
	case "garth_twitter_lookup":
		return derivedRuntimeTool("garth", "read-twitter")
	case "garth_twitter_trends":
		return derivedRuntimeTool("garth", "read-trends")
	case "joanne_read_company":
		return derivedRuntimeTool("joanne", "read-company")
	}

	if rt != "" {
		// Non-legacy explicit tool — keep as configured (admin / Redis source of truth).
		return rt
	}
	if len(owners) > 0 {
		return derivedRuntimeTool(owners[0], skillID)
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

// mergeCapabilityCatalogWithDefaults appends skill definitions (and default employee assignments
// for those skills only) that exist in defaultCapabilityCatalog but were missing from the stored
// catalog. This keeps older Redis snapshots aligned when new skills ship without a manual migration.
func mergeCapabilityCatalogWithDefaults(c CapabilityCatalog) CapabilityCatalog {
	def := defaultCapabilityCatalog()
	originalSkillIDs := map[string]struct{}{}
	for _, s := range c.Skills {
		id := normalizeCatalogSkillID(s.ID)
		if id != "" {
			originalSkillIDs[id] = struct{}{}
		}
	}
	newSkillIDs := map[string]struct{}{}
	for _, ds := range def.Skills {
		id := normalizeCatalogSkillID(ds.ID)
		if id == "" {
			continue
		}
		if _, ok := originalSkillIDs[id]; !ok {
			newSkillIDs[id] = struct{}{}
		}
	}
	if len(newSkillIDs) == 0 {
		return c
	}
	for _, ds := range def.Skills {
		id := normalizeCatalogSkillID(ds.ID)
		if _, want := newSkillIDs[id]; !want {
			continue
		}
		c.Skills = append(c.Skills, ds)
	}
	for empID, defSkills := range def.EmployeeSkillIDs {
		empID = strings.ToLower(strings.TrimSpace(empID))
		if empID == "" {
			continue
		}
		cur := c.EmployeeSkillIDs[empID]
		if cur == nil {
			cur = []string{}
		}
		seen := map[string]struct{}{}
		for _, s := range cur {
			seen[normalizeCatalogSkillID(s)] = struct{}{}
		}
		for _, s := range defSkills {
			sid := normalizeCatalogSkillID(s)
			if _, isNew := newSkillIDs[sid]; !isNew {
				continue
			}
			if _, ok := seen[sid]; ok {
				continue
			}
			cur = append(cur, sid)
			seen[sid] = struct{}{}
		}
		sort.Strings(cur)
		c.EmployeeSkillIDs[empID] = cur
	}
	return c
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
				RequiredParams: []string{"intent", "subject"},
				OptionalParams: []string{"to", "button", "commenters", "editors", "link", "viewers"},
				Requires:       []string{"google_oauth"},
			},
			{
				ID:             "write-doc",
				Label:          "Write Doc",
				Description:    "Create, edit, and organize working docs.",
				RuntimeTool:    "joanne-write-doc",
				RequiredParams: []string{"intent", "title", "type"},
				OptionalParams: []string{"commenters", "editors", "viewers"},
				Requires:       []string{"google_oauth"},
			},
			{
				ID:             "write-company",
				Label:          "Write Company",
				Description:    "Provision a company channel, run onboarding, create channels, and invite members. Requires explicit Confirm/Cancel before any write.",
				RuntimeTool:    "joanne-write-company",
				RequiredParams: []string{"action", "intent"},
				OptionalParams: []string{"channel", "channel_name", "is_private", "reason"},
				Requires:       []string{"slack_workspace"},
			},
			{
				ID:             "read-company",
				Label:          "Read Company",
				Description:    "Summarize this channel from cached Slack history in Redis (hourly digest). Runs immediately in Slack (no confirmation).",
				RuntimeTool:    "joanne-read-company",
				RequiredParams: []string{"intent"},
				OptionalParams: []string{},
				Requires:       []string{"redis_channel_knowledge"},
			},
			{
				ID:             "read-twitter",
				Label:          "Read Twitter",
				Description:    "Search Twitter by keyword and fetch high-impression tweets (not the platform trend list). Runs immediately in Slack (no confirmation).",
				RuntimeTool:    "garth-read-twitter",
				RequiredParams: []string{"intent", "query"},
				OptionalParams: []string{"count"},
				Requires:       []string{"twitter_indexer"},
			},
			{
				ID:             "read-trends",
				Label:          "Read Trends",
				Description:    "Fetch the current Twitter/X trend list (not keyword search). Runs immediately in Slack (no confirmation).",
				RuntimeTool:    "garth-read-trends",
				RequiredParams: []string{"intent"},
				OptionalParams: []string{"count"},
				Requires:       []string{"twitter_indexer"},
			},
		},
		EmployeeSkillIDs: map[string][]string{
			"alex":   {},
			"tim":    {},
			"ross":   {},
			"garth":  {"read-twitter", "read-trends"},
			"joanne": {"read-company", "write-company", "write-email", "write-doc"},
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
	if id == "read-slack" {
		return "read-company"
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

// builtinSkillDisplayLabel returns default UI labels for known skill ids when the stored label is empty.
func builtinSkillDisplayLabel(skillID string) string {
	switch skillID {
	case "write-email":
		return "Write Email"
	case "write-doc":
		return "Write Doc"
	case "write-company":
		return "Write Company"
	case "read-company":
		return "Read Company"
	case "read-twitter":
		return "Read Twitter"
	case "read-trends":
		return "Read Trends"
	default:
		return ""
	}
}

// builtinSkillParamDefaults returns minimum required and default optional param names for built-in skills.
// Unknown/custom skills return nil, nil (caller keeps submitted lists only).
func builtinSkillParamDefaults(skillID string) (minRequired, defaultOptional []string) {
	switch skillID {
	case "write-email":
		return []string{"intent", "subject", "to"}, []string{"button", "commenters", "editors", "link", "viewers"}
	case "write-doc":
		return []string{"intent", "title", "type"}, []string{"commenters", "editors", "viewers"}
	case "write-company":
		return []string{"action", "intent"}, []string{"channel", "channel_name", "is_private", "reason"}
	case "read-company":
		return []string{"intent"}, []string{}
	case "read-twitter", "read-trends":
		return nil, []string{"count"}
	default:
		return nil, nil
	}
}

// mergeSkillParamsWithDefaults unions operator-supplied params with built-in minimums so admin edits extend
// defaults instead of being replaced by them.
func mergeSkillParamsWithDefaults(skillID string, required, optional []string) ([]string, []string) {
	req := normalizeCatalogParamList(mapCatalogParams(required))
	opt := normalizeCatalogParamList(mapCatalogParams(optional))
	minReq, defOpt := builtinSkillParamDefaults(skillID)
	if len(minReq) == 0 && len(defOpt) == 0 {
		return req, opt
	}

	seen := map[string]struct{}{}
	var outReq []string
	for _, p := range minReq {
		if _, ok := seen[p]; !ok {
			seen[p] = struct{}{}
			outReq = append(outReq, p)
		}
	}
	for _, p := range req {
		if _, ok := seen[p]; !ok {
			seen[p] = struct{}{}
			outReq = append(outReq, p)
		}
	}
	sort.Strings(outReq)

	overlap := map[string]struct{}{}
	for _, p := range outReq {
		overlap[p] = struct{}{}
	}
	seenOpt := map[string]struct{}{}
	var outOpt []string
	for _, p := range defOpt {
		if _, inR := overlap[p]; inR {
			continue
		}
		if _, ok := seenOpt[p]; !ok {
			seenOpt[p] = struct{}{}
			outOpt = append(outOpt, p)
		}
	}
	for _, p := range opt {
		if _, inR := overlap[p]; inR {
			continue
		}
		if _, ok := seenOpt[p]; !ok {
			seenOpt[p] = struct{}{}
			outOpt = append(outOpt, p)
		}
	}
	sort.Strings(outOpt)
	return outReq, outOpt
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
		required, optional = mergeSkillParamsWithDefaults(id, required, optional)

		lbl := strings.TrimSpace(skill.Label)
		if lbl == "" {
			lbl = builtinSkillDisplayLabel(id)
		}
		skill.Label = lbl
		skill.RequiredParams = required
		skill.OptionalParams = optional
		skill.ID = id
		skill.RuntimeTool = migrateLegacyRuntimeTool(skill.RuntimeTool, id, ownersBySkill[id])
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
	catalog = mergeCapabilityCatalogWithDefaults(catalog)
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
