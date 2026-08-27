{{- define "oauth-consent.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "oauth-consent.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name (include "oauth-consent.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "oauth-consent.labels" -}}
app.kubernetes.io/name: {{ include "oauth-consent.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end -}}

{{- define "oauth-consent.selectorLabels" -}}
app.kubernetes.io/name: {{ include "oauth-consent.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "oauth-consent.image" -}}
{{- printf "%s:%s" .Values.image.repository (default .Chart.AppVersion .Values.image.tag) -}}
{{- end -}}

{{- define "oauth-consent.validateValues" -}}
{{- $environment := lower (default "development" .Values.deploymentEnvironment) -}}
{{- if has $environment (list "staging" "production") -}}
  {{- if not .Values.networkPolicy.enabled -}}
    {{- fail (printf "%s deployments must enable networkPolicy" $environment) -}}
  {{- end -}}
  {{- if empty .Values.existingSecret -}}
    {{- fail (printf "%s deployments must set existingSecret" $environment) -}}
  {{- end -}}
  {{- if ne .Values.database.urlSecretKey "DATABASE_URL" -}}
    {{- fail (printf "%s deployments must read DATABASE_URL from the external Secret" $environment) -}}
  {{- end -}}
  {{- if empty .Values.networkPolicy.postgresql.cidrs -}}
    {{- fail (printf "%s deployments must set at least one environment-specific networkPolicy.postgresql.cidrs entry" $environment) -}}
  {{- end -}}
  {{- range .Values.networkPolicy.postgresql.cidrs -}}
    {{- if has . (list "0.0.0.0/0" "::/0" "10.0.0.10/32") -}}
      {{- fail (printf "%s networkPolicy.postgresql.cidrs contains forbidden broad or placeholder CIDR %s" $environment .) -}}
    {{- end -}}
    {{- if not (regexMatch `^([0-9]{1,3}\.){3}[0-9]{1,3}/([0-9]|[12][0-9]|3[0-2])$` .) -}}
      {{- fail (printf "%s networkPolicy.postgresql.cidrs entry %s must be an IPv4 CIDR" $environment .) -}}
    {{- end -}}
  {{- end -}}
  {{- if empty .Values.networkPolicy.hydraAdmin.namespaceSelector.matchLabels -}}
    {{- fail (printf "%s deployments must scope Hydra admin egress with namespaceSelector.matchLabels" $environment) -}}
  {{- end -}}
  {{- if empty .Values.networkPolicy.hydraAdmin.podSelector.matchLabels -}}
    {{- fail (printf "%s deployments must scope Hydra admin egress with podSelector.matchLabels" $environment) -}}
  {{- end -}}
{{- end -}}
{{- end -}}
