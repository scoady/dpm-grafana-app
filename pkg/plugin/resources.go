package plugin

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

// handlePing returns a simple ok message for health testing.
func (a *App) handlePing(w http.ResponseWriter, req *http.Request) {
	w.Header().Add("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"message": "ok"}`))
}

// handleEcho echoes back a JSON message.
func (a *App) handleEcho(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var body struct {
		Message string `json:"message"`
	}
	if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
		http.Error(w, "invalid JSON body", http.StatusBadRequest)
		return
	}

	w.Header().Add("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(body)
}

// registerRoutes hooks up all API endpoints for the plugin.
func (a *App) registerRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/ping", a.handlePing)
	mux.HandleFunc("/echo", a.handleEcho)
	mux.HandleFunc("/fleet-management-api/ListCollectors", a.handleListCollectors)
	mux.HandleFunc("/fleet-management-api/GetConfig", a.handleGetConfig)
}

// handleListCollectors proxies a POST to Fleet's ListCollectors endpoint.
func (a *App) handleListCollectors(w http.ResponseWriter, r *http.Request) {
	a.proxyFleetPost(w, r, "ListCollectors")
}

// handleGetConfig proxies a POST to Fleet's GetConfig endpoint.
func (a *App) handleGetConfig(w http.ResponseWriter, r *http.Request) {
	a.proxyFleetPost(w, r, "GetConfig")
}

func (a *App) proxyFleetPost(w http.ResponseWriter, r *http.Request, endpoint string) {
	baseURL := a.config.FleetBaseURL
	authToken := a.settings.DecryptedSecureJSONData["fleetAuthToken"]

	if baseURL == "" || authToken == "" {
		http.Error(w, "Fleet credentials not configured", http.StatusBadRequest)
		return
	}

	targetURL := fmt.Sprintf("%s/%s", baseURL, endpoint)

	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "failed to read request body", http.StatusInternalServerError)
		return
	}

	req, err := http.NewRequestWithContext(r.Context(), "POST", targetURL, bytes.NewBuffer(body))
	if err != nil {
		http.Error(w, "failed to create outbound request", http.StatusInternalServerError)
		return
	}

	req.Header.Set("Authorization", "Basic "+authToken)
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
