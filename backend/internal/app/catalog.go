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
	// ParamDefaults documents default values for optional params (display; runtime may mirror key defaults).
	ParamDefaults map[string]string `json:"paramDefaults,omitempty"`
	// Requires names backend dependencies for operator docs and cross-repo alignment (e.g. google_oauth, twitter_indexer).
	Requires []string `json:"requires,omitempty"`
}

func derivedRuntimeTool(employeeID, skillID string) string {
	employeeID = strings.ToLower(strings.TrimSpace(employeeID))
	skillID = normalizeCatalogSkillID(skillID)
	if employeeID == "" || skillID == "" {
		return ""
	}
	return employeeID + "-" + skillID
}

// resolveRuntimeTool returns the catalog runtimeTool: explicit non-empty value (canonical names
// from slack-orchestrator / admin), or employee-skill derived from skill owners when empty.
func resolveRuntimeTool(runtimeTool, skillID string, owners []string) string {
	skillID = normalizeCatalogSkillID(skillID)
	rt := strings.ToLower(strings.TrimSpace(runtimeTool))
	if rt != "" {
		if skillID == "read-web" {
			switch {
			case strings.HasSuffix(rt, "-read-internet"):
				rt = strings.TrimSuffix(rt, "-read-internet") + "-read-web"
			case strings.HasSuffix(rt, "-read_google"):
				rt = strings.TrimSuffix(rt, "-read_google") + "-read-web"
			case strings.HasSuffix(rt, "-read-google"):
				rt = strings.TrimSuffix(rt, "-read-google") + "-read-web"
			case strings.HasSuffix(rt, "-read_web"):
				rt = strings.TrimSuffix(rt, "-read_web") + "-read-web"
			}
		}
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
// for those skills only) that exist in def but were missing from the stored catalog. When the
// backend is configured with SLACK_ORCHESTRATOR_CAPABILITY_CATALOG_URL, def is a cached fetch
// from slack-orchestrator so older Redis snapshots pick up new skills without a manual migration.
func mergeCapabilityCatalogWithDefaults(c CapabilityCatalog, def CapabilityCatalog) CapabilityCatalog {
	originalEmployeeIDs := map[string]struct{}{}
	for _, e := range c.CoreEmployees {
		id := strings.ToLower(strings.TrimSpace(e.ID))
		if id == "" {
			continue
		}
		originalEmployeeIDs[id] = struct{}{}
	}
	for _, de := range def.CoreEmployees {
		id := strings.ToLower(strings.TrimSpace(de.ID))
		if id == "" {
			continue
		}
		if _, ok := originalEmployeeIDs[id]; ok {
			continue
		}
		c.CoreEmployees = append(c.CoreEmployees, de)
		originalEmployeeIDs[id] = struct{}{}
	}

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
	for _, de := range def.CoreEmployees {
		empID := strings.ToLower(strings.TrimSpace(de.ID))
		if empID == "" {
			continue
		}
		if _, ok := c.EmployeeSkillIDs[empID]; !ok {
			c.EmployeeSkillIDs[empID] = []string{}
		}
	}
	return c
}

// normalizeCatalogSkillID trims skill IDs and maps known legacy aliases to canonical IDs so
// stale Redis snapshots do not leak deprecated names into /skills.
func normalizeCatalogSkillID(raw string) string {
	trimmed := strings.TrimSpace(raw)
	switch strings.ToLower(trimmed) {
	case "read-internet", "readinternet", "read_google", "read-google", "readgoogle", "read_web", "read web":
		return "read-web"
	default:
		return trimmed
	}
}

func normalizeCatalogSkillParamName(raw string) string {
	switch strings.TrimSpace(raw) {
	case "issue_number":
		// Backward-compat alias: normalize legacy update-issue field to canonical "number".
		return "number"
	default:
		return strings.TrimSpace(raw)
	}
}

// builtinSkillDisplayLabel returns default UI labels for known skill ids when the stored label is empty.
func builtinSkillDisplayLabel(skillID string) string {
	switch skillID {
	case "create-email":
		return "Create Email"
	case "create-doc":
		return "Create Doc"
	case "create-company":
		return "Create Company"
	case "delete-company":
		return "Delete Company"
	case "create-slack":
		return "Create Slack"
	case "read-company":
		return "Read Company"
	case "read-skills":
		return "Read Skills"
	case "read-user":
		return "Read User"
	case "read-twitter":
		return "Read Twitter"
	case "read-trends":
		return "Read Trends"
	case "update-issue":
		return "Update Issue"
	default:
		return ""
	}
}

func mergeCreateEmailParamDefaultsMap(incoming map[string]string) map[string]string {
	def := map[string]string{
		"to":      "Message author (Slack profile; makeacompany slack→email index when configured)",
		"subject": "Derived from intent when omitted; runtime infers a working subject before send (same idea as create-doc title)",
		"button":  "none",
		"link":    "none",
	}
	out := make(map[string]string, len(def)+len(incoming))
	for k, v := range def {
		out[k] = v
	}
	for k, v := range incoming {
		k = strings.TrimSpace(k)
		v = strings.TrimSpace(v)
		if k == "" {
			continue
		}
		out[k] = v
	}
	return out
}

func mergeCreateDocParamDefaultsMap(incoming map[string]string) map[string]string {
	def := map[string]string{
		"title":      "Derived from intent when omitted; runtime infers a working title before draft",
		"editors":    "Message author email (implicit default); append @mentions or explicit editor emails",
		"type":       "outline",
		"length":     "Defaults to one page when omitted",
		"commenters": "none",
		"viewers":    "none",
	}
	out := make(map[string]string, len(def)+len(incoming))
	for k, v := range def {
		out[k] = v
	}
	for k, v := range incoming {
		k = strings.TrimSpace(k)
		v = strings.TrimSpace(v)
		if k == "" {
			continue
		}
		out[k] = v
	}
	return out
}

func mergeCreateCompanyParamDefaultsMap(incoming map[string]string) map[string]string {
	def := map[string]string{
		"name":     "Company / channel slug (gathered in-thread when not in the first message)",
		"founders": "Optional; when omitted defaults to the message author plus any @mentioned cofounders",
	}
	out := make(map[string]string, len(def)+len(incoming))
	for k, v := range def {
		out[k] = v
	}
	for k, v := range incoming {
		k = strings.TrimSpace(k)
		v = strings.TrimSpace(v)
		if k == "" {
			continue
		}
		out[k] = v
	}
	return out
}

func mergeDeleteCompanyParamDefaultsMap(incoming map[string]string) map[string]string {
	def := map[string]string{
		"name": "Company / channel slug (gathered in-thread when not in the first message)",
	}
	out := make(map[string]string, len(def)+len(incoming))
	for k, v := range def {
		out[k] = v
	}
	for k, v := range incoming {
		k = strings.TrimSpace(k)
		v = strings.TrimSpace(v)
		if k == "" {
			continue
		}
		out[k] = v
	}
	return out
}

// builtinSkillParamDefaults returns minimum required and default optional param names for built-in skills.
// Unknown/custom skills return nil, nil (caller keeps submitted lists only).
func builtinSkillParamDefaults(skillID string) (minRequired, defaultOptional []string) {
	switch skillID {
	case "create-email":
		return []string{"intent", "to", "subject"}, []string{"button", "link"}
	case "create-doc":
		return []string{"intent", "title", "editors"}, []string{"commenters", "viewers", "type", "length"}
	case "create-company":
		return []string{"name"}, []string{"founders"}
	case "delete-company":
		return []string{"name"}, nil
	case "read-company", "read-skills", "read-user":
		return nil, nil
	case "read-twitter":
		return []string{"query"}, []string{"count"}
	case "read-trends":
		return nil, nil
	case "update-issue":
		return []string{"number"}, []string{"repository", "title", "body", "status"}
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
	seenSkillIDs := map[string]struct{}{}

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
		if _, exists := seenSkillIDs[id]; exists {
			continue
		}
		seenSkillIDs[id] = struct{}{}
		required := normalizeCatalogParamList(skill.RequiredParams)
		optional := normalizeCatalogParamList(skill.OptionalParams)
		required = normalizeCatalogParamList(mapCatalogParams(required))
		optional = normalizeCatalogParamList(mapCatalogParams(optional))
		required, optional = mergeSkillParamsWithDefaults(id, required, optional)

		lbl := strings.TrimSpace(skill.Label)
		if id == "read-web" {
			switch strings.ToLower(lbl) {
			case "", "read internet", "read google", "read_google", "read-google", "read web", "read_web":
				lbl = "Read Web"
			}
		}
		if lbl == "" {
			lbl = builtinSkillDisplayLabel(id)
		}
		skill.Label = lbl
		skill.RequiredParams = required
		skill.OptionalParams = optional
		skill.ID = id
		skill.RuntimeTool = resolveRuntimeTool(skill.RuntimeTool, id, ownersBySkill[id])
		skill.Description = strings.TrimSpace(skill.Description)
		if id == "create-email" {
			skill.ParamDefaults = mergeCreateEmailParamDefaultsMap(skill.ParamDefaults)
		}
		if id == "create-doc" {
			skill.ParamDefaults = mergeCreateDocParamDefaultsMap(skill.ParamDefaults)
		}
		if id == "create-company" {
			skill.ParamDefaults = mergeCreateCompanyParamDefaultsMap(skill.ParamDefaults)
		}
		if id == "delete-company" {
			skill.ParamDefaults = mergeDeleteCompanyParamDefaultsMap(skill.ParamDefaults)
		}
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
	loadFromOrchestrator := func() (CapabilityCatalog, error) {
		url := strings.TrimSpace(s.orchestratorCatalogURL)
		if url == "" {
			return CapabilityCatalog{}, fmt.Errorf("capability catalog: redis key missing; set SLACK_ORCHESTRATOR_CAPABILITY_CATALOG_URL to seed from slack-orchestrator or PUT /v1/admin/catalog")
		}
		catalog, err := FetchCapabilityCatalogFromOrchestrator(ctx, url)
		if err != nil {
			return CapabilityCatalog{}, fmt.Errorf("capability catalog seed from orchestrator: %w", err)
		}
		catalog = mergeCapabilityCatalogWithDefaults(catalog, CapabilityCatalog{})
		catalog = normalizeCapabilityCatalog(catalog)
		if err := validateCapabilityCatalog(catalog); err != nil {
			return CapabilityCatalog{}, fmt.Errorf("capability catalog seed invalid: %w", err)
		}
		catalog.Source = "redis_seed"
		body, marshalErr := json.Marshal(catalog)
		if marshalErr == nil {
			_ = s.rdb.Set(ctx, capabilityCatalogRedisKey, body, 0).Err()
		}
		return catalog, nil
	}

	raw, err := s.rdb.Get(ctx, capabilityCatalogRedisKey).Bytes()
	if err == redis.Nil {
		return loadFromOrchestrator()
	}
	if err != nil {
		// Keep /skills and /admin catalog alive from slack-orchestrator source-of-truth when Redis is degraded.
		return loadFromOrchestrator()
	}
	var catalog CapabilityCatalog
	if err := json.Unmarshal(raw, &catalog); err != nil {
		// Corrupted Redis payload should not blank the catalog UI if orchestrator is available.
		return loadFromOrchestrator()
	}
	baseline := s.orchestratorMergeBaseline(ctx)
	catalog = mergeCapabilityCatalogWithDefaults(catalog, baseline)
	catalog = normalizeCapabilityCatalog(catalog)
	if err := validateCapabilityCatalog(catalog); err != nil {
		// Invalid Redis payload should fall back to orchestrator (then rewrite Redis on success).
		return loadFromOrchestrator()
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
