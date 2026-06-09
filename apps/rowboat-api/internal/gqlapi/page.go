package gqlapi

// Pagination clamps shared by the relay-connection resolvers. Kept out of
// ent.resolvers.go so gqlgen regeneration doesn't relocate them into its
// "going to be deleted" tombstone block.

const (
	defaultPageSize = 50
	maxPageSize     = 100
)

// clampPage applies the default page size when neither bound is given and caps
// both bounds at maxPageSize.
func clampPage(first, last *int) (*int, *int) {
	if first == nil && last == nil {
		n := defaultPageSize
		return &n, last
	}
	if first != nil && *first > maxPageSize {
		n := maxPageSize
		first = &n
	}
	if last != nil && *last > maxPageSize {
		n := maxPageSize
		last = &n
	}
	return first, last
}
