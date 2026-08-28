{{- define "hydra-network-policy.fullname" -}}
{{- printf "%s-hydra-network-policy" .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "hydra-network-policy.labels" -}}
app.kubernetes.io/name: hydra-network-policy
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end -}}

{{- define "hydra-network-policy.validateValues" -}}
{{- $environment := lower (default "development" .Values.deploymentEnvironment) -}}
{{- if has $environment (list "staging" "production") -}}
  {{- if empty .Values.egress.postgresql.cidrs -}}
    {{- fail (printf "%s deployments must set at least one environment-specific egress.postgresql.cidrs entry for Hydra" $environment) -}}
  {{- end -}}
  {{- range .Values.egress.postgresql.cidrs -}}
    {{- if has . (list "0.0.0.0/0" "::/0" "10.0.0.10/32") -}}
      {{- fail (printf "%s egress.postgresql.cidrs contains forbidden broad or placeholder CIDR %s" $environment .) -}}
    {{- end -}}
    {{- if not (regexMatch `^([0-9]{1,3}\.){3}[0-9]{1,3}/([0-9]|[12][0-9]|3[0-2])$` .) -}}
      {{- fail (printf "%s egress.postgresql.cidrs entry %s must be an IPv4 CIDR" $environment .) -}}
    {{- end -}}
  {{- end -}}
  {{- if empty .Values.adminIngress.oauthConsent.namespaceSelector.matchLabels -}}
    {{- fail (printf "%s Hydra admin ingress must select the oauth-consent namespace" $environment) -}}
  {{- end -}}
  {{- if empty .Values.adminIngress.oauthConsent.podSelector.matchLabels -}}
    {{- fail (printf "%s Hydra admin ingress must select labeled oauth-consent pods" $environment) -}}
  {{- end -}}
  {{- if empty .Values.adminIngress.reconcilers.podSelector.matchLabels -}}
    {{- fail (printf "%s Hydra admin ingress must select labeled reconciliation/operator jobs" $environment) -}}
  {{- end -}}
{{- end -}}
{{- end -}}
