package plugin

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/instancemgmt"
	"github.com/grafana/grafana-plugin-sdk-go/backend/resource/httpadapter"
)

type PluginConfig struct {
	FleetBaseURL  string `json:"fleetBaseURL"`
	DatasourceUID string `json:"datasourceUid"`
}

// Make sure App implements required interfaces. This is important to do
// since otherwise we will only get a not implemented error response from plugin in
// runtime. Plugin should not implement all these interfaces - only those which are
// required for a particular task.
var (
	_ backend.CallResourceHandler   = (*App)(nil)
	_ instancemgmt.InstanceDisposer = (*App)(nil)
	_ backend.CheckHealthHandler    = (*App)(nil)
)

// App is an example app backend plugin which can respond to data queries.
type App struct {
	backend.CallResourceHandler
	settings backend.AppInstanceSettings
	config   PluginConfig
}

// NewApp creates a new example *App instance.
func NewApp(_ context.Context, settings backend.AppInstanceSettings) (instancemgmt.Instance, error) {
	var app App
	app.settings = settings
	// Parse the jsonData into the config struct
	if err := json.Unmarshal(settings.JSONData, &app.config); err != nil {
		return nil, fmt.Errorf("failed to parse plugin config: %w", err)
	}
	// Use a httpadapter (provided by the SDK) for resource calls. This allows us
	// to use a *http.ServeMux for resource calls, so we can map multiple routes
	// to CallResource without having to implement extra logic.
	mux := http.NewServeMux()
	app.registerRoutes(mux)
	app.CallResourceHandler = httpadapter.New(mux)

	return &app, nil
}

// Dispose here tells plugin SDK that plugin wants to clean up resources when a new instance
// created.
func (a *App) Dispose() {
	// cleanup
}

// CheckHealth handles health checks sent from Grafana to the plugin.
func (a *App) CheckHealth(_ context.Context, _ *backend.CheckHealthRequest) (*backend.CheckHealthResult, error) {
	return &backend.CheckHealthResult{
		Status:  backend.HealthStatusOk,
		Message: "ok",
	}, nil
}

func (a *App) handleFleetProxy(w http.ResponseWriter, r *http.Request) {
	const fleetBaseURL = "https://fleet-management-prod-014.grafana.net/collector.v1.CollectorService"
	const authHeader = "Basic MTA5MzY1NjpnbGNfZXlKdklqb2lNVEkyTnpRME1DSXNJbTRpT2lKemRHRmpheTB4TURrek5qVTJMV1pzWldWMExXMWhibUZuWlcxbGJuUXRZWEJwTFdac1pXVjBiV2R0ZENJc0ltc2lPaUpsVWxsNU5qSnBNalZHYVdjME16ZGtXbFJoY1RZME4wSWlMQ0p0SWpwN0luSWlPaUp3Y205a0xYVnpMWGRsYzNRdE1DSjlmUT09Cg=="

	action := r.URL.Path[len("/proxy-fleet/"):] // e.g., "ListCollectors"
	if action == "" {
		http.Error(w, "Missing action", http.StatusBadRequest)
		return
	}

	targetURL := fleetBaseURL + "/" + action

	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Failed to read request body", http.StatusInternalServerError)
		return
	}

	req, err := http.NewRequestWithContext(r.Context(), "POST", targetURL, bytes.NewBuffer(body))
	if err != nil {
		http.Error(w, "Failed to create outbound request", http.StatusInternalServerError)
		return
	}

	req.Header.Set("Authorization", authHeader)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		http.Error(w, "Fleet API request failed", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		http.Error(w, "Failed to read Fleet API response", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	_, _ = w.Write(respBody)
}
