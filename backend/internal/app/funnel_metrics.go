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

func init() {
	prometheus.MustRegister(installClickTotal)
}
