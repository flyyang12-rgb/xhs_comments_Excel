export function signRequest(api, data, a1, method = 'GET') {
  if (!globalThis.XhsSigner?.get_request_headers_params) {
    throw new Error('签名模块未加载');
  }
  return globalThis.XhsSigner.get_request_headers_params(api, data || '', a1, method);
}
