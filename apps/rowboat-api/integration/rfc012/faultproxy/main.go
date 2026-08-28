// Command faultproxy is an RFC 012 acceptance-only Redis TCP fault proxy.
// It forwards the real go-redis protocol to Redis 7 while exposing a loopback
// control plane for deterministic availability and command-specific failures.
package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

type proxy struct {
	upstream string
	secret   string

	mu            sync.Mutex
	available     bool
	failCommand   string
	failKeyPrefix string
	connections   map[net.Conn]net.Conn
	failed        int64
	observed      map[string]int64
	lastKeys      []string
}

type controlRequest struct {
	Available     *bool  `json:"available,omitempty"`
	FailCommand   string `json:"fail_command,omitempty"`
	FailKeyPrefix string `json:"fail_key_prefix,omitempty"`
	ClearFailure  bool   `json:"clear_failure,omitempty"`
}

type stateResponse struct {
	Available     bool             `json:"available"`
	FailCommand   string           `json:"fail_command,omitempty"`
	FailKeyPrefix string           `json:"fail_key_prefix,omitempty"`
	Failed        int64            `json:"failed"`
	Observed      map[string]int64 `json:"observed"`
	LastKeys      []string         `json:"last_keys,omitempty"`
}

func main() {
	listenAddr := getenv("LISTEN_ADDR", "127.0.0.1:6380")
	controlAddr := getenv("CONTROL_ADDR", "127.0.0.1:6381")
	p := &proxy{
		upstream:    mustEnv("UPSTREAM_ADDR"),
		secret:      mustEnv("CONTROL_SECRET"),
		available:   true,
		connections: make(map[net.Conn]net.Conn),
		observed:    make(map[string]int64),
	}

	ln, err := net.Listen("tcp", listenAddr)
	if err != nil {
		log.Fatal(err)
	}
	defer ln.Close()
	go func() {
		for {
			conn, acceptErr := ln.Accept()
			if acceptErr != nil {
				if !errors.Is(acceptErr, net.ErrClosed) {
					log.Printf("redis proxy accept: %v", acceptErr)
				}
				return
			}
			go p.serve(conn)
		}
	}()

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
	mux.HandleFunc("GET /state", p.authorized(p.state))
	mux.HandleFunc("POST /control", p.authorized(p.control))
	mux.HandleFunc("POST /control/down", p.authorized(func(w http.ResponseWriter, _ *http.Request) {
		available := false
		p.apply(controlRequest{Available: &available})
		w.WriteHeader(http.StatusNoContent)
	}))
	mux.HandleFunc("POST /control/up", p.authorized(func(w http.ResponseWriter, _ *http.Request) {
		available := true
		p.apply(controlRequest{Available: &available})
		w.WriteHeader(http.StatusNoContent)
	}))

	log.Printf("RFC 012 Redis fault proxy listening on %s -> %s; control=%s", listenAddr, p.upstream, controlAddr)
	server := &http.Server{Addr: controlAddr, Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	log.Fatal(server.ListenAndServe())
}

func (p *proxy) authorized(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Fixture-Secret") != p.secret {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		next(w, r)
	}
}

func (p *proxy) state(w http.ResponseWriter, _ *http.Request) {
	p.mu.Lock()
	state := stateResponse{
		Available: p.available, FailCommand: p.failCommand, FailKeyPrefix: p.failKeyPrefix,
		Failed: p.failed, Observed: make(map[string]int64, len(p.observed)), LastKeys: append([]string(nil), p.lastKeys...),
	}
	for command, count := range p.observed {
		state.Observed[command] = count
	}
	p.mu.Unlock()
	writeJSON(w, state)
}

func (p *proxy) control(w http.ResponseWriter, r *http.Request) {
	var req controlRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&req); err != nil {
		http.Error(w, "invalid control request", http.StatusBadRequest)
		return
	}
	p.apply(req)
	w.WriteHeader(http.StatusNoContent)
}

func (p *proxy) apply(req controlRequest) {
	p.mu.Lock()
	if req.Available != nil {
		p.available = *req.Available
	}
	if req.ClearFailure {
		p.failCommand = ""
		p.failKeyPrefix = ""
	} else if req.FailCommand != "" || req.FailKeyPrefix != "" {
		p.failCommand = strings.ToUpper(strings.TrimSpace(req.FailCommand))
		p.failKeyPrefix = req.FailKeyPrefix
	}
	closeConnections := req.Available != nil && !*req.Available
	pairs := make([][2]net.Conn, 0, len(p.connections))
	if closeConnections {
		for client, upstream := range p.connections {
			pairs = append(pairs, [2]net.Conn{client, upstream})
		}
	}
	p.mu.Unlock()
	for _, pair := range pairs {
		_ = pair[0].Close()
		_ = pair[1].Close()
	}
}

