package workflow

import "time"

type Context interface{}

func Now(Context) time.Time              { return time.Time{} }
func Sleep(Context, time.Duration) error { return nil }
