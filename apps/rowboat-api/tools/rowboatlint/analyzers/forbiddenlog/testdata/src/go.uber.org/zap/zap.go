package zap

type Field struct{}

func String(string, string) Field { return Field{} }
func Error(error) Field           { return Field{} }
