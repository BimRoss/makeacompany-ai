package app

import "github.com/prometheus/client_golang/prometheus"

// installClickTotal counts CheckoutButton click submissions hitting
// /v1/billing/checkout. Labeled by first-touch source so we can see which
// acquisition channel actually starts the paid flow. Empty source label means
// the visitor had no mac_first_touch cookie (returning users, cookies blocked,
// or pre-cookie traffic before the middleware rolled out).
var installClickTotal = prometheus.NewCounterVec(
	prometheus.CounterOpts{
		Name: "makeacompany_install_click_total",
		Help: "Count of install-CTA clicks that POSTed to /v1/billing/checkout, labeled by first-touch source.",
	},
	[]string{"source"},
)

// oauthCallbackTotal tracks the success / failure outcomes of the
// personal-agent OAuth install callback. Outcomes:
//
//	success         — token exchanged + k8s resources written
//	denied          — Slack returned ?error=... (user declined or app misconfigured)
//	exchange_failed — oauth.v2.access POST failed or returned ok:false
//	secret_failed   — k8s Secret write failed
//	service_failed  — k8s Service write failed
//	deployment_failed — k8s Deployment write failed
var oauthCallbackTotal = prometheus.NewCounterVec(
	prometheus.CounterOpts{
		Name: "makeacompany_oauth_callback_total",
		Help: "Personal-agent OAuth install-complete callback outcomes.",
	},
	[]string{"outcome"},
)

// firstMessageTotal counts the moments a Slack user sends their very first
// message indexed by Ross or Joanne. Incremented exactly once per
// slack_user_id, when the first_seen_at HSetNX flips the field in the
// user_engagement hash. Labeled by the bot that observed it ("ross" or
// "joanne") so we can see the split.
var firstMessageTotal = prometheus.NewCounterVec(
	prometheus.CounterOpts{
		Name: "makeacompany_first_message_total",
		Help: "Count of users whose first ingested message just landed, labeled by observing bot.",
	},
	[]string{"bot"},
)

func init() {
	prometheus.MustRegister(installClickTotal, oauthCallbackTotal, firstMessageTotal)
}
