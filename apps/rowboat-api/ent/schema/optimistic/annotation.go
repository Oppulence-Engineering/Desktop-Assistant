// Package optimistic defines Rowboat's Ent annotation for compare-and-swap aggregates.
package optimistic

import "entgo.io/ent/schema"

// Annotation identifies the integer field callers must compare and increment
// when updating a mutable aggregate.
type Annotation struct {
	Field string `json:"field"`
}

// Name implements schema.Annotation.
func (Annotation) Name() string { return "RowboatOptimisticLock" }

var _ schema.Annotation = Annotation{}