func (p *proxy) serve(client net.Conn) {
	p.mu.Lock()
	available := p.available
	p.mu.Unlock()
	if !available {
		_ = client.Close()
		return
	}
	upstream, err := net.DialTimeout("tcp", p.upstream, 2*time.Second)
	if err != nil {
		_ = client.Close()
		return
	}
	p.mu.Lock()
	p.connections[client] = upstream
	p.mu.Unlock()
	defer func() {
		p.mu.Lock()
		delete(p.connections, client)
		p.mu.Unlock()
		_ = client.Close()
		_ = upstream.Close()
	}()

	copyDone := make(chan struct{})
	go func() {
		_, _ = io.Copy(client, upstream)
		close(copyDone)
	}()

	reader := bufio.NewReader(client)
	for {
		raw, args, readErr := readRESPCommand(reader)
		if readErr != nil {
			return
		}
		command, key := commandAndKey(args)
		if p.reject(command, key) {
			return
		}
		if _, err := upstream.Write(raw); err != nil {
			return
		}
		select {
		case <-copyDone:
			return
		default:
		}
	}
}

func (p *proxy) reject(command, key string) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.observed[command]++
	if key != "" {
		p.lastKeys = append(p.lastKeys, key)
		if len(p.lastKeys) > 32 {
			p.lastKeys = append([]string(nil), p.lastKeys[len(p.lastKeys)-32:]...)
		}
	}
	if !p.available {
		return true
	}
	if p.failCommand != "" && p.failCommand != command {
		return false
	}
	if p.failKeyPrefix != "" && !strings.HasPrefix(key, p.failKeyPrefix) {
		return false
	}
	if p.failCommand == "" && p.failKeyPrefix == "" {
		return false
	}
	p.failed++
	return true
}

func commandAndKey(args [][]byte) (string, string) {
	if len(args) == 0 {
		return "", ""
	}
	command := strings.ToUpper(string(args[0]))
	if len(args) < 2 {
		return command, ""
	}
	key := string(args[1])
	if command == "EVAL" || command == "EVALSHA" {
		if len(args) >= 4 {
			key = string(args[3])
		}
	}
	return command, key
}

func readRESPCommand(r *bufio.Reader) ([]byte, [][]byte, error) {
	prefix, err := r.ReadByte()
	if err != nil {
		return nil, nil, err
	}
	if prefix != '*' {
		line, lineErr := r.ReadBytes('\n')
		raw := append([]byte{prefix}, line...)
		if lineErr != nil {
			return nil, nil, lineErr
		}
		return raw, bytes.Fields(bytes.TrimSpace(raw)), nil
	}
	countLine, err := r.ReadString('\n')
	if err != nil {
		return nil, nil, err
	}
	count, err := strconv.Atoi(strings.TrimSpace(countLine))
	if err != nil || count < 0 {
		return nil, nil, fmt.Errorf("invalid RESP array length %q", countLine)
	}
	var raw bytes.Buffer
	raw.WriteByte(prefix)
	raw.WriteString(countLine)
	args := make([][]byte, 0, count)
	for i := 0; i < count; i++ {
		bulkPrefix, err := r.ReadByte()
		if err != nil {
			return nil, nil, err
		}
		raw.WriteByte(bulkPrefix)
		if bulkPrefix != '$' {
			return nil, nil, fmt.Errorf("unsupported RESP command element %q", bulkPrefix)
		}
		lengthLine, err := r.ReadString('\n')
		if err != nil {
			return nil, nil, err
		}
		raw.WriteString(lengthLine)
		length, err := strconv.Atoi(strings.TrimSpace(lengthLine))
		if err != nil || length < 0 {
			return nil, nil, fmt.Errorf("invalid RESP bulk length %q", lengthLine)
		}
		value := make([]byte, length+2)
		if _, err := io.ReadFull(r, value); err != nil {
			return nil, nil, err
		}
		if value[length] != '\r' || value[length+1] != '\n' {
			return nil, nil, errors.New("invalid RESP bulk terminator")
		}
		raw.Write(value)
		args = append(args, append([]byte(nil), value[:length]...))
	}
	return raw.Bytes(), args, nil
}

func writeJSON(w http.ResponseWriter, value any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(value)
}

func mustEnv(key string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		log.Fatalf("%s is required", key)
	}
	return value
}

func getenv(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}
