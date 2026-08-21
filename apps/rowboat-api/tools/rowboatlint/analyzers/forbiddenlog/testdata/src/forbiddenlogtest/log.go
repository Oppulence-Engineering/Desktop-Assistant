package forbiddenlogtest

import "go.uber.org/zap"

func Fields(value string) {
	_ = zap.String("request_id", value)
	_ = zap.String("access_token", value)  // want "RB011_FORBIDDEN_LOG_DATA"
	_ = zap.String("client-secret", value) // want "RB011_FORBIDDEN_LOG_DATA"
	_ = zap.Error(nil)
}
