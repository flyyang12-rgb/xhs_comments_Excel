if (typeof get_request_headers_params !== 'function') {
  throw new Error(`签名入口不存在：get_request_headers_params=${typeof get_request_headers_params}, mnsv2=${typeof globalThis.mnsv2}`);
}

globalThis.XhsSigner = {
  seccore_signv2,
  get_request_headers_params,
  XsCommon,
  get_x_s
};
