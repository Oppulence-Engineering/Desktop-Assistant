{{- define "rowboat-api.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "rowboat-api.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name (include "rowboat-api.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "rowboat-api.labels" -}}
app.kubernetes.io/name: {{ include "rowboat-api.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end -}}

{{- define "rowboat-api.selectorLabels" -}}
app.kubernetes.io/name: {{ include "rowboat-api.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "rowboat-api.workerSelectorLabels" -}}
app.kubernetes.io/name: {{ include "rowboat-api.name" . }}-worker
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: worker
{{- end -}}

{{- define "rowboat-api.schedulerSelectorLabels" -}}
app.kubernetes.io/name: {{ include "rowboat-api.name" . }}-scheduler
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: scheduler
{{- end -}}

{{- define "rowboat-api.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "rowboat-api.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{- define "rowboat-api.image" -}}
{{- printf "%s:%s" .Values.image.repository (default .Chart.AppVersion .Values.image.tag) -}}
{{- end -}}

{{- define "rowboat-api.secretName" -}}
{{- if .Values.existingSecret -}}
{{- .Values.existingSecret -}}
{{- else -}}
{{- printf "%s-secrets" (include "rowboat-api.fullname" .) -}}
{{- end -}}
{{- end -}}

{{/*
Fail production renders when the connector resource-token issuer drifts from the
public rowboat-api origin. A separate issuer is an exceptional topology and must
be opted into explicitly with connectorBroker.allowSeparateIssuer.
*/}}
{{- define "rowboat-api.validateDeploymentContract" -}}
{{- $environment := lower (toString (default "" (index .Values.config "ENVIRONMENT"))) -}}
{{- if eq $environment "production" -}}
{{- $publicOrigin := required "production config.PUBLIC_BASE_URL is required for the connector broker issuer contract" (index .Values.config "PUBLIC_BASE_URL") -}}
{{- $brokerIssuer := required "production config.BROKER_TOKEN_ISSUER is required for connector resource tokens" (index .Values.config "BROKER_TOKEN_ISSUER") -}}
{{- if and (ne $brokerIssuer $publicOrigin) (not .Values.connectorBroker.allowSeparateIssuer) -}}
{{- fail (printf "production config.BROKER_TOKEN_ISSUER (%s) must equal config.PUBLIC_BASE_URL (%s); set connectorBroker.allowSeparateIssuer=true only for the documented separate-issuer topology" $brokerIssuer $publicOrigin) -}}
{{- end -}}
{{- if and .Values.ingress.enabled .Values.ingress.tls.enabled -}}
{{- $ingressOrigin := printf "https://%s" (required "production ingress.host is required when ingress is enabled" .Values.ingress.host) -}}
{{- if ne $publicOrigin $ingressOrigin -}}
{{- fail (printf "production config.PUBLIC_BASE_URL (%s) must equal the externally reachable ingress origin (%s)" $publicOrigin $ingressOrigin) -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- end -}}
