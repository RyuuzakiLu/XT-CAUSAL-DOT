// Remote memory is not included; explicitly enabled remote mode fails closed.
export function isCloudMode(): boolean {
  return /^(1|true)$/i.test(process.env.DOT_CLOUD_MODE ?? '')
}
