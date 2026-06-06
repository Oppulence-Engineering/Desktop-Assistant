package perf

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type cdpClient struct {
	conn *websocket.Conn
	next int
	mu   sync.Mutex
}

func connectCDP(port int) (*cdpClient, error) {
	targets, err := cdpTargets(port)
	if err != nil {
		return nil, err
	}
	var wsURL string
	for _, target := range targets {
		if target.Type == "page" && target.WebSocketDebuggerURL != "" {
			wsURL = target.WebSocketDebuggerURL
			break
		}
	}
	if wsURL == "" {
		return nil, errors.New("no page target with websocket debugger URL")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	conn, _, err := websocket.DefaultDialer.DialContext(ctx, wsURL, nil)
	if err != nil {
		return nil, err
	}
	return &cdpClient{conn: conn}, nil
}

func (c *cdpClient) close() {
	_ = c.conn.Close()
}

func (c *cdpClient) call(method string, params any) (json.RawMessage, error) {
	return c.callTimeout(method, params, 30*time.Second)
}

func (c *cdpClient) callTimeout(method string, params any, timeout time.Duration) (json.RawMessage, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.next++
	id := c.next
	req := map[string]any{"id": id, "method": method}
	if params != nil {
		req["params"] = params
	}
	if err := c.conn.WriteJSON(req); err != nil {
		return nil, err
	}
	deadline := time.Now().Add(timeout)
	_ = c.conn.SetReadDeadline(deadline)
	for {
		var msg struct {
			ID     int             `json:"id"`
			Result json.RawMessage `json:"result"`
			Error  *struct {
				Code    int    `json:"code"`
				Message string `json:"message"`
			} `json:"error"`
		}
		if err := c.conn.ReadJSON(&msg); err != nil {
			return nil, err
		}
		if msg.ID != id {
			continue
		}
		if msg.Error != nil {
			return nil, fmt.Errorf("%s failed: %s", method, msg.Error.Message)
		}
		return msg.Result, nil
	}
}

func evaluateInRenderer(cdp *cdpClient, script string, timeout time.Duration) (string, error) {
	if cdp == nil {
		return runAgentEval(timeout, script)
	}
	result, err := cdp.callTimeout("Runtime.evaluate", map[string]any{
		"expression":    script,
		"awaitPromise":  true,
		"returnByValue": true,
	}, timeout)
	if err != nil {
		return "", err
	}
	var payload struct {
		Result struct {
			Type        string          `json:"type"`
			Value       json.RawMessage `json:"value"`
			Description string          `json:"description"`
		} `json:"result"`
		ExceptionDetails *struct {
			Text      string `json:"text"`
			Exception struct {
				Description string          `json:"description"`
				Value       json.RawMessage `json:"value"`
			} `json:"exception"`
		} `json:"exceptionDetails"`
	}
	if err := json.Unmarshal(result, &payload); err != nil {
		return string(result), err
	}
	if payload.ExceptionDetails != nil {
		message := payload.ExceptionDetails.Exception.Description
		if message == "" {
			message = payload.ExceptionDetails.Text
		}
		if message == "" && len(payload.ExceptionDetails.Exception.Value) > 0 {
			message = string(payload.ExceptionDetails.Exception.Value)
		}
		return string(result), errors.New(message)
	}
	if len(payload.Result.Value) > 0 {
		return string(payload.Result.Value), nil
	}
	return payload.Result.Description, nil
}

type cdpTarget struct {
	Type                 string `json:"type"`
	URL                  string `json:"url"`
	WebSocketDebuggerURL string `json:"webSocketDebuggerUrl"`
}

func cdpTargets(port int) ([]cdpTarget, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, fmt.Sprintf("http://127.0.0.1:%d/json/list", port), nil)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	if res.StatusCode < 200 || res.StatusCode > 299 {
		return nil, fmt.Errorf("CDP /json/list failed: %s", res.Status)
	}
	var targets []cdpTarget
	if err := json.Unmarshal(body, &targets); err != nil {
		return nil, err
	}
	return targets, nil
}

func writeCPUProfile(path string, result json.RawMessage) error {
	var payload struct {
		Profile json.RawMessage `json:"profile"`
	}
	if err := json.Unmarshal(result, &payload); err != nil {
		return err
	}
	if len(payload.Profile) == 0 {
		return errors.New("Profiler.stop result did not include profile")
	}
	return os.WriteFile(path, payload.Profile, 0o644)
}

func readRendererMetrics(cdp *cdpClient) (map[string]float64, error) {
	out := map[string]float64{}
	if result, err := cdp.call("Performance.getMetrics", nil); err == nil {
		var payload struct {
			Metrics []struct {
				Name  string  `json:"name"`
				Value float64 `json:"value"`
			} `json:"metrics"`
		}
		if err := json.Unmarshal(result, &payload); err != nil {
			return nil, err
		}
		for _, metric := range payload.Metrics {
			out[metric.Name] = metric.Value
		}
		if v, ok := out["JSHeapUsedSize"]; ok {
			out["JSHeapUsedSizeMB"] = bytesToMB(uint64(v))
		}
	}
	if result, err := cdp.call("Memory.getDOMCounters", nil); err == nil {
		var counters map[string]float64
		if err := json.Unmarshal(result, &counters); err == nil {
			for k, v := range counters {
				out["DOMCounters."+k] = v
			}
		}
	}
	return out, nil
}
