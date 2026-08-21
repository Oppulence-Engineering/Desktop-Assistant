//go:build ruleguard

package gorules

import "github.com/quasilyte/go-ruleguard/dsl"

func rowboat(m dsl.Matcher) {
	m.Match(
		`http.Get($url)`,
		`http.Head($url)`,
		`http.Post($url, $contentType, $body)`,
		`http.PostForm($url, $data)`,
	).Report(`RB004_DIRECT_HTTP: use NewRequestWithContext and an explicit bounded client`)

	m.Match(`context.TODO()`).Report(
		`RB009_AUTH_CONTEXT: replace placeholder contexts before code reaches production`,
	)
}
