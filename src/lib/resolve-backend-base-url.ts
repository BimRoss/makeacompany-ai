/** Server-side base URL for Next → Go (no cookies; safe to import from any server module). */
export function resolveBackendBaseURL(): string {
  const isKubernetes = Boolean(process.env.KUBERNETES_SERVICE_HOST);
  const defaultBackendBase = isKubernetes ? "http://makeacompany-ai-backend:8080" : "http://localhost:8090";
  const configuredInternalBase = process.env.BACKEND_INTERNAL_API_BASE_URL?.trim();
  return configuredInternalBase || defaultBackendBase;
}
